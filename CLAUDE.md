# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

WhatsApp-operated procurement system ("proveeduría") for Proyekta, a Costa Rican construction company. The current code is a **working prototype**; the production system (Módulo 1) is being built against the specs in `docs/`. Two deployable parts today:

- `server.js` — single-file Node.js webhook (no framework, raw `http`): Meta WhatsApp Cloud API in/out, a Claude agentic tool-use loop, Supabase reads/writes, image/PDF handling (Claude Vision), voice transcription (OpenAI Whisper), a daily-summary cron, and HS256 dashboard-token signing. Adding a capability = add a tool schema to `TOOLS` + a case in `handleTool()`; role restrictions per tool live in `TOOL_ROLES`.
- `dashboard/` — React + Vite + Tailwind read-only dashboard (Supabase anon reads, token-gated project views).
- `contratistas_ddl.sql`, `dashboard_rls.sql` — Supabase schema/views/RLS, applied manually via the Supabase SQL editor.
- `.github/workflows/` — Azure deploys: webhook to App Service, dashboard to Static Web Apps.

## Source of truth: docs/specs/

`docs/EXECUTION_PLAN.md` defines the target architecture (Azure, Postgres state machine + outbox, queue worker). Domain behavior is specified in `docs/specs/` — **state-machine.md** (pedido states/transitions), **data-model.md**, **exceptions.md** (deterministic escalation rules), **tools.md** (agent tool contracts + prototype-parity table), **templates-whatsapp.md**. Rule: no behavior change without updating the relevant spec first. `server.js` is behavior reference only — do not grow it with new production features; the `registrar_contratista`/contract tools in it are out of Módulo 1 scope and must not be migrated.

## Módulo 1 monorepo (`apps/*`, `packages/*`)

The production system is being built as an npm-workspaces monorepo alongside the legacy prototype (which stays as behavior reference, untouched). New code is **TypeScript, ESM, NodeNext** — relative imports carry the `.js` extension, `import type` for types — under a strict `tsconfig.base.json`. Cross-package imports resolve via the workspace symlink to each lib's built `.d.ts`, so **libs build before apps** (`build:all` orders `core`/`db` first). Each package has its own `CLAUDE.md` with its invariants.

- `packages/core` — pure domain: state machine, correlative numbering, roles/permissions, approval policy, deterministic exception rules. No IO; time passed as a param; returns `Result<T,E>`. **Protected code** (AI_ASSISTED_DEVELOPMENT.md §2): update the spec first, keep tests exhaustive. `packages/core/src/types.ts` is the frozen domain type contract everything imports.
- `packages/db` — versioned plain-SQL migrations (`migrations/NNN_*.sql`) + idempotent seeds, applied by `scripts/migrate.mjs` (replaces manual Supabase SQL). Enforces append-only `audit_events` (row + statement/TRUNCATE triggers), the pedido transition trigger, correlative sequences, `wamid` uniqueness.
- `packages/agent` — Fase 2a en progreso. Ya contiene runtime de tools deterministas
  (`withTx`, repos PG/fakes, audit, outbox, approval) y las tools de pedido/RFQ/cotizacion:
  `crearPedido`, `confirmarPedido`, `sugerirProveedores`, `enviarRfq`, `registrarCotizacion`,
  `generarComparativo`. Aun faltan loop Claude, extractores reales y portal de pedidos.
- `apps/api` — production-safe webhook ingest: verify `X-Hub-Signature-256` → dedup by `wamid` → persist → enqueue → 200; fail-closed (missing secret or prod-without-queue refuses to start).
- `apps/worker` — queue-consumer stub plus Fase 2a domain handler/router: reads
  `inbound_messages`, resolves sender, creates `Ctx` for internal users, handles E11, and
  delegates to an injectable domain engine. Broker real, Claude loop and outbox dispatcher are
  still pending.

Commands (root): `npm install`; `npm run build:all`; `npm run typecheck`; `npm run test:all`; `DATABASE_URL=… npm run migrate && npm run seed`. CI is `.github/workflows/ci.yml` (build + typecheck + tests, plus an ephemeral-Postgres migration gate) — separate from the legacy Azure deploy workflows.

## Current implementation status

As of the latest Fase 2a work, the deterministic tool layer can execute the pedido path up
to `en_revision` in tests against real Postgres:

1. `crearPedido` creates `pedidos`/`pedido_items` in `borrador` with PED numbering.
2. `confirmarPedido` sets `confirmado_at`/`confirmado_por` and notifies Proveeduria.
3. `sugerirProveedores` returns an editable supplier ranking using active opt-in contacts.
4. `enviarRfq` writes `approval_events(lista_proveedores)`, `quote_requests`, RFQ outbox
   messages, and transitions `borrador -> cotizando`.
5. `registrarCotizacion` writes `quote_responses`/`quote_items`, handles E2 repregunta or
   review escalation, and transitions `cotizando -> en_revision` when all RFQs responded.
6. `generarComparativo` deterministically computes the item x supplier matrix from quote SQL,
   audits `generar_comparativo`, and enqueues the internal outbox notification. It also runs
   automatically in the same transaction when the last complete quote moves the pedido to
   `en_revision`.

The worker now has the domain handler/router seam, but the production Claude loop/extractors
and real broker/outbox dispatcher are not wired yet.
For navigation and future sessions, read `docs/CODEBASE_GUIDE.md` and
`docs/handoff/FASE2A-current-status.md` before continuing.

## Commands

Root (webhook):
- `npm install` && `npm start` — run `server.js` (requires env: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `OPENAI_API_KEY` for voice, `DASHBOARD_JWT_SECRET`).
- No tests or lint configured yet at root; CI runs `npm run build --if-present` and `npm run test --if-present`.

Dashboard (from `dashboard/`):
- `npm run dev` / `npm run build` / `npm run preview` (env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Run `npm run build` before any dashboard PR.

## Conventions

- Backend is CommonJS; dashboard is ESM/JSX. Two-space indent, single quotes.
- Domain language is **Spanish** — tool names, table names, user-facing copy, and the agent system prompt are all in Spanish (Costa Rican "vos" tone in WhatsApp replies). Keep it that way.
- React components PascalCase (`ProjectDashboard.jsx`); helpers camelCase (`formatColones`).
- Commits: short, direct subjects (e.g. `Contratistas dashboard y voz`).

## Known prototype limitations (do not replicate in new code)

- Conversation state is an in-memory `Map` (`server.js` ~line 956) — lost on restart.
- Webhook has no signature verification, no idempotency/dedup, and processes before persisting.
- Dashboard relies on broad anon RLS and client-side JWT decoding without signature verification (`dashboard/src/utils/jwt.js`).
- WhatsApp sends are fire-and-forget (no outbox/retry).

New production code must follow the controls in `docs/EXECUTION_PLAN.md` §1 instead (persist-then-process, outbox, signed webhooks, authenticated API, append-only audit).
