# Progress

| Item | Value |
| --- | --- |
| Current phase | M1 Ledger core complete (report `docs/reports/PHASE-M1.md`); M0 and M1 in review on PR #1 |
| Current block | M1.4 done; M1 phase report posted |
| Last approved block | Continuous mode from M0.2 on (Foday 2026-11-04): next block starts automatically once pushed and CI is green |
| State | **Waiting for Foday's approval to start M2** (phases need approval) |
| Next step | On approval: M2 phase plan check, then M2.1 Customers |

## Session start checklist (cloud container)

1. Read `CLAUDE.md`, the SPEC sections for the current block, and this file.
2. Start Docker if it is not running: `dockerd > /tmp/dockerd.log 2>&1 &` then `docker info`. If Supabase containers come back unhealthy after a restart: `pnpm supabase stop --no-backup` then `pnpm db:start`.
3. `pnpm install`, `pnpm db:start` (applies migrations and seeds), `pnpm env:local` (writes `.env.local`); `pnpm test:db` for pgTAP, `pnpm build && CI=1 pnpm test:e2e` for e2e.
4. Work is safe only once pushed; the container is temporary.

## Log

| Date | Phase / block | Event |
| --- | --- | --- |
| 2026-11-03 | Phase 0 | Kit extracted and verified; mock-up zip identical; vectors match SPEC 12; toolchain checked; SKILL_MAP, QUESTIONS (B-01..B-21), Phase 0 report written |
| 2026-11-04 | Phase 0 | Plan approved; R-01..R-11 and B-01, B-02, B-03, B-11 answered (see `docs/reports/PHASE-0.md` section 9) |
| 2026-11-04 | M0.1 | Next.js 16 scaffold, MSI tokens, next-intl, format module, Vitest, Playwright + axe, screenshot tool, CI, security scans, Dependabot |
| 2026-11-04 | M0.2 | Local Supabase, 5 migrations (roles, environment, business clock, branches, profiles, settings, hash-chained audit log, document sequences, RLS and grants), admin RPCs, seed_core, 70 pgTAP tests, CI database job |
| 2026-11-04 | M0.3 | Sign-in, sign-out, proxy session refresh and 12-hour limit, route map and page guard, public_branding, e2e global setup with role fixtures, 32 e2e checks |
| 2026-11-04 | M0.4 | App shell: sidebar, top bar, phone header and bottom tabs with More sheet, role-aware navigation, logo via signed URL, skeleton/error states, skip link; 39 e2e checks |
| 2026-11-04 | M0.5 | /settings for the admin: company header, logo upload, reminder texts, branches, rule settings, demo clock, users (create, edit, deactivate, reset password); null-setting fix; 75 e2e checks |
| 2026-11-04 | M0.6 | /audit screen, seed:demo (M0 part), phase checks, security review (no findings), M0 phase report |
| 2026-11-04 | M1.1 | accounts (SPEC 6.1) with branch cash accounts, journals and journal_lines with balance, one-sided, immutable, same-transaction and hash-chain invariants; T-20, T-21; global function grant fix |
| 2026-11-04 | M1.2 | period_locks, next_number (B-02 global loans, B-03 6-digit EXP), set_sequence_start, post_journal with all SPEC 6.3 checks; T-22; 132 database tests |
| 2026-11-04 | M1.3 | /ledger (journals with lines, filters, pagination; trial balance with balanced check), trial_balance() function, ScrollRegion a11y fix; 139 DB tests, 97 e2e checks |
| 2026-11-04 | M1.4 | approval_requests, request_manual_journal (dry-run validation), manual journal tab on /ledger, resolver nesting fix, data-independent DB tests; M1 phase report |
