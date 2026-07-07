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
