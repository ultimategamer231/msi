# Progress

| Item | Value |
| --- | --- |
| Current phase | M0 Foundation |
| Current block | M0.5 Settings and user management (done, pushed) |
| Last approved block | Continuous mode from M0.2 on (Foday 2026-11-04): next block starts automatically once pushed and CI is green |
| State | M0.5 pushed; next block starts when CI is green |
| Next step | M0.6 Audit log screen, M0 demo seed and phase checks (then the M0 phase report) |

## Session start checklist (cloud container)

1. Read `CLAUDE.md`, the SPEC sections for the current block, and this file.
2. Start Docker if it is not running: `dockerd > /tmp/dockerd.log 2>&1 &` then `docker info`.
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
