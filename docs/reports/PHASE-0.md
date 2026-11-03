# Phase 0 report: kit check, environment, skill map, plan

Date: 2026-11-03 · Branch: `claude/new-session-6ictcc` · No application code in this phase.

## 1. Kit check: pass

- `loandesk-starter.zip` extracted into the repo root. Every file listed in master prompt section 1 is present: `CLAUDE.md`, `docs/SPEC.md` (v1.0, 796 lines), `docs/DEMO_DATA.md`, `docs/ASSUMPTIONS.md` (A-01..A-20, matches SPEC 2.3 row for row), `docs/QUESTIONS.md`, `docs/mockups/` (README, 15 PNGs, 15 HTML files, logo asset), `public/brand/msi-logo.png`, `public/brand/msi-logo-480.png`, `tools/vectors.py`.
- `msi-mockups.zip` compared with `docs/mockups/` and `docs/DEMO_DATA.md` using `diff -r` and `cmp`: **byte-identical**.
- All 15 mock-up PNGs viewed (4 at 390 px, 11 at 1280 px, all 2x).
- `python3 tools/vectors.py` output matches SPEC 12.1 exactly: T-01 (20000 / 120000), T-02 (2026-02-05, 2026-02-28), T-03 (24000, 28800, 34560, 41472 → 248832), T-06 (24000 / 20000 / 6000, then 18800, owed 112800), T-08 (24000 × 4 → 216000), T-09 (667, 5), T-13 (20000), T-14 (128832 / 20000 / 51168), T-15 (surplus 51168), T-33 (both runs owe 112800, k2 = 18800; the script's assert passes).
- I recomputed every figure in DEMO_DATA by hand: loan totals ($10,169.28, 7 open), overdue ($6,209.28, 61.1%), age buckets, penalty chains (Esther 600 → 1,036.80; Mohammed 1,800 → 3,732.48), every paid-out and due date offset from A = 12 Feb 2026, Mariama's $500 allocation (240 / 200 / 60 → 940), sale preview (1,932.48 / 300 / 767.52, shortfall 732.48), Branch 2 expected cash (1,805.00). **All consistent.** The mock-up figures agree with DEMO_DATA, including 97% collateral cover, the next penalty dates and the PAR shares (23.2 / 16.7 / 60.1%).

## 2. Toolchain

| Tool | Status | Action |
| --- | --- | --- |
| Node | v22.23.4 (LTS) | none |
| pnpm | 10.28.0 | none |
| Docker | 29.9.2; daemon not running at start | I started it with `dockerd`; pulls from Docker Hub and `public.ecr.aws` (Supabase images) work. In a fresh cloud session it has to be started again (I will add that to the session start notes in `docs/PROGRESS.md`). |
| Supabase CLI | **missing** | Add in M0.1 as project dev dependency: `pnpm add -D supabase`. No system install needed. |
| GitHub CLI | 2.89.0 | In this environment GitHub writes go through the GitHub MCP tools; `gh` is used only for search. |
| Playwright | 1.63.0 with Chromium pre-installed | Add `@playwright/test` and `@axe-core/playwright` in M0.1, pinned to match the installed browser. Do not run `playwright install`. |
| psql | 16.15 | none |
| Python | 3.13 | none (runs `tools/vectors.py`) |

Nothing needs a system install. Your approval is only needed for the dev dependencies in M0.1, which are all in the decided stack.

GitHub: the session is attached to `https://github.com/ultimategamer231/msi`, which is empty (no branches). **Please confirm this is the project repository** (master prompt says you will give me the URL).

## 3. Skill map summary

Full map in `docs/SKILL_MAP.md`.
- UI: `design-taste-frontend` (main), `minimalist-ui` (spacing and type only), `design:ux-copy`, `design:design-system`.
- Reviews: `design:design-critique`, `design:accessibility-review`, `redesign-existing-projects` (audit only), `code-review`, `simplify`, `security-review`.
- Output and documents: `full-output-enforcement`, `pdf`.
- Data: `data:sql-queries`, `data:write-query`, `data:validate-data`.
- Tools: Playwright + axe, Supabase CLI, Docker, GitHub MCP.
- **Missing:** `frontend-design` (covered by `design-taste-frontend`); no dedicated screenshot skill (I use Playwright directly); no pgTAP skill.

## 4. Inconsistencies and risks found

All are in `docs/QUESTIONS.md` (Builder, B-01..B-21) with a proposed fix. The ones that block money logic, schema or security, and need your answer before the milestone named:

| ID | Issue | Proposal | Needed by |
| --- | --- | --- | --- |
| B-01 | **No business clock.** A demo "as of 12 Feb 2026" cannot work against the real `current_date`: a cashier may not back-date, so the e2e `demo-payment` and seeded event times (09:20, 14:52) are impossible. | `app_now()` / `business_today()` SQL functions reading setting `clock.override_at`, allowed only in demo/test environments. All RPCs use them. | **M0.2** |
| B-02 | **Demo document numbers do not fit `next_number`.** Loan numbers behave like one global counter with branch prefix and have gaps; collateral has gaps; BR2 receipts start at 000120. | Global loan counter with branch prefix; admin `set_sequence_start` before go-live (continue paper numbering, FR-27); seed fills remaining gaps with real cancelled drafts / old released items. | M1 |
| B-11 | Manager has "All branches" but SPEC allows null branch only for ceo/admin/accountant. | Allow null branch for manager. | **M0.2** |
| B-10 | One cashier (BR2) in the demo, but BR1/BR3 loans were paid out and repaid. | Cashier may act on any branch's loan; cash and receipt numbering follow the cashier's branch. | M3 |
| B-09 | Officer can pick Mobile money/Bank in mock-up 02, but SPEC says field payments always go to Field Cash 1015. | MoMo/bank field payments post straight to 1030/1020 with reference, no remittance; cash goes to 1015. | M4 |
| B-15 | Penalty base on catch-up runs more than one period late is ambiguous (k=1's journal is dated the run date). | Precise base definition using `loan_penalty_events.charged_on`; new test T-33b. | M5 |
| B-05 | Recovery case has no "opened" stage, but the demo opens on 04 Feb and sends the notice on 07 Feb. | Add stage `opened`. | M6 |
| B-06 | Day close vs approvals count (3 vs 4) and the manager's "Close day" button. | Day close reviewed on `/day-close` only; manager sees "Approve and close day". | M8 |

The rest are smaller and have a default I will apply unless you say otherwise: B-03 (6-digit EXP), B-04 (RC numbers), B-07 (due window, spec 7 days; mock-up shows 14), B-08 (blank pending fields on receipts), B-12 (journal reversal RPC), B-13 (list windows), B-14 (role-aware nav and bell), B-16..B-18 (copy and bucket labels), B-19 (WhatsApp share on receipt, a small scope addition), B-20 (branch and push process), B-21 (kit housekeeping).

**Other risks**
- The compounding penalty (A-06) more than doubles a month's debt (SPEC 16 already flags it). Legal wording is placeholder. Both are client and lawyer items; the system keeps them as settings.
- `approval_requests` is a M2 table, but M1 asks for a "manual journal request skeleton". I will create the table in M1.4 and the dispatcher in M2 (the table definition is in the spec, so nothing new).
- SPEC puts collateral in M6, but T-23 (`COLLATERAL_REQUIRED`) is an M3 test. M3 creates the `collaterals` and `loan_collaterals` tables with the minimum needed to pledge; M6 adds custody, photos, recovery and the screens.
- RLS cannot stop a database superuser or the service role from disabling triggers. See recommendation R-04 (hash-chained audit log).
- The session container is temporary. Work is safe only once pushed. I push at phase PRs (see B-20) and keep `docs/PROGRESS.md` current so a new session can resume.

## 5. Roadmap

One line per block. Detailed plans for M1 onward are posted at the start of each phase.

**M0 Foundation** (FR-01, FR-02, FR-26)
- M0.1 Project scaffold, tooling and CI
- M0.2 Local Supabase and foundation schema (branches, profiles, settings, audit log, sequences, business clock)
- M0.3 Authentication, sessions and route guard
- M0.4 App shell: tokens, layout, navigation, states and motion
- M0.5 Settings and user management (admin)
- M0.6 Audit log screen, M0 demo seed and phase checks

**M1 Ledger core** (FR-21; T-20, T-21, T-22)
- M1.1 Chart of accounts, journals, journal lines, invariant triggers
- M1.2 `post_journal`, `next_number` (with sequence start), period locks
- M1.3 Ledger screen (journals, drill to lines) and trial balance view
- M1.4 Manual journal request (form, RPC, `approval_requests` table)

**M2 Customers** (FR-03, FR-04, FR-05, FR-28; T-29, T-32)
- M2.1 Customers, `create_customer` with duplicate guard, attachments and private storage
- M2.2 Customer list and new-customer form
- M2.3 `decide_approval` dispatcher, customer edit and blacklist requests
- M2.4 Customer profile (mock-up 08), approvals inbox (mock-up 12), top-bar count
- M2.5 Guarantor model and form component

**M3 Loans** (FR-06..FR-09; T-01, T-02, T-17, T-18, T-19, T-23, T-35)
- M3.1 Loan products and settings tab
- M3.2 Loans table, money helpers, `preview_loan_terms`, `loan_balances` view
- M3.3 Draft, submit and approval routing
- M3.4 Minimal collateral pledge and `disburse_loan` (R1) with collateral, funds and lock checks
- M3.5 New loan wizard
- M3.6 Loans list (mock-up 06) and loan detail (mock-up 07)
- M3.7 `issue_document` and loan agreement PDF

**M4 Payments** (FR-10, FR-11, FR-20; T-06 allocation, T-10, T-11, T-12, T-25, T-28, T-36, T-37)
- M4.1 `receive_payment` (R2): allocation, idempotency, method and date rules
- M4.2 `record_field_payment` (R3) and `confirm_remittance` (R3b)
- M4.3 Void and journal reversal flows (R8)
- M4.4 Receive payment screen (mock-up 03) and payments list
- M4.5 Receipt screen (mock-up 04), print CSS (A5, 80 mm) and receipt PDF
- M4.6 Field app (mock-ups 01, 02) and remittance screen

**Audit gate A** (M0–M4)

**M5 Accruals and due lists** (FR-12, FR-13, FR-18; T-03..T-09, T-13, T-33)
- M5.1 Penalty events, `loan_outstanding_as_of`, `run_daily_accruals`
- M5.2 `pg_cron`, manual run, cron fallback route, `/api/health`
- M5.3 Extension request and approval (R5)
- M5.4 Due list view, due and overdue screen (mock-up 11), WhatsApp reminders, CSV

**M6 Collateral and recovery** (FR-15, FR-16, FR-17, FR-19; T-14, T-15, T-16, T-24)
- M6.1 Collateral identifiers, duplicate warning, custody log, photos, release
- M6.2 Collateral register (mock-up 09) and detail (mock-up 10)
- M6.3 Recovery cases and stages, recovery list and case screen (mock-up 13)
- M6.4 Collateral sale (R7), surplus and payout (R7b)
- M6.5 Write-off request and CEO approval (R6), post-write-off recoveries

**M7 Statements and documents** (FR-14, FR-25)
- M7.1 Statement data and statement PDF (loan and customer)
- M7.2 Demand notice, collateral receipt and release PDFs; templates in settings
- M7.3 Public `/verify/[token]` page and void handling

**M8 Money-out, day close, reports** (FR-22, FR-23, FR-24; T-26, T-27, T-34)
- M8.1 Payees and expenses with limit routing and settlement (R9, R9b, R9c)
- M8.2 Day close submit, approve, reopen and lock (mock-up 14)
- M8.3 Operational report functions (collections, money out, due, overdue, cash, collateral)
- M8.4 P&L, balance sheet, trial balance with reconcile checks
- M8.5 Report screens with filters, CSV and print (mock-up 15); DEMO_DATA reconciliation

**M9 Migration, dashboards, hardening** (FR-27, FR-29; T-30, T-31, 12.3)
- M9.1 Opening balance wizard (R12) and back-dated entry controls
- M9.2 Role dashboards (mock-up 05 and officer, cashier, accountant variants)
- M9.3 RLS and grants review, security headers, login rate limiting
- M9.4 Complete demo seed, e2e smoke (12.3) and `demo-payment` spec
- M9.5 Lighthouse and axe on `/field`, 5,000-loan performance, backup script

**Audit gate B** (M0–M9)

**Release phase**
- R.1 Cloud account checklist (Supabase region trade-off, Vercel, env vars); wait for you
- R.2 Staging deploy, migrations, `seed_core`, smoke against staging, cron and backups verified
- R.3 `docs/OPERATIONS.md` (with a tested restore) and `docs/HANDOVER.md`
- R.4 Production go-live checklist (FR-27 data migration, parallel run, A-01..A-20 sign-off); production deploy only on your instruction

## 6. M0 detailed block plan

Common to every block: lint, typecheck and tests green; no TODOs or stubs; user-facing text in `messages/en.json`; screenshots at 390 and 1280 px for touched screens; `docs/DECISIONS.md` and `docs/PROGRESS.md` updated.

### M0.1 Project scaffold, tooling and CI
- **Objective:** an empty but production-shaped Next.js app that lints, typechecks, tests and builds, locally and in CI.
- **Spec coverage:** SPEC 3.1, 3.3, 3.4, 11 (Theming tokens), D-12; CLAUDE.md "Commands"; master prompt 2 (stack, CI, language).
- **Plan:**
  - Next.js (current stable, App Router) + TypeScript `strict` (plus `noUncheckedIndexedAccess`), pnpm, ESLint (Next + `@typescript-eslint` strict, no `any`), Prettier.
  - Tailwind with MSI tokens from `docs/mockups/README.md` as CSS variables (`primary`, `primary-dark`, `primary-tint`, `accent`, surfaces, borders, text, status colours, radii 10/14/999, Inter with tabular numerals). shadcn/ui initialised and restyled to these tokens.
  - `next-intl` (English only) with `messages/en.json`; `src/lib/format.ts` (money `$1,234.56` from integer cents, dates `05 Feb 2026`, Africa/Monrovia) with no floats: cents formatted by integer division.
  - Vitest (unit) with tests for `format.ts`; Playwright + `@axe-core/playwright` config (390 and 1280 projects); `scripts/screenshots.ts`.
  - Scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `test:db`, `test:e2e`, `seed:demo`, `types` (`test:db`, `seed:demo`, `types` wired to the Supabase CLI in M0.2).
  - Dev dependencies: `supabase`, `@playwright/test`, `@axe-core/playwright`, `vitest`. Runtime: `next`, `react`, `next-intl`, `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `react-hook-form`, `date-fns`, `date-fns-tz` (Monrovia formatting; `date-fns` add-on), `motion`, `lucide-react`. All others come in the milestone that needs them.
  - `.env.example` with the M0 variables; `.gitignore`; `.nvmrc`; `README.md` (run locally).
  - GitHub Actions `ci.yml`: install (frozen lockfile), lint, typecheck, unit tests, build, `pnpm audit --audit-level high`. DB job added in M0.2; Playwright smoke job on PRs added in M0.3.
- **Acceptance:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass locally; `format.ts` tests cover `0`, `5`, `123456`, `-1000`, large values, and date formatting in Africa/Monrovia; CI workflow file valid; no float arithmetic in `format.ts`.
- **Dependencies and risks:** `date-fns-tz` is a `date-fns` companion package; if you count it as outside the stack I will format with `Intl.DateTimeFormat` (`timeZone: 'Africa/Monrovia'`) instead (my default if you do not answer). Next.js major version chosen at build time and recorded.

### M0.2 Local Supabase and foundation schema
- **Objective:** local Supabase with the M0 tables, helpers and RLS, covered by DB tests that run locally and in CI.
- **Spec coverage:** SPEC 6.3 (immutability trigger for `audit_log`; `document_sequences`), 6.4 (RLS pattern, helpers, grants), 7.1, 7.5 (`audit_log`), 2.3 (settings keys), 11 Branding (`settings.company`), 14 (`seed_core.sql`); FR-02, FR-26; B-01, B-11 if approved.
- **Plan:**
  - `pnpm supabase init`; `config.toml` (auth: email only, no sign-up, password min 10, JWT expiry and session limit 12 h, Storage private bucket `branding`).
  - Migrations: `0001_extensions` (pgcrypto, pg_trgm, pg_cron, pgtap for tests); `0002_enums_and_helpers` (role enum, `trg_immutable`, `auth_role()`, `auth_branch()`, `is_staff()`, `app_now()`, `business_today()`); `0003_branches_profiles`; `0004_settings`; `0005_audit_log` (append-only trigger, `write_audit()` helper that records actor, role, action, entity, before/after); `0006_document_sequences`; `0007_rls_and_grants` (RLS on every table, read policies per SPEC 4, no write policies; revoke from public, grant execute to authenticated).
  - Admin RPCs: `update_setting(key, value)` (validates the value shape per key with JSON checks, writes audit with before/after), `upsert_branch(jsonb)`, `admin_set_profile(user_id, role, branch_id, active)`.
  - `supabase/seed/seed_core.sql`: settings from SPEC 2.3 with defaults, `settings.company` with MSI values and blank pending fields, `settings.templates` placeholders marked "REVIEW WITH LAWYER", placeholder branches BR1–BR3 (names from DEMO_DATA, flagged pending in QUESTIONS 9).
  - DB tests (pgTAP via `supabase test db`): RLS enabled on every public table (catalog query); `audit_log` update/delete raises `IMMUTABLE_RECORD` for every role including service role; `update_setting` as non-admin gives `FORBIDDEN`; as admin writes one audit row with before/after; helper functions return role/branch from the JWT.
  - `pnpm types` generates `src/types/database.ts`. CI DB job: start Supabase in the runner, reset, run `supabase test db`.
- **Acceptance:** `pnpm supabase db reset` applies cleanly; `pnpm test:db` passes; no table without RLS; every function `security definer set search_path = public` with grants as SPEC 6.4; types generated and committed.
- **Dependencies and risks:** B-01 (clock) and B-11 (manager branch) decided first. Supabase containers are large; CI start time about 2–3 minutes.

### M0.3 Authentication, sessions and route guard
- **Objective:** staff sign in with email and password and only reach routes their role allows.
- **Spec coverage:** FR-01; SPEC 4, 9 (`/login`, route-role table), 11 Security (password 10+, 12 h session, rate limit), D-07, D-09.
- **Plan:** `@supabase/ssr` clients (server, browser, middleware); `/login` page (designed in MSI language, logo on white tile, no sign-up link, generic error text, disabled submit while pending); middleware refreshes the session and enforces a 12-hour absolute limit; `src/lib/permissions.ts`: one typed map of route → roles taken from SPEC 9, used by middleware and by navigation; unauthorised route → redirect to `/dashboard` with a notice, signed-out → `/login?next=`; inactive profile → signed out with message; sign-out action; server action error logging with code and user id only. Login throttling: Supabase built-in limits now; the "5 failures → 15 minutes" rule is built in M9.3 (needs a small attempts table and is listed there).
- **Acceptance:** e2e: each of the 6 roles signs in and lands on `/dashboard`; each role is redirected away from at least one forbidden route (e.g. officer → `/settings`, cashier → `/audit`); signed-out access redirects to `/login`; unit tests cover the permissions map against SPEC 9 for every route; no service-role key in the client bundle (build check).
- **Dependencies and risks:** M0.2. Playwright smoke job added to CI here.

### M0.4 App shell: tokens, layout, navigation, states and motion
- **Objective:** the shared layout matches the mock-ups on desktop and phone, with role-aware navigation.
- **Spec coverage:** SPEC 9 (layout: left nav desktop, bottom tab bar phone, top bar with branch, user, role badge), 11 (Theming, Motion, accessibility, 360 px), mock-ups 05–15 (sidebar, top bar), 01 (mobile header, bottom tabs); B-14.
- **Plan:** `(app)/layout.tsx` with desktop sidebar (`primary-dark`, logo tile from `settings.company` with name and "Loan management", nav items, user block with initials avatar and role), top bar (page title, global search box shell is **not** included until a milestone gives it data; branch selector; approvals button added in M2), phone layout (purple header, bottom tab bar, safe-area padding). Navigation shows only routes that exist and that the role may open. Base components restyled from shadcn: Button, Input, Badge (status variants), Card, Table, Dialog (confirm with mandatory reason, used from M2), Skeleton, Toast, EmptyState, ErrorState. `loading.tsx`, `error.tsx`, `not-found.tsx` for the app group. `/dashboard` for M0 shows the greeting, date and branch (real data, no placeholder figures); role widgets come in M9. Motion: page and dialog transitions 150–250 ms ease-out with `prefers-reduced-motion` respected.
- **Acceptance:** screenshots at 390 and 1280 px for dashboard and login; no horizontal scroll at 360 px; axe shows no serious or critical issues; keyboard can reach every nav item with visible focus; logo always on white; colours only from tokens (lint rule or grep check for raw hex in components).
- **Dependencies and risks:** M0.3. The global search box in the mock-up top bar has no spec'd behaviour; I leave it out until M2 (customers) and raise its scope then.

### M0.5 Settings and user management (admin)
- **Objective:** the admin can change company details, branches, rule values and go-live date, and create and manage staff users, with every change audited.
- **Spec coverage:** FR-01, FR-02, FR-26; SPEC 4 ("Manage users, products, settings": admin), 8 (`admin_create_user` server action with service role), 9 (`/settings`), 11 Branding; A-01..A-20 keys.
- **Plan:** `/settings` with sections: Company (name, short name, address, phone, email, receipt footer, logo upload to private `branding` bucket, preview on white tile), Branches (list, add, edit, deactivate), Rules (typed form per setting key from SPEC 2.3, money entered in dollars and converted to cents by integer parsing, rates in percent with two decimals converted to basis points; validation with zod), Go-live date, Users (list, create with generated one-time password shown once, role, branch, deactivate, reactivate). `admin_create_user` is a server action using `SUPABASE_SERVICE_ROLE_KEY` (server only) that creates the auth user and calls `admin_set_profile`, writing an audit row. Loan products are not here (M3.1).
- **Acceptance:** changing any setting as admin writes exactly one `audit_log` row with before and after (DB test and e2e); non-admin gets redirected from `/settings` and `FORBIDDEN` from the RPCs (DB test); new user can sign in with the shown password; deactivated user cannot sign in; money and rate inputs never use floats (unit tests on the parsers: `"2000"` → 200000, `"20.00"` %→ 2000 bps, rejects `"1e3"`, `"12.345"`); screenshots 390/1280.
- **Dependencies and risks:** M0.4. Password shown once on screen: you may prefer an emailed invite; Supabase local has Inbucket for that, cloud needs SMTP (cost/account), so I default to show-once.

### M0.6 Audit log screen, M0 demo seed and phase checks
- **Objective:** managers, CEO and admin can read the audit log; the demo seed creates the M0 part of DEMO_DATA; the phase is ready to review.
- **Spec coverage:** FR-26; SPEC 9 (`/audit`), 11 Audit (cannot filter out entries; read-only), 14 (demo seed); DEMO_DATA branches and users.
- **Plan:** `/audit` (manager, ceo, admin): table with server-side filters by user, entity type, action and date range, pagination 25, before/after diff view; no delete or edit anywhere. `pnpm seed:demo [--as-of YYYY-MM-DD]` script (TypeScript, service role, demo environment only, refuses when `environment.kind` is production): creates the 8 demo users with generated passwords printed once, branches with DEMO_DATA names, sets the clock (B-01). Later milestones extend it. Phase checks: `pnpm build`, full tests, axe, screenshots, CHANGELOG, code-review and security-review skills, PR with the phase report.
- **Acceptance (M0, SPEC 13):** login works per role (e2e, all 6 roles); unauthorised routes redirect (e2e); audit rows on settings change (DB test + e2e). Plus: `pnpm seed:demo --as-of 2026-02-12` twice on an empty DB gives identical branches and users (passwords differ by design); `/audit` shows the settings change rows; screenshots 390/1280 for login, dashboard, settings, audit.
- **Dependencies and risks:** M0.5.

## 7. Recommendations (each needs your approval; none will be built without it)

| ID | Recommendation | Benefit | Cost | Phase |
| --- | --- | --- | --- | --- |
| R-01 | Move TOTP two-factor sign-in for manager, CEO and admin from phase 2 into the release phase | Approvers move money; a stolen password is the main risk | ~1 block; Supabase supports TOTP with no new service | Release |
| R-02 | Hash-chained audit log: each `audit_log` and `journals` row stores a SHA-256 of its content plus the previous row's hash; nightly check verifies the chain | Tampering by anyone with database superuser access becomes detectable, not just blocked | 1 column + trigger + check job; small | M0.2 / M1.1 |
| R-03 | Nightly integrity job: trial balance balances, no negative loan component, every journal balanced, chain intact; failure shows on dashboard and `/api/health` | Catches defects and data damage the day they happen | Small, reuses report SQL | M8/M9 |
| R-04 | Repository hardening: branch protection on `main` with required CI checks, Dependabot (or Renovate), gitleaks secret scan and CodeQL in CI | Supply-chain and secret-leak protection expected by an international standard | Free on GitHub; you enable branch protection | M0.1 |
| R-05 | Idle timeout (e.g. 30 minutes) on top of the 12-hour session for shared office PCs | Stops walk-up use of an unlocked cashier screen | Small | M0.3 or M9.3 |
| R-06 | Error tracking and uptime monitoring (e.g. Sentry free tier, an uptime pinger on `/api/health`) | You learn about failures before MSI calls | New dependency and account; free tiers exist | Release |
| R-07 | Restore drill every quarter, plus encrypted weekly off-site copy of the `pg_dump` | A backup that has never been restored is not a backup | Operational time, small storage cost | Release / operations |
| R-08 | IFRS 9-style loan-loss provisioning report (expected loss by PAR bucket, configurable rates) | Realistic balance sheet for the board and later CBL | 1 report, read-only | Phase 2 (after CBL licence terms) |
| R-09 | CBL report pack once CBL publishes the format | Regulatory readiness | Depends on format | Phase 2 |
| R-10 | Test the 80 mm receipt on MSI's actual thermal printer before M4 sign-off | Thermal printers vary in width and margins | Needs the printer model (QUESTIONS 7) | M4 |
| R-11 | Data protection basics: written retention policy, audit of customer-record views by staff, privacy notice on the loan agreement | Borrower trust; prepares for licensing review | Small; wording needs MSI's lawyer | M7 / M9 |

## 8. What I need from you

1. **Approve this plan**, or tell me what to change.
2. **Answers to the blocking questions:** B-01 and B-11 (before M0.2); B-02, B-03 (before M1); the rest can wait for their milestone, and their defaults are in `docs/QUESTIONS.md`.
3. **GitHub:** confirm `https://github.com/ultimategamer231/msi` is the project repository, and that from M0 I may push `phase/<milestone>` branches for each phase PR (B-20).
4. Decisions on recommendations R-01..R-11 (any you approve go into the matching block plan).

I will not start M0.1 until you approve.
