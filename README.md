# Hephaestion

A companion for tracking the facets of your days and reflecting on them.

Every box is a day. Days sit in an endless 3D field: one column per year, Monday to Sunday across and January to December going down. Each thing you track stacks a colored layer onto that day, so streaks and gaps show up as terrain.

## What it is

A holistic companion that lives on your phone.

- **Home**: today's habits as quick taps, a note for today, your next deadlines with countdowns, and the latest reflection from your arc. From here you enter the field.
- **The field**: one endless muted-grey plane of tiles with dust drifting through it. Your days sit in it one month per row, from your chosen first day onward. Marked days lift slightly and carry a stripe for each tracker. Zoom out and month and year names surface; zoom far enough and it lies flat like a map (the 2D/3D button switches by hand).
- **Trackers**: anything, any color. A single tap by default, optionally counted, optionally with details (number, time, 1–5 scale, text).
- **Deadlines**: the few dates that matter, with countdowns on Home and a violet ring in the field. "Add to calendar" hands each one to your calendar app with a reminder, so your phone does the alerting.
- **Your arc (Claude)**: with your own Anthropic API key, Claude writes a short reflection each week, a chapter each month, and a living portrait of who you're becoming (an archetype, tensions, what's growing, a mood line). Sealed notes are never sent. A monthly budget in Settings stops it before you overspend; a typical month costs about $0.25.
- **Private**: everything is stored on the device in IndexedDB. Export a backup from Settings (your API key is never included).

## Live site

Every push to `main` deploys to GitHub Pages at https://m1key9.github.io/Hephaestion/ (`.github/workflows/deploy.yml`). One-time setup: repository **Settings → Pages → Source: GitHub Actions**.

## Development

```bash
npm install
npm run dev      # http://localhost:5173 (also exposed on your LAN)
npm test
npm run build    # outputs static files to dist/
```

Stack: Vite, React, TypeScript, three.js (via @react-three/fiber), Dexie (IndexedDB), vite-plugin-pwa. Type is Instrument Sans; violet (#8f6bff) is the accent.
