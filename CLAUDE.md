# LoanDesk (Method Solutions Inc. loan system) — project rules for Claude Code

Client: Method Solutions Inc. (MSI). Brand assets in `public/brand/`; colours and logo rules in SPEC "Branding (MSI)" and "Theming". User-facing names come from `settings.company`, never hard-coded.

Read `docs/SPEC.md` fully before writing code. It is the single source of truth. If code and spec disagree, stop and ask. Match screens to `docs/mockups/` (README maps each screen to its route and milestone) and seed from `docs/DEMO_DATA.md`. Open questions go to `docs/QUESTIONS.md`; client-pending defaults are tracked in `docs/ASSUMPTIONS.md`.

## Stack
Next.js App Router, TypeScript strict, Tailwind, shadcn/ui, Supabase (Postgres, Auth, Storage, RLS, pg_cron), `@react-pdf/renderer`, `qrcode`, `react-hook-form` + `zod`, `@tanstack/react-table`, `date-fns`, `next-intl` (English, translation-ready), `motion` (subtle motion only), Vitest, Playwright, pnpm. GitHub with branch per milestone and PR at each gate; GitHub Actions CI.

## Workflow
- Build one milestone at a time (SPEC section 13). At the end of each: tests green, `pnpm build` clean, screenshots at 390px and 1280px, short changelog, then STOP and wait for approval.
- Add environment variables only when a milestone needs them.
- Commit per block with a clear message (Conventional Commits). Push as soon as a block or phase is done and keep the phase's draft pull request up to date. Never push to `main` and never merge without approval.
- Continuous mode (Foday, updated 2026-11-04): inside a phase, when a block is pushed and CI is green, report it and start the next block automatically. At the end of a phase (phase report pushed, CI green) STOP and wait for Foday's approval before starting the next phase. Also stop for a failure that cannot be fixed within the block, or for an "ask first" item (money rules, schema/RPC contracts beyond the spec, security or permission changes, user-visible mock-up deviations, new scope, cost, anything irreversible).

## Non-negotiable rules
1. Money is integer cents (`bigint` in DB). Rates are integer basis points. No floats anywhere.
2. All money logic, status changes and approvals live in Postgres functions (`security definer`, `set search_path = public`) called with `supabase.rpc` from server actions. Never duplicate the formulas in TypeScript. The browser reads only.
3. Balances are derived from `journal_lines` (view `loan_balances`). Never store a balance column.
4. Posted journals, journal lines, audit rows and collateral events are immutable. Corrections are reversing journals.
5. Every table has RLS enabled. No insert/update/delete policies on money tables.
6. Every rule value (rates, limits, days) is a setting or product field, not a constant.
7. Requester and approver must differ (SELF_APPROVAL) and are checked in SQL.
8. Business dates are `date` in Africa/Monrovia (UTC+0). Format `05 Feb 2026`, money `$1,234.56`.
9. UI is mobile-first (360px minimum). 44px touch targets on `/field`.
10. Do not add features outside FR-01..FR-29. Anything else goes to `docs/QUESTIONS.md`.

## Commands (create these in M0)
```
pnpm dev | build | lint | typecheck
pnpm test            # vitest unit
pnpm test:db         # integration tests against local Supabase (supabase start)
pnpm test:e2e        # playwright
pnpm seed:demo       # demo data (demo environment only)
pnpm types           # regenerate src/types/database.ts from Supabase
```

## Definition of done (per milestone)
Acceptance tests named in SPEC section 13 pass; `tools/vectors.py` outputs match the SQL results; no `any`; no unhandled RPC error codes in the UI; empty, loading and error states exist; audit rows are written for every mutation.
