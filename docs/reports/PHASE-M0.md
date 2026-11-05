# Phase M0: Foundation — ready for review

Date: 2026-11-04 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1

## Acceptance (SPEC 13, M0)

| Criterion | Evidence | Result |
| --- | --- | --- |
| Login works per role | `tests/e2e/auth.spec.ts`: admin, CEO, manager, accountant, cashier, loan officer each sign in and land on the dashboard (390 and 1280 px) | **Pass** |
| Unauthorised routes redirect | Signed-out visitors go to `/login?next=…` (`auth.spec.ts`); five non-admin roles are sent back from `/settings` and three roles from `/audit` (`settings.spec.ts`, `audit.spec.ts`); 196 unit cases of route × role against SPEC 9 | **Pass** |
| Audit rows on settings change | pgTAP `03_settings_clock`: one row with actor, role, before and after; e2e `settings.spec.ts` and `audit.spec.ts` read the row back and show it on `/audit` | **Pass** |

## Blocks completed
- M0.1 Project scaffold, tooling and CI
- M0.2 Local Supabase and foundation schema (business clock B-01, manager without branch B-11, hash-chained audit log R-02)
- M0.3 Authentication, sessions and route guard
- M0.4 App shell: tokens, layout, navigation, states and motion
- M0.5 Settings and user management (admin)
- M0.6 Audit log screen, M0 demo seed and phase checks

## Test totals (local, last run)
- Unit (Vitest): 278 passed
- Database (pgTAP): 78 passed; `supabase db lint --fail-on warning`: clean
- E2E (Playwright, 390 and 1280 px, axe on every screen): 87 passed, 5 skipped by design (layout-specific), two consecutive clean runs
- Lint (0 warnings), typecheck, `pnpm build` (also without Supabase env): clean
- CI on every block push: all jobs green (check, database, e2e, gitleaks, CodeQL)

## Mock-up comparison
No mocked screen belongs to M0 (`docs/mockups/README.md` maps all 15 screens to M2–M9). The shell they share was built from mock-ups 01–15 and checked by eye: sidebar 232 px `primary-dark` with logo tile and user block, white top bar, purple phone header with context line, bottom tabs. Differences, all justified in `docs/DECISIONS.md`:
- Phone header uses `primary` as in the mock-ups (SPEC 11 says `primary-dark`).
- Company name wraps in the sidebar tile ("Method Solutions Inc." from settings, not shortened in code).
- Top-bar search, approvals count and branch filter arrive with their data (M2, M3).

Screenshots: `docs/screenshots/m0/` (login, dashboard, settings ×4, audit, not-found; each at 390 and 1280).

## Demo data check
`pnpm seed:demo --as-of 2026-02-12` on an empty database, run twice: identical staff (all 8 DEMO_DATA users with the right roles and branches), branch names BR1 Main, BR2 Branch 2, BR3 Branch 3, clock frozen at 12 Feb 2026 09:10, audit chain intact, no new audit rows on the second run. Loans, payments and the rest arrive with their milestones.

## Accessibility and performance
- axe (WCAG 2.0/2.1/2.2 A and AA tags): no serious or critical issues on any M0 screen, including the open "More" sheet.
- No horizontal scroll at 360/390 px on every screen; 44 px touch targets on phones; skip link; one `h1` per page; reduced motion respected.
- Dynamic pages stream behind skeletons (Partial Prerendering); no measured performance work is due until the 5,000-loan check in M9.

## Security review (phase end)
Reviewed the whole branch for authentication bypass, privilege escalation, injection, open redirects, data exposure and secrets. **No high-confidence vulnerabilities found.** Notes:
- Every RPC checks the role in SQL; functions are revoked from `public` and granted explicitly (pgTAP asserts the exact list per role); no client or the service role can write any table directly.
- The service role is used only after an admin check, for Supabase Auth administration and reading sign-in emails on the admin users page.
- The `next` redirect after sign-in accepts internal paths only; audit filters are whitelisted or validated and passed through the query builder.
- Hardening still planned: full nonce-based CSP and login throttling (M9.3).

## Decisions taken this phase
48 entries in `docs/DECISIONS.md` (Phase 0 to M0.6). Most notable: TypeScript 6 and ESLint 9 for tool compatibility; deployment environment as an owner-only table; app-level 12-hour session check; per-page authorisation (not layout); password reset added to user management; the in-house zod resolver; e2e accounts created by global setup with random passwords.

## Recommendations (need approval)
| ID | Recommendation | Benefit | Cost | Phase |
| --- | --- | --- | --- | --- |
| R-12 | Add `supabase db advisors` (Supabase's security and performance linter) to the CI database job | Catches missing indexes, unsafe functions and RLS gaps automatically | One CI step | M1 |
| R-13 | Designed confirmation dialog with mandatory reason (SPEC 9) built once in M2 and reused for password reset too | One consistent pattern for every risky action | Part of M2 | M2 |

## Risks and open questions
- **B-22 (needs your decision):** may the logo appear on public pages (sign-in, `/verify`)? Proposal: make only the `branding` bucket public-read.
- Remaining builder questions keep their defaults until their milestone (`docs/QUESTIONS.md`).
- Client questions 1–10 are still open (MSI has not answered yet).

## Next: M1 Ledger core (FR-21; T-20, T-21, T-22)
- **M1.1 Chart of accounts and journals.** `accounts` (SPEC 6.1, cash account per branch), `journals`, `journal_lines`, invariant triggers (balanced at commit, one-sided lines, immutable), journals joined to the hash chain (R-02). Acceptance: T-20, T-21.
- **M1.2 Posting and numbering.** `post_journal` (the only writer, period lock check, audit), `next_number` with the global loan counter and 6-digit `EXP` (B-02, B-03), admin `set_sequence_start` before go-live, `period_locks`. Acceptance: T-22, numbering unit tests.
- **M1.3 Ledger screen.** `/ledger` for accountant, manager, CEO, admin: journals list with filters, drill to lines, trial balance view.
- **M1.4 Manual journal request.** Form and `request_manual_journal` RPC (balanced, memo required), `approval_requests` table (decision dispatcher arrives in M2).

In continuous mode M1.1 starts once CI on this commit is green.
