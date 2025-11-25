# Repository Guidelines

## Project Structure & Flow
- UI code in `src/`: `components/` (BattleViewport, ActionPanel, TeamBuilder), `hooks/` (Dex/catalog + manual battle), `utils/` (team payload + sprite loader), `data/` (seed teams), `types/` (shared models).
- Vendored simulator + Dex live in `vendor/pokemon-showdown/` and are loaded with `ts-node` from `vite.config.ts`; endpoints exposed: `/api/catalog`, `/api/simulate`, `/api/manual/start|state|command`. Edit vendor only when you need sim logic tweaks.
- Assets: `src/assets/images/pokemon/` sprite atlases, `public/` static, `dist/` build output (ignore in VCS).

## Runtime Behavior
- On load, `useDexCatalog` GETs `/api/catalog` to fill dropdowns; failures usually mean missing deps (`ts-chacha20`).
- TeamBuilder builds payloads with `buildTeamsPayload`. `/api/simulate` runs AI vs AI once; `/api/manual/start` spins a persistent battle with SmartAI on `p2`, returning `{id,state}`. `/api/manual/command` posts your move/switch back to the stream.
- `BattleViewport` turns log lines into bubbles and pulls sprites by `spriteId` from the catalog; `ActionPanel` renders moves/switches from the active request.

## Build, Dev, and Lint
- `npm run dev` — Vite dev server with middleware; add `--host --port 5174` if needed.
- `npm run lint` — ESLint flat config (ignores `dist` and `vendor`).
- `npm run build` — `tsc -b` then `vite build`.
- `npm run preview` — serve the built bundle locally.

## Coding Style & Conventions
- TypeScript + React strict; avoid `any` except when wrapping vendor types. Components PascalCase, hooks `useX`, helpers in `utils/`, shared shapes in `types/`.
- Use `useMemo`/`useCallback` for derived lists and callbacks (see `App.tsx`). Keep single quotes/indent as-is; no autoformatter beyond ESLint.

## Testing & Smokes
- No automated tests. Manual loop: `npm run dev`, confirm `/api/catalog` succeeds (no 500 in console), click “Simular batalla” for `/api/simulate`, then “Iniciar batalla manual” to see `|smartai|` lines and sprites/HP bars update; send a command and verify log grows.
- Watch dev console for middleware stack traces from `vite.config.ts` (ts-node loading vendor files).

## Commit & PR Etiquette
- Use clear, imperative commits (e.g., `Fix manual battle command dispatch`). Call out any changes under `vendor/`.
- PRs: describe scope, link issues, list commands run, add screenshots/GIFs for UI changes. Never commit `dist/`, `node_modules/`, or generated assets; keep vendored bumps isolated and justified.
 |