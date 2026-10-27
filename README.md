# Film Logbook

A mobile-first, offline-capable PWA for logging analog film frame by frame. No framework, no build step, no account.

## Run it

Any static file server works. Locally:

    python3 -m http.server 8000   # then open http://localhost:8000

To install it on a phone, host the folder over HTTPS (GitHub Pages, Netlify, Cloudflare Pages), open it in Safari/Chrome and choose **Add to Home Screen**. After the first load it works with no connection.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `app.js` | Data model, storage, all screens |
| `app.css` | Design tokens and styles (light + "darkroom" dark theme) |
| `sw.js` | Service worker: caches the app for offline use |
| `manifest.webmanifest`, `icons/` | Installability |

## Data model

Stored as one versioned JSON document in `localStorage` (`filmlog:db`), with the previous save kept at `filmlog:db:prev` for recovery.

- **Roll**: `id, format, frameCapacity, extraFrames, filmBrand, filmStock, boxIso, shootingIso, exposureApproach (box|push|pull), exposureStops, processingStops, processingInstructions, cameraId, cameraName, startedAt, completedAt, status (active|completed|archived), notes, cursor, pendingMulti`
- **Frame** (physical): `id, rollId, number`. Unique per roll; exists only while it has exposures.
- **Exposure**: `id, frameId, rollId, sequence, aperture, shutter, weather[], subject, notes, createdAt, updatedAt`
- **Camera**: `id, name, format, shutters[] (exact speeds offered, e.g. 1/300…1/25), fastest, slowest, bulb, minF, maxF, hidden`
- **Scan** (reserved for later): `id, rollId, frameId, frameNumber, exposureId?, uri, addedAt`

`addExposure()` refuses to write to a logged frame unless explicitly appending a multiple exposure, so frames can't be silently overwritten.

## Backup and sync

Settings (Rolls → gear) exports a full JSON backup, a CSV of every exposure, and restores from a backup after validating it. Every change is also recorded in `db.outbox`; to add cloud sync later, set `Sync.endpoint` in `app.js` and the queued changes are sent when the device is online. To move to IndexedDB or a server database, replace `Store.load/save`; the rest of the app only touches `Store.db`.
