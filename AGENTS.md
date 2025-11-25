# Repository Guidelines

## Project Structure & Module Organization
- `src/main.tsx`, `App.tsx`, `index.css` bootstrap the React/Vite app and service worker registration.
- `src/components`: UI and Phaser bridge (`PhaserCanvas.tsx`, `PokemonActionPanel.tsx`, `CameraControlsUI.tsx`, etc.) with paired CSS.
- `src/phaser`: game scene logic (`PlaygroundScene.ts`, `PokemonFxManager.ts`).
- `src/data`: static Pokemon moves/species data; large files (`pokedex.ts`, `moves.ts`) should stay type-safe and immutable.
- `scripts/parse_pokemon_map.py`: helper for generating map data from assets.
- `public`: assets (`pokemon/`, `draco/`, fonts) and `sw.js` that caches models; `dist/` is build output.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Node 18+ recommended).
- `npm run dev`: start Vite dev server with React Fast Refresh.
- `npm run build`: type-check via `tsc` then build to `dist/`.
- `npm run preview`: serve the production build locally.
- Optional: `npx tsc --noEmit` when editing data/TS files to catch type breaks.

## Coding Style & Naming Conventions
- TypeScript strict mode is on; fix unused locals/params rather than suppressing.
- Functional components in PascalCase, helpers in `camelCase`, data constants in `SCREAMING_SNAKE_CASE` where shared.
- Keep 2-space indentation, single quotes, and named exports when feasible; default exports only for entry points.
- Co-locate CSS with its component; prefer semantic class names over generic ones.

## Testing Guidelines
- No automated tests yet; before pushing, run `npm run build` and exercise key flows in `npm run dev` (scene load, camera controls, move playback, species swap).
- When changing data/assets, verify the service worker (`sw.js`) still loads files; clear cache if assets are renamed.

## Commit & Pull Request Guidelines
- Prefer imperative, scoped messages (e.g., `feat: add alakazam animations`, `fix: clamp camera orbit`). Avoid generic “add”.
- For PRs, include summary, screenshots or clips of new interactions, manual test notes, and asset size/placement if `public/` changes.
- Link related issues/tasks, keep changes atomic, and avoid committing build artifacts or `node_modules`.

## Deployment & Configuration
- Vercel config lives in `vercel.json` and `.vercel/`; align preview settings with Vite base path if it changes.
- Large assets can slow deploys; compress before adding to `public/` and document any new cache keys in `sw.js`.
