# Prompt for the next Claude Code session

Paste the text below as the first message of a new session on the repository `ultimategamer231/msi`. Add "I approve M9" to it if you have, and any answers to open questions.

---

You are continuing LoanDesk, the loan management system for Method Solutions Inc. (MSI). Phases M0 to M8 are built on branch `claude/new-session-6ictcc` and in review on draft PR #1. Keep working on that branch and that PR. Never push to `main` and never merge.

**Status:** M8 Money-out, day close, reports is complete (report `docs/reports/PHASE-M8.md`). First run `git status -sb` and `git log origin/claude/new-session-6ictcc..HEAD`; if commits are ahead, push them, check CI and update PR #1. If this new session does not have the M8 commits at all, ask me for the latest `loandesk-full.bundle` before doing anything else. Then start M9 (Migration, dashboards, hardening) only if I have approved it in this message; otherwise stop and ask. I will answer the open questions later; until then use the recommended defaults in `docs/reports/OPEN-QUESTIONS-2026-11-05.md` and `docs/QUESTIONS.md`. Do not build B-19 (WhatsApp share on receipts) until I approve it.

**Before you write code:**
1. Read `CLAUDE.md` and follow it exactly. Its rules override defaults.
2. Read `docs/PROGRESS.md`: its state, next step, and the session start checklist. Then follow the checklist: start Docker and Supabase, install, write `.env.local`, and run the checks.
3. Read `docs/reports/PHASE-M8.md`, `docs/DECISIONS.md` (latest rows) and the SPEC sections for M9: FR-27, FR-29, 9 (dashboards), 11, 12.3 and 13.
4. `docs/SPEC.md` is the single source of truth (SPEC > DEMO_DATA > mock-ups > prompt). If code and spec disagree, stop and ask.

**How to work:**
- Keep chat output short: report block results, blockers and decisions only (Foday, 2026-11-09).
- Write a short M9 block plan into `docs/PROGRESS.md`, then build block by block.
- After each block: run every check in the checklist, commit with a Conventional Commit message, push, and update PR #1.
- Continue to the next block automatically when CI is green.
- Stop and ask first for "ask first" items: money rules beyond the spec, schema or RPC contracts beyond the spec, security or permission changes, user-visible mock-up deviations, new scope, cost, or anything irreversible.
- At the end of M9:
  - T-30, T-31 and the SPEC 12.3 smoke pass; no table without RLS; Lighthouse accessibility ≥ 90 on `/field` (SPEC 13 M9);
  - take screenshots at 390 and 1280 px;
  - write `docs/reports/PHASE-M9.md`, the changelog and the progress log;
  - then STOP and wait for my approval before the audit gates.

---
