# Landbook Parser

Landbook Parser is a long-running worker for parsing Land-book pages, downloading page images, sending them to x6sense moderation, and storing anti-duplicate and statistics data in SQLite.

## What it does

- Parses Land-book listing pages
- Skips already processed posts by `source_url`
- Collects post metadata:
  - `id`
  - `title`
  - `url`
  - `external_url`
  - `published_at`
  - `views`
  - `likes`
  - `saves`
  - `tags`
  - `colors`
  - `sections`
  - `sections_count`
  - `parsed_at`
- Downloads page images:
  - `desktop.webp`
  - `mobile.webp` when available
- Uploads only the desktop image to x6sense moderation
- Keeps the mobile image and internal pages inside `meta.case`
- Removes local images after successful delivery
- Stores processed posts and stats in SQLite
- Exposes a small status server with `/health` and `/statistics`

## Architecture

- `worker.js` - long-running parser worker, no HTTP port
- `server.js` - status server entrypoint
- `statusServer.js` - `/health` and `/statistics`
- `sqliteStore.js` - local SQLite storage for anti-duplicate and stats
- `index.js` - parsing logic for a single post and x6sense delivery

## Flow

1. Worker opens the Land-book list page.
2. It collects new post URLs.
3. Before parsing a post, it checks SQLite:
   - if `source_url` already exists, the post is skipped
4. For each new post:
   - parses metadata
   - downloads page images
   - uploads the desktop image to x6sense
   - sends one moderation request per post
   - saves the post into SQLite after successful delivery
   - deletes local images after success
5. Worker sleeps and repeats.

If the daily limit is reached, the worker pauses until the next day.

## x6sense payload

Only the desktop image is sent to moderation.

Moderation content:

```json
{
  "files": ["file-id"],
  "sourceUrl": "https://land-book.com/websites/47635-old-riga-kvest",
  "type": "image",
  "parser": "LANDBOOK",
  "meta": {
    "id": "47635",
    "title": "193 likes",
    "url": "https://land-book.com/websites/47635-old-riga-kvest",
    "external_url": "https://rigakvest.com/en?ref=land-book.com",
    "desktop_image_url": "https://cdn.land-book.com/image/1140x0/website/47635/example.webp",
    "mobile_image_url": "https://cdn.land-book.com/image/1140x0/website/47635/example-mobile.webp",
    "published_at": "Jun 23",
    "views": 23513,
    "saves": 265,
    "tags": ["Landing", "Tech"],
    "colors": ["#F6F9F9"],
    "case": {
      "parent_url": "https://land-book.com/websites/47635-old-riga-kvest",
      "parent_id": "47635",
      "parent_title": "Old Riga KVEST",
      "mobile": {
        "id": "47635",
        "title": "Old Riga KVEST",
        "url": "https://land-book.com/websites/47635-old-riga-kvest",
        "external_url": "https://rigakvest.com/en?ref=land-book.com",
        "image_url": "https://cdn.land-book.com/image/1140x0/website/47635/example-mobile.webp",
        "desktop_image_url": "https://cdn.land-book.com/image/1140x0/website/47635/example.webp",
        "mobile_image_url": "https://cdn.land-book.com/image/1140x0/website/47635/example-mobile.webp",
        "published_at": "Jun 23",
        "views": 23513,
        "saves": 265,
        "tags": ["Landing", "Tech"],
        "colors": ["#F6F9F9"],
        "pages": [],
        "pages_count": 0,
        "sections": [{ "name": "Hero", "y": 0, "height": 920 }],
        "sections_count": 1,
        "parsed_at": "2026-04-16T15:12:55.634Z",
        "variant": "mobile"
      },
      "pages": [
        {
          "id": "31048",
          "title": "Give a Rae - Get Yours Free",
          "url": "https://land-book.com/websites/31048-give-a-rae-get-yours-free-rae-wellness",
          "external_url": "https://raewellness.co/pages/give-a-rae",
          "image_url": "https://cdn.land-book.com/image/1140x0/website/31048/example.webp",
          "desktop_image_url": "https://cdn.land-book.com/image/1140x0/website/31048/example.webp",
          "mobile_image_url": null,
          "published_at": "Jun 23",
          "views": 0,
          "saves": 0,
          "tags": ["Landing"],
          "colors": ["#FFFFFF"],
          "pages": [],
          "pages_count": 0,
          "sections": [{ "name": "Hero", "y": 0, "height": 700 }],
          "sections_count": 1,
          "parsed_at": "2026-04-16T15:12:55.634Z",
          "variant": "page",
          "parent_url": "https://land-book.com/websites/47635-old-riga-kvest"
        }
      ],
      "pages_count": 1
    },
    "sections": [{ "name": "Hero", "y": 0, "height": 920 }],
    "sections_count": 1,
    "parsed_at": "2026-04-16T15:12:55.634Z"
  }
}
```

Notes:

- One moderation request is sent per post.
- Only the desktop image goes to moderation.
- Mobile and pages stay in `meta`.

## Storage

SQLite database path:

```text
data/landbook.sqlite
```

Tables:

- `parsed_posts`
  - `source_url` - unique key for anti-duplicate checks
  - `file_id`
  - `parsed_at`
- `stats`
  - daily counters for `parsed`, `delivered`, `failed`

## Local setup

### 1. Install dependencies

```powershell
npm install
```

### 2. Configure environment

Use the local `.env` file.

Recommended variables:

```env
LANDBOOK_EMAIL=your_email
LANDBOOK_PASSWORD=your_password
X6SENSE_API_KEY=your_api_key
X6SENSE_API_BASE_URL=your_url
HEADLESS=false
SKIP_DELIVERY=false
LIST_LIMIT=200
DAILY_LIMIT=200
CYCLE_SLEEP_MS=60000
ERROR_SLEEP_MS=120000
```

### 3. Run the worker

```powershell
npm run worker
```

or

```powershell
npm start
```

### 4. Run the status server

```powershell
npm run status
```

Default endpoints:

- `http://localhost:3000/health`
- `http://localhost:3000/statistics`

If needed, you can override the port with `PORT` or `STATUS_PORT`.

### 5. Reset SQLite

```powershell
npm run db:reset
```

This clears `data/landbook.sqlite` and recreates the schema.

## Docker

Docker uses a separate `.env.docker` file. A safe template is provided as `.env.docker.example`.

### Run both services

```powershell
docker compose up --build
```

### Run only the worker

```powershell
docker compose up --build worker
```

### Run only the status server

```powershell
docker compose up --build status
```

Docker notes:

- worker runs without an HTTP port
- status server listens on port `3000`
- `data/` is mounted as a volume and stores SQLite
- `images/` is mounted as a volume and stores downloaded images
- local Windows cache paths are not needed inside Docker

## Useful commands

Check health:

```powershell
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing | Select-Object -ExpandProperty Content
```

Check statistics:

```powershell
Invoke-WebRequest http://localhost:3000/statistics -UseBasicParsing | Select-Object -ExpandProperty Content
```

Check statistics for a specific date:

```powershell
Invoke-WebRequest "http://localhost:3000/statistics?date=2026-04-16" -UseBasicParsing | Select-Object -ExpandProperty Content
```

## Environment variables

Main variables:

- `LANDBOOK_EMAIL`
- `LANDBOOK_PASSWORD`
- `X6SENSE_API_KEY`
- `X6SENSE_API_BASE_URL`
- `SKIP_DELIVERY`
- `HEADLESS`
- `LIST_LIMIT`
- `DAILY_LIMIT`
- `CYCLE_SLEEP_MS`
- `ERROR_SLEEP_MS`
- `PORT`
- `STATUS_PORT`
- `PUPPETEER_EXECUTABLE_PATH`
- `CHROME_PATH`

## Notes

- `SKIP_DELIVERY=true` disables x6sense requests, but the post is still marked as processed so the worker does not loop on the same items.
- Local images are deleted only after successful delivery.
- The parser is intended to run 24/7 as a worker process.
