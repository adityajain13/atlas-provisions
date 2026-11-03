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
