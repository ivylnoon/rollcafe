# Hex Cafe — main site and live color map

This folder is the deployable static site for **https://hexcafe.vercel.app/**. The minimal dark homepage puts the interactive color map first, with practical color tools and the community screenshot gallery below it.

## Publish on Vercel

1. Import this repository into Vercel, or deploy this directory as the project root (`color-map/`).
2. Use the default static output; there is no build command and no Node runtime requirement.
3. Keep the project domain set to `hexcafe.vercel.app` so the canonical URL, Open Graph tags, and sitemap stay consistent.
4. Deploy the updated `color-api/` PHP file to the existing archive host before the site if the current API does not yet support `action=stats` and `action=page`.

## Map performance

- `index.html` requests a count first, then reads the append-only archive in bounded byte-cursor pages. Each page returns compact `HEX+tier` values, not usernames, timestamps, or the complete archive object array.
- The PHP API builds a tiny count sidecar once, updates it under the existing writer lock, and reads each page from the stored byte offset. The compatibility `action=drops` response is kept for small clients only and is refused above 50,000 records.
- The browser stores RGB/tier bytes in typed arrays and draws the mosaic with a WebGL 2 texture rather than one DOM element or Canvas draw call per drop. Pages are uploaded progressively; users can pause/resume the transfer, pan, zoom, filter tiers, look up exact hex values, and jump to a random loaded drop.
- The map uses the complete archive up to the device texture/memory cap. For larger archives it chooses a deterministic stride so the rendering stays within the available GPU budget. The configured path keeps 5 million records at full resolution on ordinary WebGL 2 devices; the PHP page reader was stress-tested with a synthetic 5,000,001-record archive, while a production browser/GPU run at that size remains to be verified after deployment.
- If the API is not updated yet, the browser can fall back to a small legacy `action=drops` response. The compatibility route is capped at 50,000 records; oversized responses are rejected instead of loading the whole archive into the page.

The current public API URL is embedded in `index.html`. No write key is used by this public site; the bot remains the authenticated archive writer.

## SEO and accessibility

`index.html` contains its title/description, canonical URL, Open Graph/Twitter metadata, JSON-LD website/application description, semantic headings, alt text, skip link, accessible buttons, reduced-motion styling, and mobile safe-area spacing. `robots.txt` and `sitemap.xml` point search engines to the production origin. The page is standalone: styles/scripts are inline and screenshot assets are local.

## Contents

- `index.html` — map-led, responsive Hex Cafe public website.
- `assets/` — local supplied screenshots and share-preview image.
- `robots.txt`, `sitemap.xml`, `vercel.json` — crawler and static-host settings.
