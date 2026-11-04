# LoanDesk

Loan management system for Method Solutions Inc. (MSI), built by Corex Digital Solutions. The client name, logo and contact details shown to users come from `settings.company`, never from code.

Start with these:

- `CLAUDE.md`: standing project rules
- `docs/SPEC.md`: the specification and single source of truth
- `docs/PROGRESS.md`: where the build is now
- `docs/mockups/README.md`: approved screens and design tokens

## Run locally

Requirements: Node 22 (see `.nvmrc`), pnpm 10, Docker.

```bash
pnpm install
pnpm db:start                # local Supabase in Docker: applies migrations and seeds
cp .env.example .env.local   # fill in values from `pnpm supabase status -o env`
pnpm dev                     # http://localhost:3000
```

## Commands

| Command                                  | What it does                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`                               | Development server                                                            |
| `pnpm build` / `pnpm start`              | Production build and server                                                   |
| `pnpm lint`                              | ESLint, zero warnings allowed (includes the no-float money rules)             |
| `pnpm typecheck`                         | Route types and TypeScript strict check                                       |
| `pnpm format` / `pnpm format:check`      | Prettier                                                                      |
| `pnpm test`                              | Vitest unit tests                                                             |
| `pnpm test:e2e`                          | Playwright at 390 px and 1280 px, with axe accessibility checks               |
| `pnpm screenshots --out <dir> <routes…>` | Screenshots at 390 and 1280 px; `--compare nn=/route` for mock-up comparisons |
| `pnpm db:start` / `db:stop` / `db:reset` | Local Supabase; reset re-applies migrations and seeds                         |
| `pnpm test:db`                           | pgTAP database tests (RLS, grants, audit chain, RPCs)                         |
| `pnpm types`                             | Regenerate `src/types/database.ts` from the local database                    |

`pnpm seed:demo` arrives in M0.6.

## Money and dates

Money is integer cents and rates are integer basis points everywhere; all money logic lives in Postgres functions. The browser only formats values, through `src/lib/format.ts` (`$1,234.56`, `05 Feb 2026`, times in Africa/Monrovia).
