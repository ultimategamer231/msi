# Deploying LoanDesk (GitHub, Supabase, Vercel)

A step-by-step guide to putting LoanDesk online from the downloaded package. It takes about an hour the first time. You need:
- a GitHub account;
- a Supabase account (the Pro plan for production, which includes daily backups);
- a Vercel account.

On your computer you need [Node.js 22](https://nodejs.org), [pnpm 10](https://pnpm.io/installation) (`npm install -g pnpm@10`) and Git. The PostgreSQL client (`psql`) is optional; every SQL step below can also be pasted into the Supabase SQL editor.

Never paste keys or passwords into chat, issues or code. They go only into the Supabase and Vercel dashboards, and into `.env.local` on your own computer.

## 1. Put the code in your GitHub repository

1. Unzip `loandesk-source.zip` into a folder, for example `loandesk`.
2. On GitHub, create a new **private** repository (empty: no README, no licence).
3. In a terminal:
   ```bash
   cd loandesk
   git init -b main
   git add .
   git commit -m "LoanDesk M0–M9"
   git remote add origin https://github.com/<your-account>/<your-repo>.git
   git push -u origin main
   ```
   - **Full history:** if you also want the full development history, use `loandesk-full.bundle` instead: `git clone loandesk-full.bundle loandesk`, then `cd loandesk`, `git checkout -b main origin/claude/new-session-6ictcc`, `git remote set-url origin <your repo URL>`, `git push -u origin main`.
   - **CI:** the GitHub Actions workflows in `.github/workflows` start on every push. They run lint, the database tests and the browser tests against a throwaway local database, so they need no secrets.

## 2. Create the Supabase project

1. In Supabase, create an organisation on the Pro plan, then create a project `loandesk-prod`. Choose a region close to Liberia (for example London, `eu-west-2`) and save the database password in your password manager. For a test site first, create `loandesk-staging` the same way; the free plan is enough there.
2. Install the tools and connect the code to the project:
   ```bash
   pnpm install
   pnpm supabase login                     # opens the browser
   pnpm supabase link --project-ref <ref>  # <ref> is in the project URL: https://<ref>.supabase.co
   ```
3. **Create the database.** This applies every migration: tables, security rules, functions, the nightly job and the storage buckets.
   ```bash
   pnpm supabase db push
   ```
   Do **not** use `--include-seed`: it would also run `seed_local.sql`, which marks the database as a development copy.
4. **Load the base data** (company details, branches, chart of accounts, the standard product and settings). Run `supabase/seed/seed_core.sql` once:
   - with psql: `psql "<connection string>" -f supabase/seed/seed_core.sql`. The connection string is in Project Settings → Database → Connection string → URI, with your password filled in;
   - or open the file, copy everything, and run it in the dashboard's SQL editor.

   It is safe to run again: rows that already exist are left alone.
5. **Mark a staging project as staging** (skip this for production, which is the default). In the SQL editor:
   ```sql
   update public.app_environment set kind = 'staging' where id;
   ```
6. **Auth settings** (Authentication → Sign In / Providers, and Settings):
   - Turn **off** "Allow new users to sign up". Only the admin creates users.
   - Email provider: minimum password length **10**.
   - URL configuration: Site URL = your Vercel address (step 3), for example `https://loandesk.vercel.app`.
7. **Create the first admin.**
   1. Go to Authentication → Users → Add user → Create new user. Enter your email and a strong password, and tick *Auto confirm user*.
   2. In the SQL editor, run:
      ```sql
      insert into public.profiles (id, full_name, role, active)
      select id, 'Your Name', 'admin', true from auth.users where email = 'you@example.com';
      ```

   Every other user is then created by this admin in LoanDesk, under Settings → Users.
8. **Keys for Vercel:** in Project Settings → API, copy the **Project URL**, the **anon public** key and the **service_role** key. The service role key is secret: put it only in Vercel.

## 3. Create the Vercel project

1. In Vercel: Add New → Project → import your GitHub repository. Vercel detects Next.js and pnpm by itself, so leave the build settings as they are.
2. In Settings → General → Node.js Version, choose **22.x**.
3. Under Environment Variables (Production, and Preview if you use it), add:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | the Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role key (secret) |

4. Deploy. When it finishes, open `https://<your-site>/api/health`. It should show `{"status":"ok","database":"ok",…}`.
5. Put this address in Supabase as the Site URL (step 2.6). If you use your own domain, add it in Vercel → Domains first.

## 4. First sign-in and set-up

1. Sign in as the admin.
2. **Settings → Company**:
   - check the name, address, phone and email;
   - upload the logo `public/brand/msi-logo.png` from the package.
3. **Settings → Branches**: check the three branches and add their phone numbers.
4. **Settings → Users**: create the staff accounts (CEO, managers, accountant, cashiers, loan officers) with their branches.
5. **Settings → Loan products and Rules**: check the standard product (20% flat, 1 month) and the limits.
6. Enter the opening balances and the old loans, as described in `docs/OPERATIONS.md` section 4 ("Going live"). Then set the **go-live date** in Settings.

## 5. Updates later

- **Code changes:** push to `main`. Vercel deploys by itself.
- **New database migrations** (new files in `supabase/migrations`): run `pnpm supabase db push` against the linked project before or right after the deploy.
- **Backups:** follow `docs/OPERATIONS.md` section 6 (weekly `scripts/backup.sh`, and a restore test before go-live).

## 6. Optional: a demo site

The demo data (`pnpm seed:demo`) fills a **local** database that runs in Docker on your computer (`pnpm db:start`). It is meant for demonstrations and screenshots, so keep it away from the production project. Running a hosted demo needs a separate Supabase project marked as `demo`; ask before setting one up.
