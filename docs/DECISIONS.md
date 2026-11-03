# Decisions taken by the builder

Small, reversible decisions inside the spec (master prompt section 6). Anything that needs approval is in `docs/QUESTIONS.md` instead.

| Date | Block | Decision | Reason | How to undo |
| --- | --- | --- | --- | --- |
| 2026-11-03 | Phase 0 | Phase reports are kept in `docs/reports/` (`PHASE-0.md`, then one per phase) as well as in the PR description | The PR description is not in the repo; a new session can read the report from the repo | Delete the folder; reports remain in PRs |
| 2026-11-03 | Phase 0 | Supabase CLI is a project dev dependency (`pnpm supabase …`), not a system install | Master prompt forbids system installs without asking; pins the CLI version for CI and every developer | Remove the dev dependency and install the CLI globally |
| 2026-11-03 | Phase 0 | DB tests: pgTAP via `supabase test db` for schema, triggers, RLS and grants; Vitest integration tests (signed in as each role) for RPC behaviour and money vectors | SPEC 12 allows either; pgTAP is best for catalog checks, Vitest for role-by-role RPC calls | Move tests to one runner |
| 2026-11-03 | Phase 0 | End-to-end specs live in `tests/e2e/` (SPEC 3.3), so DEMO_DATA's `e2e/demo-payment.spec.ts` becomes `tests/e2e/demo-payment.spec.ts` | SPEC outranks DEMO_DATA on layout of the repo | Move the file |
| 2026-11-03 | Phase 0 | Added `.gitignore` (node_modules, build output, env files, Supabase temp, test reports) | Prevents committing secrets and build output | Edit or delete the file |
