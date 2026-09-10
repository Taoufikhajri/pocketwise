# Pocketwise

A personal money manager for daily income, expenses, and monthly budgets. Canadian dollars (CAD) are the default. Built with JavaScript, Vite, and Supabase, ready for GitHub and Vercel.

## What you get

- Responsive dashboard for desktop and phone.
- Add, edit, delete, search, and filter transactions by month, type, and category.
- Bank, cash, and credit card labels for transactions.
- Monthly category budgets, progress bars, overspending notices, and copying the previous month's plan.
- Category spending charts and six-month income/expense reports.
- Email/password sign-up, sign-in, email confirmation, password reset, and persistent sessions.
- Account-backed records available across devices, with refresh on return to the app and every 30 seconds.
- CSV exports and full JSON backup/restore.
- Separate sample-data demo, available before setup or sign-in.
- Database row-level security: users can access only their own records.

## Deploy: GitHub → Supabase → Vercel

### 1. Upload this folder to GitHub

1. Extract `pocketwise-source.zip`.
2. Create a new GitHub repository, for example `pocketwise`.
3. Upload **the contents of the `pocketwise` folder**, so `package.json`, `index.html`, and `vercel.json` are at the repository root. Include `src`, `public`, `supabase`, and `tests`.
4. Include `.gitignore` and `.env.example`. Do not upload `.env`, `node_modules`, or `dist`.

You can use GitHub's **Add file → Upload files**, GitHub Desktop, or Git. If you put the entire `pocketwise` folder inside your repository instead, select that folder as Vercel's Root Directory in step 3.

### 2. Create the database and authentication project

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor**, create a new query, and paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Run the query once. It creates the tables, access policies, and atomic budget/restore functions. This script targets a **new project**; don't rerun it over existing tables.
4. In **Authentication → Providers**, enable email/password sign-in. Keep email confirmation enabled.
5. Copy the **Project URL** and **publishable key** from the project's Connect dialog or API key settings.

Only use the **publishable** key (or legacy public `anon` key). **Never use a secret or `service_role` key in this frontend.** Public browser keys rely on the included row-level policies for account isolation. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

### 3. Import the GitHub repository into Vercel

1. At [Vercel](https://vercel.com/new), choose **Add New → Project** and import your GitHub repository.
2. Select **Vite** as the Framework Preset. The included configuration sets:
   - Build Command: `npm run build`
   - Install Command: `npm ci` (uses the included `package-lock.json`)
   - Output Directory: `dist`
   - Node.js: `24.x` (use a current Node 24 release locally, at least 24.15)
3. Add these environment variables for Production and Preview:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Your project URL, such as `https://your-project.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable key |

4. Click **Deploy**.

These values are embedded when Vite builds the app. Adding or changing them afterward requires a **Redeploy**. Without them, the app intentionally opens in demo mode. [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build).

### 4. Set the authentication URLs

After Vercel gives you a production address:

1. In Supabase, open **Authentication → URL Configuration**.
2. Set **Site URL** to your production origin, for example `https://your-app.vercel.app`.
3. Add that same URL to **Redirect URLs**. For local development, also add `http://127.0.0.1:5173`.
4. If testing a preview deployment, add its exact origin to the allowed redirect list too.
5. Open your app, click **Sign in to save & sync → Create an account**, and confirm the email.
6. Return to the app and sign in. Your real workspace starts empty; sample records do not become your financial records.

For signup or password-reset emails to addresses outside your Supabase project team, configure an email provider in Supabase's authentication email/SMTP settings. The default email service is restricted to authorized team addresses and is intended for testing; see [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Run on your computer

Install a current [Node.js 24](https://nodejs.org/) release (24.15 or newer).

```sh
npm install
```

Copy `.env.example` to `.env`, then paste the same two public Supabase values. This step is optional for the demo.

```sh
npm run dev
```

Open the local address printed in the terminal. Changes to `.env` need a development-server restart.

```sh
npm test
npm run build
npm run preview
```

## How the money tracking works

- Amounts are stored as positive integer cents. The transaction's income/expense type determines the direction. Calculations avoid floating-point decimal rounding.
- “Money left this month” means that month's income minus expenses. It is **not** your actual bank balance, credit-card liability, or carried-forward savings.
- Accounts are labels for where a transaction happened. Transfers, opening balances, bank imports, and reconciliation are not part of this version.
- Total monthly budget is the sum of category limits. All expenses, including categories without limits, count against that total. Category progress compares only that category's spending to its own limit.
- Budgets apply to one month. Use **Copy previous month** to carry limits forward and review them before saving.
- Reports use transaction dates. You can enter past or future dates; future-dated entries are included in the selected month. Average daily expense divides by all calendar days in that month.
- CAD is the default. USD, PHP, EUR, GBP, AUD, and INR are available. Currency is one account-wide display unit; changing it relabels amounts and **does not perform exchange conversion**.
- This app records money manually. There are no bank connections, automatic bill payments, scheduled transactions, or financial recommendations.

## Sync, backups, and privacy

Signed-in records are stored in your Supabase project, not in the code repository or Vercel build. Session tokens are kept in browser storage by the Supabase client; sign out on shared devices. The demo keeps sample records in memory only and resets on reload.

An internet connection is required to save real records. The app does not queue offline writes. A successful save is confirmed after the database accepts it; errors remain visible so you can retry. Background refresh runs every 30 seconds while the page is visible, outside dialogs or active inputs, and on return to the app. Use **Refresh** for an immediate update. Changes to the same transaction are last-write-wins; each budget save replaces the selected month's category limits. Avoid simultaneous edits or restores from two devices.

**Settings & data → Download backup** exports all records and preferences. **Restore** validates a Pocketwise JSON file, shows its transaction and budget counts, and asks before replacing the current user's data. Replacement happens in one database transaction: an invalid row rolls back the entire change. Restored transactions receive new IDs. Other users' records are untouched.

Backups support up to 20,000 transactions and 3,000 category budgets, with a 64 MB file cap. Keep backup files private: they contain your financial notes and amounts. CSV export is for spreadsheets; CSV import is not implemented. Account email/password and session tokens are never included in backups.

## Verification and launch checklist

The automated suite covers exact-cents arithmetic, dates, month/category totals, backup validation/size, CSV formula escaping, transaction create/edit/search/delete, budget edits, DOM injection escaping, database account isolation, anonymous access denial, and atomic restore rollback. Database tests run the supplied SQL inside PGlite (PostgreSQL) with test authentication roles. UI interaction tests run the actual app bundle in jsdom.

The production build and these tests were checked during delivery. **Live Supabase email delivery, live authentication, two-device syncing, and browser visual layout still need verification using your deployed project.** No real backend credentials were supplied with the source.

Before entering your actual finances:

1. Register and confirm a test account. Add an expense on one device; sign in with the same account on a second device and press Refresh. Check the entry appears.
2. Edit and delete the test entry. Verify both devices agree after Refresh.
3. Register a second, different test account. Verify its workspace is empty and cannot see the first account's records.
4. Test the “Forgot password?” email and password update.
5. Set a small category budget and add an expense over its limit; check the warning and monthly totals.
6. Download a backup, make a temporary change, and restore the backup. Check the original totals return.
7. Check the desktop and mobile layouts and keyboard navigation in your browsers.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Always opens the setup/demo message | Check both `VITE_` environment variables, then redeploy. |
| Sign-in fails | Confirm the email, verify your password, and check the Supabase URL/key. |
| Email link redirects to the wrong place | Set Supabase Site URL and allowed Redirect URLs to your deployment's origin. |
| Confirmation or reset email does not arrive | Check spam and Supabase's email sending configuration/restrictions. |
| “Relation does not exist” / schema cache error | Run `supabase/schema.sql` once in the correct new project. |
| “Permission denied” saving records | Make sure the entire SQL script ran, including policies and grants. |
| Records do not appear on a second device | Use the same account and same backend configuration, close open dialogs, then Refresh. |
| Data loading fails | Check connectivity and Supabase project availability; fix the issue and Refresh. |
| Build fails locally | Use current Node 24, install dependencies, and rerun `npm run build`. |

## Source map

```text
src/app.js            Application state, events, dialogs, authentication
src/views.js          Escaped HTML templates and data-driven charts
src/finance.js        Money calculations, validation, CSV, demo records
src/data.js           Supabase database access
src/styles.css        Responsive layout and styling
supabase/schema.sql  Tables, row-level policies, budget/restore functions
tests/               Finance, interaction, and database tests
vercel.json          Vercel build and response-header configuration
.env.example         Required public configuration variable names
```

This is an original implementation inspired by common expense-manager workflows. It does not copy Money Manager's source code or branding.
