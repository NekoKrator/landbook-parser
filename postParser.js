const { log, error } = require('./logger');

function stripTrackingParams(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (key.toLowerCase().startsWith('utm_')) {
        parsed.searchParams.delete(key);
      }
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

async function parsePost(page, url, options = {}) {
  const includePages = options.includePages !== false;

  try {
    log(`Parsing post: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    await page.waitForSelector('h1', { timeout: 15000 }).catch(() => {
      log('Warning: h1 not found, continuing anyway');
    });

    await page.evaluate(() => window.scrollTo(0, 300));
    await new Promise((r) => setTimeout(r, 1000));

    const barEls = await page.$$('.website-components-bar-el');
    for (const el of barEls) {
      await el.click().catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 500));

    if (includePages) {
      await page
        .$eval('#website-tab-pages', (el) => el.click())
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }

    const data = await page.evaluate((postUrl, includePagesValue) => {
      const idMatch = postUrl.match(/\/(\d+)-/);
      const id = idMatch ? idMatch[1] : null;

      const title = document.querySelector('h1')?.innerText?.trim() || null;

      const metaText = (() => {
        const h1 = document.querySelector('h1');
        if (!h1) return '';
        const next = h1.nextElementSibling;
        const text = next?.innerText?.trim();
        return typeof text === 'string' ? text : '';
      })();

      const viewsMatch = metaText.match(/([\d,]+)\s*[Vv]iews?/);
      const views = viewsMatch
        ? parseInt(viewsMatch[1].replace(/,/g, ''), 10)
        : 0;

      const savesMatch = metaText.match(/([\d,]+)\s*[Ss]aves?/);
      const saves = savesMatch
        ? parseInt(savesMatch[1].replace(/,/g, ''), 10)
        : 0;

      const dateMatch = metaText.match(
        /(?:Verified\s+)?([A-Za-z]+\s+\d{2,4}|\d{4}-\d{2}-\d{2})/,
      );
      const published_at = dateMatch ? dateMatch[1] : null;

      const visitBtn = Array.from(document.querySelectorAll('a, button')).find(
        (el) => {
          const text = el.innerText?.trim().toLowerCase();
          return text === 'visit' || text?.startsWith('visit');
        },
      );
      const external_url =
        visitBtn?.tagName === 'A'
          ? visitBtn.href
          : visitBtn?.closest('a')?.href || null;

      const tagCandidates = Array.from(
        document.querySelectorAll(
          'a[href*="tag"], a[href*="filter"], [class*="tag"], [class*="pill"], [class*="badge"], [class*="chip"]',
        ),
      );
      const tags = tagCandidates
        .map((el) => el.innerText?.trim())
        .filter((t) => t && t.length > 0 && t.length < 30 && !t.includes('\n'))
        .filter((t) => isNaN(t))
        .filter((t) => !/^\d+\/\d+$/.test(t))
        .filter((t, i, arr) => arr.indexOf(t) === i);

      const colorEls = Array.from(
        document.querySelectorAll('[style*="background"]'),
      ).filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = el.getAttribute('style') || '';
        const hasColor = style.match(/#[0-9a-fA-F]{3,6}|rgb\(/);
        return hasColor && rect.width < 80 && rect.height > 40;
      });
      const colors = colorEls
        .map((el) => {
          const style = el.getAttribute('style') || '';
          const hexMatch = style.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
          if (hexMatch) return hexMatch[0].toUpperCase();
          const rgbMatch = style.match(
            /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/,
          );
          if (rgbMatch) {
            const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
            const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
            const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`.toUpperCase();
          }
          return null;
        })
        .filter((c) => c !== null)
        .filter((c, i, arr) => arr.indexOf(c) === i);

      const mainImg = document.querySelector('[data-website-img]');
      const full_image_url = mainImg?.src || null;

      const mobileImg = document.querySelector('[data-expandable-content-img]');
      const mobile_image_url = mobileImg?.src || null;

      const pagesPane = includePagesValue ? document.querySelector('#website-tabpane-pages') : null;
      const pageCandidates = pagesPane
        ? Array.from(pagesPane.querySelectorAll('a[href*="/websites/"]'))
            .map((el) => {
              const rawTitle = el.innerText?.trim() || '';
              const title =
                rawTitle
                  .split('\n')
                  .map((part) => part.trim())
                  .find(
                    (part) =>
                      part &&
                      !/^(save|copy|show similar|more like this)$/i.test(part),
                  ) || rawTitle.trim();
              const img = el.querySelector('img');

              return {
                url: el.href,
                title,
                image_url: img?.src || null,
              };
            })
            .filter((item) => item.url && item.url !== postUrl)
            .filter((item) => item.title || item.image_url)
        : [];

      const componentBars = Array.from(
        document.querySelectorAll('.website-components-bar-el'),
      );
      const highlights = Array.from(
        document.querySelectorAll('.website-section-highlight'),
      );

      const highlightMap = {};
      highlights.forEach((el) => {
        const id = el.getAttribute('data-website-component-screenshot-id');
        const y = el.getAttribute('data-website-component-point-y');
        if (id && y) {
          highlightMap[id] = parseFloat(y);
        }
      });

      const sections = [];
      let currentY = 0;

      componentBars.forEach((el) => {
        const name = el.innerText?.trim() || 'Section';
        const height = parseFloat(
          el.getAttribute('data-website-component-height') || '0',
        );
        if (!height || height <= 0) return;

        const screenshotId = el.getAttribute(
          'data-website-component-screenshot-id',
        );
        const yUI = screenshotId ? highlightMap[screenshotId] || null : null;
        const y = yUI !== null ? Math.round(yUI) : Math.round(currentY);

        currentY += height;
        sections.push({ name, y, height: Math.round(height) });
      });

      const sectionsBtn = Array.from(
        document.querySelectorAll('button, [class*="button"]'),
      ).find((el) => el.innerText?.trim().toLowerCase().startsWith('sections'));
      const sectionsCountMatch = sectionsBtn?.innerText?.match(/\d+/);
      const sections_count = sectionsCountMatch
        ? parseInt(sectionsCountMatch[0], 10)
        : sections.length || null;
      const seenPages = new Set();
      const pages = [];

      for (const item of pageCandidates) {
        if (seenPages.has(item.url)) continue;
        seenPages.add(item.url);
        pages.push(item);
      }
      const pagesBtn = includePagesValue ? document.querySelector('#website-tab-pages') : null;
      const pagesCountMatch = pagesBtn?.innerText?.match(/\d+/);
      const pages_count = pagesCountMatch
        ? parseInt(pagesCountMatch[0], 10)
        : pages.length || null;

      return {
        id,
        title,
        url: postUrl,
        external_url,
        published_at,
        views,
        saves,
        tags,
        colors,
        full_image_url,
        mobile_image_url,
        pages,
        pages_count,
        sections,
        sections_count,
        parsed_at: new Date().toISOString(),
      };
    }, url, includePages);

    data.external_url = stripTrackingParams(data.external_url);

    log(
      `Post parsed: "${data.title}" | tags: ${data.tags.length} | colors: ${data.colors.length} | pages: ${data.pages.length} | sections: ${data.sections.length} | saves: ${data.saves}`,
    );
    return data;
  } catch (err) {
    error(`Failed to parse post: ${url}`, err);
    return null;
  }
}

module.exports = { parsePost };

