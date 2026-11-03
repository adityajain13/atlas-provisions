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

## Testing

`npm test` runs vitest over `shared/` and `worker/`. The tests cover pure logic only
(parsing, matching, scoring, catalogue invariants, the fixture match rate). D1 access in
`worker/src/db.ts` is not unit tested.

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
