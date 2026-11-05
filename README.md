# Atlas Provisions

Atlas Provisions plans a household's week of home-cooked meals around local grocery flyer deals, a budget, and what people in the house can and cannot eat.

<img src="docs/screenshots/week.png" alt="Week view">

## What it does

- Plans a week that runs Sunday to Saturday, priced from the flyers valid on its Sunday (the shopping day), and keeps a shortlist of the best value per category.
- Plans the week with one Claude call that returns the meals and a batch-prep list together. The code then checks the plan (budget, allergies as a hard block, never-buy items, macros, waste, busy-night time caps, cravings, optional variety rules) and asks for a fix when a check fails, up to 3 attempts.
- Builds a shopping list grouped by store, with price-match hints when another store is cheaper, and a separate section for items no flyer covers.
- Keeps household defaults (people, eating schedule, fixed meals, equipment, allergies, time caps) and lets you change a single week (guests, eating out, shared meals) without changing the defaults.
- Tracks the pantry, with use-by dates, and can prefer ingredients that are about to expire ("use it up").
- Scans receipts with Claude vision (the same reader as Atlas Journeys) to record prices and add food to the pantry.
- Takes ratings on meals, so liked meals can come back and disliked ones are skipped.
- Imports flyer prices from Flipp for the catalogue's ingredients, near the household's postal code, every Sunday and on demand (see below).
- Shows a save indicator at the top of each screen: Saving, Saved, or Not saved with a retry. The shopping list ticks and the prep checklist are kept in this browser only.
- Signs in with an email code for an allow-list of addresses.

## Screens

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/meal.png" alt="Meal detail"><br>Meal detail: ingredients, steps, and a rating for the people eating it.</td>
    <td width="50%"><img src="docs/screenshots/list.png" alt="Shopping list"><br>Shopping list: one column per store, with used-in notes and price-match hints.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/plan.png" alt="Plan this week"><br>Plan: budget, cravings, and who is eating each meal. Changed cells are outlined in green.</td>
    <td width="50%"><img src="docs/screenshots/household.png" alt="Household"><br>Household: people, schedule, allergies, equipment, and variety rules.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/pantry.png" alt="Pantry"><br>Pantry: what is on hand, with use-by dates and items expiring soon.</td>
    <td width="50%"><img src="docs/screenshots/login.png" alt="Sign in"><br>Sign in: an email code, for addresses on the allow-list only.</td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/phone-week.png" alt="Week view on a phone" width="260"><br>
  Works on phones too.
</p>

## How it works

1. **Ingest.** Flyer items are read into a common shape: store, name, price, size, and valid dates. Flipp supplies them (see Flyer import below). Sample fixtures in `worker/fixtures/` stand in for flyers in local development.
2. **Normalize.** Each flyer name is matched to an ingredient in the catalogue by its aliases and size is converted to the ingredient's unit (kg, L or each). A Claude fallback for names the matcher cannot place is planned; the interface exists and is not wired up.
3. **Score.** A plan week is saved under its Sunday's date and priced from the flyers valid that day, since shopping happens on Sunday. Each ingredient keeps its cheapest unit price per store, measured against recent price history. Never-buy items are dropped, always-buy items are added, and the top 8 per category go to the planner.
4. **Plan.** One Claude call returns the meals for each slot and the batch-prep list for the prep day. Quantities are in each ingredient's unit, and the code, not the model, computes the cost.
5. **Validate.** The plan is checked in code. A failed check, such as a plan over budget or an allergen in a dish, is fed back to the model for another attempt, up to 3 attempts. A plan with errors is shown with the errors listed.
6. **List.** The saved plan becomes a shopping list: quantities are rounded up to whole packs, pantry stock is taken off first, and each item is placed at its cheapest enabled store.

## Households

Each signed-in address belongs to one household. The first address in a new household is its owner.

- Owners invite people by email. The invitee signs in with that address and joins the household as a member. Invites can be withdrawn, and a member can leave.
- An owner cannot leave while others remain, and there is no way to hand over ownership yet.
- Access: an address may use the app if it is on `ALLOWED_EMAILS`, is a member, or has an invite. An allow-listed address with no household gets its own.
- Pantry, plans, ratings, ticks and the household document are per household. Flyer prices are per postal code. Price history and receipt matches are shared.
- Monthly caps per household, counted in Toronto calendar months: plans (`PLAN_CAP_MONTHLY`, default 20), receipt scans (`RECEIPT_CAP_MONTHLY`, default 30) and prep refreshes (`PREP_CAP_MONTHLY`, default 30). The Household screen shows the counts.

## Stack

- Web: React, Vite, Tailwind CSS, React Router.
- Worker: Hono on Cloudflare Workers, with a D1 database (SQLite) for households, deals, plans, pantry, ratings and sessions.
- Shared: TypeScript types, zod schemas and the planning logic, used by both the web app and the Worker.
- Tests: vitest.

Models, each read from an environment variable with the default shown:

| Job | Variable | Default |
| --- | --- | --- |
| Weekly plan | `PLANNER_MODEL` (set in `wrangler.jsonc`) | `claude-sonnet-5-5` |
| Batch-prep regenerate | `PREP_MODEL` | `claude-haiku-5-5` |
| Receipt reading | `RECEIPT_MODEL` | `claude-sonnet-5-5` |
| Receipt fallback | `EXTRACT_MODEL` | `claude-haiku-5-5` |

The Anthropic key is `ANTHROPIC_API_KEY`, a Worker secret.

## Deploy

A GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push to `main`. It typechecks, creates the D1 database `atlas-provisions` if it does not exist, applies migrations to the remote database, builds the web app, and deploys the Worker to `adityajain.ca/provisions*`.

GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`: a token from the "Edit Cloudflare Workers" template, with the Account > D1 > Edit permission added, and the zone `adityajain.ca`.
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.

Worker secrets (Cloudflare dashboard: Workers & Pages > atlas-provisions > Settings > Variables and Secrets, type Secret):

- `ANTHROPIC_API_KEY`: the Claude API key for planning and receipts.
- `ALLOWED_EMAILS`: comma-separated addresses that may sign in, for example `you@example.com`. Unless RESEND_API_KEY is set, each address must be a verified destination in Cloudflare Email Routing, or the sign-in email is not delivered.
- `RESEND_API_KEY`: optional. Sign-in emails go through Resend when the RESEND_API_KEY secret is set (domain adityajain.ca verified in Resend); otherwise Cloudflare Email Routing, which only delivers to verified destination addresses.

`MAIL_FROM` and `PLANNER_MODEL` are variables in `wrangler.jsonc`.

Migration `0008_households.sql` changes live data. It moves every existing row into one household, `h1`, makes each address that has a session a member (the earliest is owner), and rebuilds `meal_plans`, `checks` and `flyer_items` with new primary keys. The old `household` table is left in place and unused. Before deploying to production:

- Export the database: `npx wrangler d1 export atlas-provisions --remote --output backup.sql`.
- Check that `ALLOWED_EMAILS` lists every address that should keep access. Membership is granted by sessions, so an address removed from `ALLOWED_EMAILS` keeps access while it is a member.
- Deploying runs the migration before the new Worker is live. For a few minutes the old Worker can run against the new tables, and its `ON CONFLICT(week_of)` upserts for plans and ticks fail. Deploy in a quiet period.

## Flyer import

Flyer prices come from Flipp, the flyer site. Flipp's public web app uses an unofficial JSON search endpoint, which is not a supported API, so the import is written defensively: any missing field is skipped, and a failed search is recorded instead of stopping the run. If Flipp changes its response, the run reports errors and the matched count drops to zero; the latest run's errors and a sample of raw items are kept in the `ingest_runs` table.

- Set the postal code in Household (Stores section). Flyers are read for that postal code. Only enabled stores are kept.
- The import reads the flyer list, keeps the flyers of enabled stores that are still valid (grocery flyers first, at most three per store), and reads each flyer's items. Flyer lines such as "A or B" are split into their products, each with the line's price.
- If that gives nothing, it falls back to a search by name, with at most 30 terms: meat, seafood, eggs and tofu first, then common produce.
- All requests in one run share a budget of 45, under Cloudflare's free-plan limit of 50 subrequests per run. Requests past it are not sent, and the run notes that it stopped early.
- Each run records its mode, the flyers it used, the raw item count, and a sample of three raw items. `GET /provisions/api/flyers/status?debug=1` returns the sample and the flyers of the latest run.
- The Worker runs the import hourly on Sundays (cron `0 * * * SUN` in `wrangler.jsonc`). Each run imports one postal code: the one that was tried longest ago, across all households, so every household's postal code gets its turn.
- The Household Stores section has a Flyers row with the last update and a Refresh flyers button, which runs the import on demand and reports what it found.
- Requests go out at most four at a time, spaced 250 ms apart, with a 10 second timeout, and a 429 or 5xx is retried once (each retry counts against the budget).
- This is for personal use. Flipp's terms of use are not reviewed here.

Status and a manual run are available at `GET /provisions/api/flyers/status` and `POST /provisions/api/flyers/refresh`.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars            # DEV=1, ALLOWED_EMAILS, DEV_AUTH_EMAIL
npx wrangler d1 migrations apply atlas-provisions --local
npx wrangler dev --port 8787              # terminal 1: the Worker and local D1
npm run dev                               # terminal 2: Vite dev server
```

Open the Vite URL it prints, at the /provisions/ path.

- Signing in locally: `POST /provisions/api/auth/request` with `{"email":"you@example.com"}`. The code is printed to the Worker's console, not emailed. Then `POST /provisions/api/auth/verify` with the email and the code, and keep the `ap_session` cookie.
- Sample data: with a session, `POST /provisions/api/dev/load-fixtures` loads the sample flyers and price history. This route is only available when `DEV=1`.
- Planning locally needs `ANTHROPIC_API_KEY` in `.dev.vars`.

## Project layout

```
shared/         catalogue, matching, scoring, planning, validation, list (shared types and tests)
worker/
  src/          Hono app, auth, D1 access, planner (prompt, run, claude, prep), receipts
  migrations/   D1 schema, 0001 to 0005
  fixtures/     sample flyers and price history
web/
  src/screens/  Week, List, Plan, Pantry, Household, Login
  src/components/, src/lib/
.github/workflows/deploy.yml
wrangler.jsonc
```

## Tests

`npm test` runs vitest over `shared/`, `worker/` and the web view helpers in `web/src/lib/`. The current run has 366 tests in 28 files. `npm run typecheck` checks the web and Worker projects.

## Roadmap

- A Claude fallback for flyer lines the alias matcher cannot place.
- Use the confirmed item matches from receipts when reading new receipts.
- More protein variety in the shortlist. Scoring keeps 8 items per category, which can leave out chicken and beef for a whole week.
