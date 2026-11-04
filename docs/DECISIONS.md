# Decisions taken by the builder

Small, reversible decisions inside the spec (master prompt section 6). Anything that needs approval is in `docs/QUESTIONS.md` instead.

| Date | Block | Decision | Reason | How to undo |
| --- | --- | --- | --- | --- |
| 2026-11-03 | Phase 0 | Phase reports are kept in `docs/reports/` (`PHASE-0.md`, then one per phase) as well as in the PR description | The PR description is not in the repo; a new session can read the report from the repo | Delete the folder; reports remain in PRs |
| 2026-11-03 | Phase 0 | Supabase CLI is a project dev dependency (`pnpm supabase …`), not a system install | Master prompt forbids system installs without asking; pins the CLI version for CI and every developer | Remove the dev dependency and install the CLI globally |
| 2026-11-03 | Phase 0 | DB tests: pgTAP via `supabase test db` for schema, triggers, RLS and grants; Vitest integration tests (signed in as each role) for RPC behaviour and money vectors | SPEC 12 allows either; pgTAP is best for catalog checks, Vitest for role-by-role RPC calls | Move tests to one runner |
| 2026-11-03 | Phase 0 | End-to-end specs live in `tests/e2e/` (SPEC 3.3), so DEMO_DATA's `e2e/demo-payment.spec.ts` becomes `tests/e2e/demo-payment.spec.ts` | SPEC outranks DEMO_DATA on layout of the repo | Move the file |
| 2026-11-03 | Phase 0 | Added `.gitignore` (node_modules, build output, env files, Supabase temp, test reports) | Prevents committing secrets and build output | Edit or delete the file |
| 2026-11-04 | M0.1 | TypeScript 6.0.3 rather than 7.0 | typescript-eslint 8.72 supports TypeScript < 6.1 only; TS 7 is the new native compiler | Move to TS 7 once typescript-eslint supports it |
| 2026-11-04 | M0.1 | ESLint 9.39 rather than 10 | `eslint-plugin-react`, `-import` and `-jsx-a11y` (used by `eslint-config-next`) declare ESLint ≤ 9 | Upgrade when the plugins support 10 |
| 2026-11-04 | M0.1 | `@playwright/test` pinned to 1.63.0 | Matches the Chromium build pre-installed in the container; CI installs its own browser | Bump together with the browser |
| 2026-11-04 | M0.1 | Next.js 16.4.5 with Cache Components and Partial Prefetching on (the create-next-app defaults); Tailwind 4 through the Turbopack loader | Current stable; dynamic data is the default, which suits an always-fresh money app | Turn the flags off in `next.config.ts` |
| 2026-11-04 | M0.1 | Dates formatted with `Intl.DateTimeFormat` (Africa/Monrovia) and fixed English month names; no `date-fns-tz` | Plan default (no extra package); fixed names avoid ICU differences such as "Sept" | Swap for `date-fns-tz` |
| 2026-11-04 | M0.1 | Lint rules forbid `parseFloat`, `Math.round` and `.toFixed`, and `any` | Enforces CLAUDE.md rule 1 (no floats) and "no `any`" mechanically | Remove the rules from `eslint.config.mjs` |
| 2026-11-04 | M0.1 | Baseline security headers now (HSTS, `frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, no `X-Powered-By`); full nonce-based CSP stays in M9.3 | Cheap, safe for every page, tested in e2e | Remove from `next.config.ts` |
| 2026-11-04 | M0.1 | `pnpm test:db`, `seed:demo` and `types` are added in M0.2 with Supabase, not as empty scripts now | Master prompt forbids stubs | n/a |
| 2026-11-04 | M0.1 | Vitest runs with `TZ=Pacific/Auckland` | Proves the formatter picks Africa/Monrovia itself rather than relying on the machine's zone | Remove `env.TZ` |
| 2026-11-04 | M0.1 | `AGENTS.md` (written by Next.js) is committed | `next dev` re-creates it; committing keeps the tree clean | Delete it (it will come back) |
| 2026-11-04 | M0.1 | Dependabot groups minor and patch npm updates into one weekly PR | Fewer PRs for a small team | Remove the `groups` block |
| 2026-11-04 | M0.2 | Deployment environment is a one-row table `app_environment` that only the database owner can change; it defaults to `production`. `seed_local.sql` sets `development` locally; tests set `test`. Changes are audited | The clock override (B-01) must never be switchable by an app admin in production | Move the marker to a Postgres setting (`alter database … set app.environment`) |
| 2026-11-04 | M0.2 | `clock.override_at` = `{"at", "frozen", "set_at"}`; frozen by default, or running forward from `at` in real time | Frozen gives reproducible seeds and screenshots; running suits live demos | Drop the `frozen` option |
| 2026-11-04 | M0.2 | Audit chain uses a `hash_chains` head table locked on insert, a `chain_no` gap-free in commit order, and SHA-256 over a JSON array of the row fields (built-in `sha256()`, no extension) | Locking the head serialises writers so chain order equals commit order; a JSON array has no separator collisions | Replace with an advisory lock |
| 2026-11-04 | M0.2 | `audit_log.entity_id` is `text` (not uuid) | Settings are keyed by name, not uuid | Split into two columns |
| 2026-11-04 | M0.2 | The service role has no INSERT/UPDATE/DELETE on any public table | SPEC 8 uses the service role only for auth administration; defence in depth | Grant back per table |
| 2026-11-04 | M0.2 | Product-level assumptions (A-02, A-03, A-06, A-08, A-17) become `loan_products` columns in M3, not `settings` keys | SPEC 7.1 defines them on `loan_products`; ASSUMPTIONS.md's "setting key" column names the product fields | Add mirror settings |
| 2026-11-04 | M0.2 | `currency.base` accepts only `"USD"` and `accounting.basis` only `"accrual"`; unknown setting keys are rejected; each key is added in the milestone that uses it | A setting the money code ignores would mislead (A-01, A-15 are client-pending) | Widen the validation |
| 2026-11-04 | M0.2 | A branch code cannot change after creation; an admin cannot remove their own admin role or deactivate themselves | Document numbers carry the branch code; the system always keeps one active admin | Remove the checks in the RPCs |
| 2026-11-04 | M0.2 | Local Supabase runs without Studio, Realtime, Edge Functions, analytics, imgproxy, mail and pooler (`pnpm db:start`) | Not used by the spec; saves memory and CI time | Start them with `pnpm supabase start` |
| 2026-11-04 | M0.2 | The logo is uploaded to the private `branding` bucket from `public/brand/` by local config; `settings.company.logo_path` = `branding/msi-logo.png` | SPEC 11 Branding; one source file | Upload manually |
| 2026-11-04 | M0.2 | pgTAP helpers live in `supabase/tests/database/_helpers.psql`, included with `\ir`; tests run SQL as a role through `tests.try_as` and assert on the error text | Keeps pgTAP's own state owned by the test runner while exercising real role privileges | n/a |
| 2026-11-04 | M0.2 | `supabase db lint --fail-on warning` (plpgsql_check) runs in CI | Catches unused variables and type errors in functions before review | Remove the CI step |
