# Atlas Provisions

A weekly meal-planning web app for a household. It tracks people, their default
eating schedule, fixed meals, equipment, stores and shopping rules, and will
plan each week around local grocery flyer deals and a budget.

Stack: React + Vite + Tailwind (web), Cloudflare Worker with Hono and D1 (worker),
and shared TypeScript types and zod schemas (shared). Served at `/provisions/` on
adityajain.ca.

## Local development

```sh
npm install
npx wrangler d1 create atlas-provisions      # paste the database_id into wrangler.jsonc
npm run db:migrate:local
npm run dev:worker                           # terminal 1: Worker on :8787
npm run dev                                  # terminal 2: Vite on :5173
```

Open http://localhost:5173/provisions/

## Sign-in

Sign in with an email code, the same as Atlas Journeys. The app emails a 6-digit code and a
one-tap link. Only addresses in `ALLOWED_EMAILS` get a code, and a session lasts a year and rolls
forward on use. Only a SHA-256 of the session token is stored, in D1 (`sessions`). Every
`/provisions/api/*` route needs a session except `/provisions/api/health` and `/provisions/api/auth/*`.

Set-up (once):

1. `ALLOWED_EMAILS` secret: `npx wrangler secret put ALLOWED_EMAILS`, then your address. Without it nobody can sign in.
2. Email Routing: the `send_email` binding only delivers to **verified destination addresses**. Verify the
   `ALLOWED_EMAILS` address in Cloudflare Email Routing.
3. Sender: `MAIL_FROM` in `wrangler.jsonc` is `provisions@adityajain.ca`. If Cloudflare refuses mail from that
   address, add it as a custom address in Email Routing (it does not need a routing rule). This was not
   checked against the live zone.
4. Migrations: `0004_auth.sql` adds `login_codes` and `sessions`. The deploy workflow applies it. By hand:
   `npx wrangler d1 migrations apply atlas-provisions --remote`.

Local dev: `.dev.vars` (copied from `.dev.vars.example`) sets `DEV=1` and `DEV_AUTH_EMAIL`. With both set,
the Worker prints the code and one-tap link to its console and sends no mail. Use an address from
`ALLOWED_EMAILS`. `DEV` is `0` in `wrangler.jsonc`, so this is off in deploys.

## Flyer data and deals (dev fixtures)

The flyer and price-history fixtures under `worker/fixtures/` are invented sample
prices for testing. They are not real store prices.

To load them locally, copy `.dev.vars.example` to `.dev.vars` (this enables the dev
route), start `npm run dev:worker`, then:

```sh
curl -X POST http://localhost:8787/provisions/api/dev/load-fixtures
curl "http://localhost:8787/provisions/api/deals?date=2026-11-12"
```

The dev route returns 404 unless `DEV=1`. It is `0` in `wrangler.jsonc`, so it is off in deploys.

## Planner

A plan is one Claude call that returns the meals and the batch-prep list together; "Regenerate prep" is a separate Haiku call that rebuilds only the prep.

## Testing

`npm test` runs vitest over `shared/` and `worker/`. Most tests cover pure logic (parsing, matching,
scoring, catalogue invariants, the fixture match rate, sign-in helpers). The sign-in tests run the real
Worker app against an in-memory D1 stub and a stub mailer, so they make no network calls. `worker/src/db.ts`
is not unit tested.

## Deploy

```sh
npx wrangler d1 migrations apply atlas-provisions --remote
npm run deploy
npx wrangler secret put ANTHROPIC_API_KEY    # needed from the planner milestone on
```

## Roadmap

- Flyer ingest
- Deal scoring
- Claude planner with a validator
- Receipt scanning
- Price-match hints
- Prep plan
