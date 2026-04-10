const { log, error } = require('./logger');

async function parsePost(page, url) {
  try {
    log(`Parsing post: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    await page.waitForSelector('h1', { timeout: 15000 }).catch(() => {
      log('Warning: h1 not found, continuing anyway');
    });

    const data = await page.evaluate((postUrl) => {
      const idMatch = postUrl.match(/\/(\d+)-/);
      const id = idMatch ? idMatch[1] : null;

      // "Pebble | Where Home Meets the Road"
      const title = document.querySelector('h1')?.innerText?.trim() || null;

      // "9,080 Views • 155 saves • Verified Oct 25"
      const metaText = (() => {
        const h1 = document.querySelector('h1');
        if (!h1) return '';
        const next = h1.nextElementSibling;
        const text = next?.innerText?.trim();
        return typeof text === 'string' ? text : '';
      })();

      // views
      const viewsMatch = metaText.match(/([\d,]+)\s*[Vv]iews?/);
      const views = viewsMatch
        ? parseInt(viewsMatch[1].replace(/,/g, ''), 10)
        : 0;

      // saves
      const savesMatch = metaText.match(/([\d,]+)\s*[Ss]aves?/);
      const saves = savesMatch
        ? parseInt(savesMatch[1].replace(/,/g, ''), 10)
        : 0;

      // date (Verified Oct 25 / Oct 25 / 2024-10-25)
      const dateMatch = metaText.match(
        /(?:Verified\s+)?([A-Za-z]+\s+\d{2,4}|\d{4}-\d{2}-\d{2})/,
      );
      const published_at = dateMatch ? dateMatch[1] : null;

      // "Visit ↗"
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

      // tags (e.g. "Landing", "Big Type", "Animation")
      const tagCandidates = Array.from(
        document.querySelectorAll(
          'a[href*="tag"], a[href*="filter"], [class*="tag"], [class*="pill"], [class*="badge"], [class*="chip"]',
        ),
      );
      const tags = tagCandidates
        .map((el) => el.innerText?.trim())
        .filter((t) => t && t.length > 0 && t.length < 30 && !t.includes('\n'))
        .filter((t) => isNaN(t))
        .filter((t, i, arr) => arr.indexOf(t) === i); // unique

      // colors
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
        .filter((c, i, arr) => arr.indexOf(c) === i); // unique

      // sections
      const sectionEls = Array.from(
        document.querySelectorAll(
          '[class*="section"], [class*="label"], [data-section-name], [class*="Section"]',
        ),
      );
      const sections = sectionEls
        .map(
          (el) => el.innerText?.trim() || el.getAttribute('data-section-name'),
        )
        .filter((s) => s && s.length > 0 && s.length < 50)
        .filter((s, i, arr) => arr.indexOf(s) === i);
      const sectionsBtn = Array.from(
        document.querySelectorAll('button, [class*="button"]'),
      ).find((el) => el.innerText?.trim().toLowerCase().startsWith('sections'));
      const sectionsCountMatch = sectionsBtn?.innerText?.match(/\d+/);
      const sections_count = sectionsCountMatch
        ? parseInt(sectionsCountMatch[0], 10)
        : null;

      // likes
      const saveBtn = Array.from(document.querySelectorAll('button')).find(
        (el) =>
          el.innerText?.trim().toLowerCase() === 'save' ||
          el.innerText?.trim().toLowerCase().startsWith('save'),
      );
      const saveBtnCount = saveBtn
        ?.querySelector('[class*="count"], span:last-child')
        ?.innerText?.trim();
      const likes = saveBtnCount
        ? parseInt(saveBtnCount.replace(/[^\d]/g, ''), 10)
        : saves;

      return {
        id,
        title,
        url: postUrl,
        external_url,
        views,
        likes,
        saves,
        published_at,
        tags,
        colors,
        sections,
        sections_count,
        parsed_at: new Date().toISOString(),
      };
    }, url);

    log(
      `Post parsed: "${data.title}" | tags: ${data.tags.length} | colors: ${data.colors.length} | saves: ${data.saves}`,
    );
    return data;
  } catch (err) {
    error(`Failed to parse post: ${url}`, err);
    return null;
  }
}

module.exports = { parsePost };
