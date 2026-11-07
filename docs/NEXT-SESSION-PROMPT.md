# Prompt for the next Claude Code session

Paste the text below as the first message of a new session on the repository `ultimategamer231/msi`. Edit the first line if you have approved M5 or answered questions.

---

You are continuing LoanDesk, the loan management system for Method Solutions Inc. (MSI). Phases M0 to M4 are built on branch `claude/new-session-6ictcc` and in review on draft PR #1. Keep working on that branch and that PR. Never push to `main` and never merge.

**Status:** M5 Accruals and due lists is complete (report `docs/reports/PHASE-M5.md`). Its commits may still be local only: the last session lost GitHub access (403). First run `git status -sb` and `git log origin/claude/new-session-6ictcc..HEAD`; if commits are ahead, push them, check CI and update PR #1. Then start M6 (Collateral and recovery) only if I have approved it in this message; otherwise stop and ask. I will answer the open questions later. Until then, use the recommended defaults in `docs/reports/OPEN-QUESTIONS-2026-11-05.md` and `docs/QUESTIONS.md` (for M6: B-04 RC-000001 numbering; B-05 a "Case opened" stage first). Do not build B-19 (WhatsApp share on receipts) until I approve it.

**Before you write code:**
1. Read `CLAUDE.md` and follow it exactly. Its rules override defaults.
2. Read `docs/PROGRESS.md`: its state, the M5 outline, and the session start checklist. Then follow the checklist: start Docker and Supabase, install, write `.env.local`, and run the checks.
3. Read `docs/reports/PHASE-M5.md`, `docs/DECISIONS.md` (latest rows) and the SPEC sections for M6: 5.7 (recovery and collateral disposal), 5.8 (write-off), 5.9 (collateral rules), 6.2 (recipes R6, R7, R7b), 9 (`/collateral`, `/recovery`), 12 (T-14, T-15, T-16, T-24) and 13; mock-ups 09, 10, 13.
4. `docs/SPEC.md` is the single source of truth (SPEC > DEMO_DATA > mock-ups > prompt). If code and spec disagree, stop and ask.

**How to work:**
- Write a short M5 block plan into `docs/PROGRESS.md`, then build block by block.
- After each block: run every check in the checklist, commit with a Conventional Commit message, push, and update PR #1.
- Continue to the next block automatically when CI is green.
- Stop and ask first for "ask first" items: money rules beyond the spec, schema or RPC contracts beyond the spec, security or permission changes, user-visible mock-up deviations, new scope, cost, or anything irreversible.
- At the end of M6:
  - match the demo seed to DEMO_DATA (collateral register, recovery case RC-000001 for Mohammed Sheriff opened A−8 with the notice sent A−5);
  - take screenshots at 390 and 1280 px;
  - write `docs/reports/PHASE-M6.md`, the changelog and the progress log;
  - then STOP and wait for my approval before M7.

---
