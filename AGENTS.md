# Repository Guidelines

## Project Structure & Module Organization

Domain behavior is specified in `docs/specs/` (state machine, data model, exceptions, tool contracts, WhatsApp templates) and the target architecture in `docs/EXECUTION_PLAN.md`. Specs are the source of truth: no behavior change without updating the relevant spec first. The current code is a prototype kept as behavior reference; see `CLAUDE.md` for its known limitations.

This repository has two deployable parts:

- `server.js`: Node.js webhook for WhatsApp-style proveeduria workflows. It defines the HTTP server, Anthropic client, Supabase client, tool schemas, and handlers in one file.
- `dashboard/`: React dashboard built with Vite, React Router, Tailwind CSS, and Supabase anon reads. Pages live in `dashboard/src/pages/`, shared helpers in `dashboard/src/utils/`, and Supabase setup in `dashboard/src/supabaseClient.js`.
- `contratistas_ddl.sql` and `dashboard_rls.sql`: Supabase schema, views, indexes, triggers, and dashboard read policies. Apply them manually through the Supabase SQL editor in the documented order.
- `.github/workflows/`: Azure deployment workflows for the webhook and static dashboard.

## Build, Test, and Development Commands

Run root commands from the repository root:

- `npm install`: install webhook dependencies.
- `npm start`: run `server.js` locally. Set environment variables first.
- `npm run build --if-present`: matches the Azure workflow; currently no root build step is defined.
- `npm run test --if-present`: matches the Azure workflow; currently no root tests are defined.

Run dashboard commands from `dashboard/`:

- `npm install`: install frontend dependencies.
- `npm run dev`: start the Vite development server.
- `npm run build`: build the static dashboard into `dashboard/dist/`.
- `npm run preview`: preview the build locally.

## Coding Style & Naming Conventions

Use JavaScript for backend and frontend. The backend uses CommonJS `require`; the dashboard uses ES modules and JSX. Keep indentation at two spaces, prefer single quotes, and follow existing Spanish domain names for tools, tables, and user-facing copy. React components use PascalCase, for example `ProjectDashboard.jsx`; helpers use camelCase exports such as `formatColones`.

## Testing Guidelines

No test framework is configured yet. When adding behavior, include focused tests before relying on manual checks. Suggested placement: backend tests under `tests/` and dashboard tests beside components or under `dashboard/src/__tests__/`. At minimum, run `npm start` for webhook smoke checks and `npm run build` in `dashboard/` before a PR.

## Commit & Pull Request Guidelines

Recent history uses short, direct subjects such as `Contratistas dashboard y voz` and `Update package.json and server.js...`. Keep commits concise and action-oriented. Pull requests should describe the behavior change, list manual verification commands, link any relevant issue, and include screenshots when dashboard UI changes.

## Security & Configuration Tips

Do not commit `.env`, logs, Supabase service keys, Anthropic keys, or Azure secrets. Root runtime expects variables such as `ANTHROPIC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_KEY`; the dashboard expects `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
