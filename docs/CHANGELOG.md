# Changelog

All notable changes, one section per phase. Format follows Keep a Changelog.

## [M1 Ledger core] unreleased
### Added
- M1.1: Chart of accounts (SPEC 6.1) with a cash account per branch created automatically; `journals` and `journal_lines` with the SPEC 6.3 invariants (balanced at commit, one-sided lines, immutable), lines only in the creating transaction, and journals joined to the hash chain (`verify_journal_chain`). Tests T-20, T-21.
### Fixed
- M1.1: New functions no longer get EXECUTE for PUBLIC by default.

## [M0 Foundation] 2026-11-04 (in review, PR #1)
### Added
- M0.6: `/audit` read-only audit log for manager, CEO and admin with filters and before/after changes; `pnpm seed:demo [--as-of]` creating the DEMO_DATA staff accounts through audited RPCs.
- M0.1: Next.js 16 (App Router, TypeScript strict) project with pnpm, MSI design tokens (Tailwind 4, shadcn/ui variables), Inter with tabular figures, next-intl with `messages/en.json`, designed not-found and error pages.
- M0.1: `src/lib/format.ts` for money (integer cents via BigInt), rates (basis points), shares and dates (Africa/Monrovia), with 33 unit tests.
- M0.1: ESLint rules that forbid floats for money and `any`; Prettier; Vitest; Playwright at 390 and 1280 px with axe checks; `scripts/screenshots.ts` with mock-up comparison mode.
- M0.1: GitHub Actions CI (format, lint, typecheck, unit, build, audit; e2e on PRs), gitleaks and CodeQL scans, Dependabot.
- M0.1: Baseline security headers.
- M0.2: Local Supabase (Postgres 17) with sign-up disabled, 10-character passwords, 12-hour sessions, private `branding` bucket.
- M0.2: Migrations for roles, deployment environment, business clock (`app_now`, `business_today`), branches, profiles (managers may have no branch), settings with validation, hash-chained append-only `audit_log`, `document_sequences`, RLS on every table and explicit function grants.
- M0.2: Admin RPCs `update_setting`, `upsert_branch`, `admin_set_profile`, each audited with before and after; `verify_audit_chain` for integrity checks.
- M0.3: Sign-in page (company name from settings, no sign-up), sign-in and sign-out, session refresh in the Next.js proxy, 12-hour session limit, signed-out redirect with return path, route-role map from SPEC 9 with a page guard, inactive accounts refused.
- M0.5: `/settings` (admin only): company header, logo upload, WhatsApp reminder texts, branches (add, rename, deactivate), rule settings A-05/A-07/A-09/A-10/A-12/A-18/A-19/A-20 with money in dollars stored as cents, business clock for demo and test databases, users (create with one-time password, edit role and branch, deactivate, reset password). Every change is audited.
- M0.5: `admin_record_password_reset` RPC; admin logo upload storage policy; `update_setting` accepts SQL NULL as JSON null.
- M0.5: Friendly text for every error code; dollars-to-cents input parser; shared form fields.
- M0.4: App shell from the mock-ups: 232px sidebar with logo tile, role-aware navigation and user block; white top bar; purple phone header with context line; bottom tab bar with a "More" sheet; skeleton and in-shell error states; skip link; logo through a signed URL.
- M0.4: Restyled shadcn/ui Button and Sheet; Callout and Skeleton components.
- M0.3: E2E setup that creates one test account per role; e2e for every role's sign-in, wrong password, inactive user, return path, sign-out and not-found; CI e2e job runs against local Supabase.
- M0.2: `seed_core.sql` (branches, MSI company header, A-01..A-20 rule settings, reminder templates); 70 pgTAP tests; CI database job with PL/pgSQL lint and a generated-types check.

## [Phase 0] 2026-11-03
### Added
- Project kit extracted into the repository: `CLAUDE.md`, `docs/SPEC.md`, `docs/DEMO_DATA.md`, `docs/ASSUMPTIONS.md`, `docs/QUESTIONS.md`, `docs/mockups/`, `public/brand/`, `tools/vectors.py`.
- `docs/SKILL_MAP.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/reports/PHASE-0.md`.
- Builder questions B-01..B-21 in `docs/QUESTIONS.md`.
- `.gitignore`.
