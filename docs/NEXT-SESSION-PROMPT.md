# Prompt for the next Claude Code session

Paste the text below as the first message of a new session on the repository `ultimategamer231/msi`. Edit the first line if you have approved M5 or answered questions.

---

You are continuing LoanDesk, the loan management system for Method Solutions Inc. (MSI). Phases M0 to M4 are built on branch `claude/new-session-6ictcc` and in review on draft PR #1. Keep working on that branch and that PR. Never push to `main` and never merge.

**Status:** M4 Payments is complete. Start M5 (Accruals and due lists) now. I will answer the open questions later. Until then, use the recommended defaults in `docs/reports/OPEN-QUESTIONS-2026-11-05.md` and `docs/QUESTIONS.md` (B-07: 7 days; B-15: the rule written there plus test T-33b; B-16: "The borrower would owe…"; B-18: 1–7, 8–30, 31+ days). Do not build B-19 (WhatsApp share on receipts) until I approve it.

**Before you write code:**
1. Read `CLAUDE.md` and follow it exactly. Its rules override defaults.
2. Read `docs/PROGRESS.md`: its state, the M5 outline, and the session start checklist. Then follow the checklist: start Docker and Supabase, install, write `.env.local`, and run the checks.
3. Read `docs/reports/PHASE-M4.md`, `docs/DECISIONS.md` (latest rows) and the SPEC sections for M5. Those sections are 5.2 (penalties, including the late-run rule), 5.3 (status machine), 9 (`/due`), 10.3 (WhatsApp reminder), 12 (T-03 to T-09, T-13, T-33) and 13.
4. `docs/SPEC.md` is the single source of truth (SPEC > DEMO_DATA > mock-ups > prompt). If code and spec disagree, stop and ask.

**How to work:**
- Write a short M5 block plan into `docs/PROGRESS.md`, then build block by block.
- After each block: run every check in the checklist, commit with a Conventional Commit message, push, and update PR #1.
- Continue to the next block automatically when CI is green.
- Stop and ask first for "ask first" items: money rules beyond the spec, schema or RPC contracts beyond the spec, security or permission changes, user-visible mock-up deviations, new scope, cost, or anything irreversible.
- At the end of M5:
  - match the demo seed to DEMO_DATA (penalties for Mariama, Esther and Mohammed; the demo payment script for RCT-BR2-000123, $1,440.00 → $940.00);
  - take screenshots at 390 and 1280 px;
  - write `docs/reports/PHASE-M5.md`, the changelog and the progress log;
  - then STOP and wait for my approval before M6.

---
