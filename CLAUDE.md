# Hephaestion — working notes for Claude

## Publishing (standing instruction from the owner)
Always publish changes: after a round of work is committed and pushed to the working branch, open a pull request
into `main`, merge it, and confirm the "Deploy to GitHub Pages" run succeeds. The live site is
https://m1key9.github.io/Hephaestion/. Don't ask the owner to merge.

## The app
A private, phone-first life companion (PWA, all data on-device in IndexedDB via Dexie):
Home (today, deadlines, latest reflection) → the field (endless grey plane, one month per row) → day panel.
Deadlines export to the phone calendar (.ics). Claude writes weekly reflections, monthly chapters and a living
arc using the owner's own API key, stored only on the device, behind a monthly budget. Sealed notes are never sent.

## Commands
- `npm test` (vitest) and `npm run build` (tsc + vite) must pass before publishing.
- `npm run dev` for local development.

## Style the owner wants
Muted grey field with drifting particles; sleek sans (Instrument Sans); violet `#8f6bff` as the one accent;
soft rounded UI, not boxy or uniform. No concrete textures, no serif, no orange/red accents.
