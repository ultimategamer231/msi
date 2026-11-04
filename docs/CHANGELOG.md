# Changelog

All notable changes, one section per phase. Format follows Keep a Changelog.

## [M0 Foundation] unreleased
### Added
- M0.1: Next.js 16 (App Router, TypeScript strict) project with pnpm, MSI design tokens (Tailwind 4, shadcn/ui variables), Inter with tabular figures, next-intl with `messages/en.json`, designed not-found and error pages.
- M0.1: `src/lib/format.ts` for money (integer cents via BigInt), rates (basis points), shares and dates (Africa/Monrovia), with 33 unit tests.
- M0.1: ESLint rules that forbid floats for money and `any`; Prettier; Vitest; Playwright at 390 and 1280 px with axe checks; `scripts/screenshots.ts` with mock-up comparison mode.
- M0.1: GitHub Actions CI (format, lint, typecheck, unit, build, audit; e2e on PRs), gitleaks and CodeQL scans, Dependabot.
- M0.1: Baseline security headers.
- M0.2: Local Supabase (Postgres 17) with sign-up disabled, 10-character passwords, 12-hour sessions, private `branding` bucket.
- M0.2: Migrations for roles, deployment environment, business clock (`app_now`, `business_today`), branches, profiles (managers may have no branch), settings with validation, hash-chained append-only `audit_log`, `document_sequences`, RLS on every table and explicit function grants.
- M0.2: Admin RPCs `update_setting`, `upsert_branch`, `admin_set_profile`, each audited with before and after; `verify_audit_chain` for integrity checks.
- M0.2: `seed_core.sql` (branches, MSI company header, A-01..A-20 rule settings, reminder templates); 70 pgTAP tests; CI database job with PL/pgSQL lint and a generated-types check.

## [Phase 0] 2026-11-03
### Added
- Project kit extracted into the repository: `CLAUDE.md`, `docs/SPEC.md`, `docs/DEMO_DATA.md`, `docs/ASSUMPTIONS.md`, `docs/QUESTIONS.md`, `docs/mockups/`, `public/brand/`, `tools/vectors.py`.
- `docs/SKILL_MAP.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/reports/PHASE-0.md`.
- Builder questions B-01..B-21 in `docs/QUESTIONS.md`.
- `.gitignore`.
