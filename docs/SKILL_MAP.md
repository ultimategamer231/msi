# Skill and tool map

Written in Phase 0 (2026-11-03). I list what was actually available in this session. Skills tell me *how* to do a job well. They never decide *what* to build: SPEC, DEMO_DATA and the mock-ups do that, in that order.

## Inventory

### Skills installed
| Skill | Kind | Relevant |
| --- | --- | --- |
| `anthropic-skills:design-taste-frontend` | frontend design (anti-template, typography, states) | yes |
| `anthropic-skills:minimalist-ui` | frontend design (editorial, flat) | yes, spacing/typography only; its palette is ignored |
| `anthropic-skills:redesign-existing-projects` | design audit / upgrade | yes, phase ends and audit gates |
| `anthropic-skills:full-output-enforcement` | complete files, no placeholders | yes |
| `anthropic-skills:pdf` | PDF read, render, inspect | yes, M3/M4/M7 documents |
| `design:design-critique` | structured design review | yes |
| `design:accessibility-review` | WCAG audit | yes |
| `design:ux-copy` | microcopy, empty/error states, dialogs | yes |
| `design:design-system` | token/component consistency audit | yes |
| `design:design-handoff` | spec sheets from designs | occasionally (reading mock-up HTML) |
| `data:sql-queries`, `data:write-query` | SQL authoring (Postgres) | yes, reports and views |
| `data:validate-data` | QA a numeric result | yes, demo data checks |
| `code-review` | correctness review of a diff | yes, before every PR and at audits |
| `simplify` | reuse/simplification pass | yes, before phase PRs |
| `security-review` | security review of the branch | yes, phase ends and audits |
| `run` | launch the app and drive it | yes, screenshots |
| `dataviz` | chart design rules | yes, dashboard bars (M9) |
| `anthropic-skills:industrial-brutalist-ui` | brutalist style | **not used** (conflicts with mock-ups) |
| Others (`docs`, `docx`, `pptx`, `xlsx`, `postiz`, `desktop-commander:*`, `cowork-*`, `artifact-*`, research skills) | unrelated | not used |

### Tools
| Tool | Status |
| --- | --- |
| Node 22.23 LTS, pnpm 10.28, git 2.43, Python 3.13 | present |
| Docker 29.9 | present; daemon is not started by default in this container, I start it with `dockerd` (works, pulls Supabase images) |
| Supabase CLI | **missing**; added in M0.1 as project dev dependency `supabase` (run via `pnpm supabase …`), no system install |
| Playwright 1.63 + Chromium | pre-installed; `@playwright/test` and `@axe-core/playwright` added as dev dependencies in M0.1 against the same browser build |
| `psql` 16 | present (handy for ad-hoc checks against local Supabase) |
| GitHub | GitHub MCP tools for branches, PRs, CI status and logs; `gh` CLI only for search in this environment |
| Figma, Canva, Gamma, Lovable, Higgsfield, Unsplash MCP servers | available, **not used** (mock-ups are final; no stock imagery allowed) |

### Expected but missing
- `frontend-design`: not installed. `design-taste-frontend` covers the same ground.
- No dedicated screenshot/browser skill; I drive Playwright directly (`scripts/screenshots.ts`, created in M0.4).
- No dedicated Postgres/pgTAP skill; I use `data:sql-queries` and the Supabase CLI test runner.

## Job → skill / tool → when

| Job | Skill or tool | When |
| --- | --- | --- |
| Build any screen or component | `design-taste-frontend` (+ `minimalist-ui` for spacing and type rhythm only); mock-up HTML in `docs/mockups/html/` for exact spacing and copy | Every UI block, read before the first UI block of each session |
| Empty, loading, error states, dialogs, button labels | `design:ux-copy` | Every UI block |
| Tokens and component consistency | `design:design-system` | M0.4 (set-up), each phase end |
| Motion | animation guidance in `design-taste-frontend`, held to SPEC 11 "Motion" (150–250 ms, ease-out, reduced-motion respected, never animate money on receipts/forms/tables) | M0.4 set-up, then wherever motion is added |
| Screenshots 390 px and 1280 px, mock-up comparison | Playwright (`scripts/screenshots.ts`, deviceScaleFactor 2 for files you see), `run` skill to launch the app | End of every UI block; `compare-<nn>.png` side by side at each phase end |
| Accessibility | `@axe-core/playwright` in e2e; `design:accessibility-review` for manual WCAG 2.2 AA pass (keyboard, contrast, 360 px) | Every phase end; audit gates |
| Design review of finished screens | `design:design-critique`, `redesign-existing-projects` (audit half only; never re-skins) | Every phase end; audit gates A and B |
| Long files, complete code | `full-output-enforcement` | Every block that writes long files (migrations, RPCs, forms) |
| PDFs (agreement, receipt, statement, notices) | `@react-pdf/renderer` to build; `pdf` skill to render pages to PNG and inspect | M3 (agreement), M4 (receipt), M7 (statement, notices, collateral docs) |
| SQL: views, reports, RPC queries | `data:sql-queries` / `data:write-query` (Postgres dialect) | M1 onward; reports in M8 |
| Demo data and report figures check | `data:validate-data` + `tools/vectors.py` | Every phase end (`seed:demo --as-of 2026-02-12`), M8 reports |
| Code review before PR | `code-review` then `simplify` | End of every phase, before opening the PR |
| Security review | `security-review` | End of every phase touching auth/RLS/RPCs; audit gates |
| CI status, PRs, logs | GitHub MCP tools (`create_pull_request`, `actions_list`, `get_job_logs`) | Every push / phase PR |
| Local DB and tests | Supabase CLI (`pnpm supabase start`, `test db`), Docker | Every block with SQL |
