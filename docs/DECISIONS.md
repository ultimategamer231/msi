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
