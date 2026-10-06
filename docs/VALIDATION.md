# Stage 1 validation

- `npm ci` inputs: package.json and the generated package-lock.json are included; dependencies use the public npm registry.
- `npm run check`: passed, zero Svelte errors or warnings.
- `npm test`: passed, 10 tests including nested database tests.
- `npm run build`: passed using an explicitly fake anon-role test key and placeholder test project URL. This validates compilation and base paths, not a live Supabase connection. The test configuration and build output are not included in the downloadable package.
- Actual schema execution: migration runs twice in isolated PostgreSQL (PGlite), including profile trigger/backfill, RLS grants/policies, owner isolation, storage restrictions, duplicate prevention and cross-user book deletion cascades.
- Browser preview: attempted, but the browser tool timed out. Visual behavior and touch layout remain to be checked on real devices.
- Live Supabase Auth, production token refresh, real Storage API operations and GitHub Pages deployment: not exercised because no project configuration or repository was supplied.

Follow the Stage 1 checklist in README.md after creating the project and accounts. Do not proceed to Stage 2 until the user has tested this stage.
