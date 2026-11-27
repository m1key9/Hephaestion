# Hephaestion

A companion for tracking the facets of your days and reflecting on them.

Every box is a day. Days sit in an endless 3D field: one column per year, Monday to Sunday across and January to December going down. Each thing you track stacks a colored layer onto that day, so streaks and gaps show up as terrain.

## What works now (Phase 1)

- **Field of days**: pan and pinch through years of days. The field swells slowly, and a darker lattice drifts underneath so scrolling has parallax. Tap a day to open it.
- **3D or flat, like a map**: pinch far enough out and the field lies down into a flat 2D map, where each day's marks become stripes across its tile. The 2D/3D button in the corner switches by hand and remembers your choice.
- **Trackers you define**: name anything (Latin, the gym, a bad night's sleep) and give it any color. A tracker is a single tap by default. Turn on **Count it** for things that happen more than once a day. You can optionally give it details: a number with a unit, a time, a 1–5 scale, or a short text. Details are never required. Reorder, archive or delete trackers from the Trackers screen, or add one fast with the **+** chip.
- **Notes**: short posts attached to a day. A note can be **sealed**, which means it will never be sent to AI reflections once those exist.
- **Streaks**: each tracker chip shows its current streak. Tap a chip to filter the field to that tracker alone.
- **Private by default**: everything is stored in your browser's IndexedDB on your device. Nothing is uploaded. You can export or restore a JSON backup from the ≡ menu.
- **Installable**: it's a PWA, so you can add it to your phone's home screen and it works offline.

## Roadmap

1. ~~Field, trackers, notes, streaks~~
2. Hosting and encrypted sync between phone and laptop
3. AI reflections: weekly rundowns of what you wrote, and echoes from the same time in the past (on hold)
4. Arcs: long-range themes and how they shift

## Live site

Every push to `main` deploys to GitHub Pages at https://m1key9.github.io/Hephaestion/ (`.github/workflows/deploy.yml`). One-time setup: repository **Settings → Pages → Source: GitHub Actions**.

## Development

```bash
npm install
npm run dev      # http://localhost:5173 (also exposed on your LAN)
npm test
npm run build    # outputs static files to dist/
```

Stack: Vite, React, TypeScript, three.js (via @react-three/fiber), Dexie (IndexedDB), vite-plugin-pwa. Type is EB Garamond.
