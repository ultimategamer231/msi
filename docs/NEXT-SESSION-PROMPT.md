# Prompt for the next Claude Code session

Paste the text below as the first message of a new session on the repository `ultimategamer231/msi`. Add "I approve M7" to it if you have, and any answers to open questions.

---

You are continuing LoanDesk, the loan management system for Method Solutions Inc. (MSI). Phases M0 to M6 are built on branch `claude/new-session-6ictcc` and in review on draft PR #1. Keep working on that branch and that PR. Never push to `main` and never merge.

**Status:** M6 Collateral and recovery is complete (report `docs/reports/PHASE-M6.md`). M5 and M6 commits may still be local only: the last sessions lost GitHub access (403). First run `git status -sb` and `git log origin/claude/new-session-6ictcc..HEAD`; if commits are ahead, push them, check CI and update PR #1. If this new session does not have those commits at all, ask me for the `m5-commits.bundle` / M6 bundle before doing anything else. Then start M7 (Statements and documents) only if I have approved it in this message; otherwise stop and ask. I will answer the open questions later; until then use the recommended defaults in `docs/reports/OPEN-QUESTIONS-2026-11-05.md` and `docs/QUESTIONS.md`. Do not build B-19 (WhatsApp share on receipts) until I approve it.

**Before you write code:**
1. Read `CLAUDE.md` and follow it exactly. Its rules override defaults.
2. Read `docs/PROGRESS.md`: its state, next step, and the session start checklist. Then follow the checklist: start Docker and Supabase, install, write `.env.local`, and run the checks.
3. Read `docs/reports/PHASE-M6.md`, `docs/DECISIONS.md` (latest rows) and the SPEC sections for M7: 9 (`/verify/[token]`, statement button), 10.1 (PDF documents), FR-14, FR-25 and 13.
4. `docs/SPEC.md` is the single source of truth (SPEC > DEMO_DATA > mock-ups > prompt). If code and spec disagree, stop and ask.

**How to work:**
- Write a short M7 block plan into `docs/PROGRESS.md`, then build block by block.
- After each block: run every check in the checklist, commit with a Conventional Commit message, push, and update PR #1.
- Continue to the next block automatically when CI is green.
- Stop and ask first for "ask first" items: money rules beyond the spec, schema or RPC contracts beyond the spec, security or permission changes, user-visible mock-up deviations, new scope, cost, or anything irreversible.
- At the end of M7:
  - check that every seeded loan's statement running balance equals the ledger (SPEC 13 M7);
  - take screenshots at 390 and 1280 px;
  - write `docs/reports/PHASE-M7.md`, the changelog and the progress log;
  - then STOP and wait for my approval before M8.

---
