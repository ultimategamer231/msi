# Progress

| Item | Value |
| --- | --- |
| Current phase | M0 Foundation |
| Current block | M0.2 Local Supabase and foundation schema (done, report posted) |
| Last approved block | M0.1 (approved 2026-11-04) |
| State | M0.2 pushed to PR #1, **waiting for Foday's approval to start M0.3** |
| Next step | On approval: M0.3 Authentication, sessions and route guard |

## Session start checklist (cloud container)

1. Read `CLAUDE.md`, the SPEC sections for the current block, and this file.
2. Start Docker if it is not running: `dockerd > /tmp/dockerd.log 2>&1 &` then `docker info`.
3. `pnpm install`, then `pnpm db:start` (applies migrations and seeds); `pnpm test:db` for the pgTAP suite.
4. Work is safe only once pushed; the container is temporary.

## Log

| Date | Phase / block | Event |
| --- | --- | --- |
| 2026-11-03 | Phase 0 | Kit extracted and verified; mock-up zip identical; vectors match SPEC 12; toolchain checked; SKILL_MAP, QUESTIONS (B-01..B-21), Phase 0 report written |
| 2026-11-04 | Phase 0 | Plan approved; R-01..R-11 and B-01, B-02, B-03, B-11 answered (see `docs/reports/PHASE-0.md` section 9) |
| 2026-11-04 | M0.1 | Next.js 16 scaffold, MSI tokens, next-intl, format module, Vitest, Playwright + axe, screenshot tool, CI, security scans, Dependabot |
| 2026-11-04 | M0.2 | Local Supabase, 5 migrations (roles, environment, business clock, branches, profiles, settings, hash-chained audit log, document sequences, RLS and grants), admin RPCs, seed_core, 70 pgTAP tests, CI database job |
