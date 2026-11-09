# Atlas Provisions

Weekly meal planner for a household. It reads the local grocery flyers, plans the week's meals around the deals, your budget and what everyone can eat, then gives you a shopping list split by store.

**Live:** [adityajain.ca/provisions](https://adityajain.ca/provisions) (sign-in is allow-listed)

<img src="docs/screenshots/week.png" alt="Week view">

## What it does

- **Plans a week** (Sunday to Saturday) with one Claude call that returns the meals plus a batch-prep list. The code checks the plan against the budget, allergies, never-buy items, time caps and cravings, and sends it back for a fix if anything fails (up to 3 tries).
- **Prices it from real flyers** pulled from Flipp for your postal code, plus regular shelf prices from Loblaw-family store sites and T&T (through a browser extension).
- **Shopping list** grouped by store, rounded up to whole packs, with what's already in the pantry taken off.
- **Pantry** with use-by dates; the planner can lean on things about to expire.
- **Receipt scanning** to log prices and stock the pantry.
- **Households** with invites, per-person schedules and allergies, and one-off changes for a single week (guests, eating out).

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/meal.png" alt="Meal detail"></td>
    <td width="50%"><img src="docs/screenshots/list.png" alt="Shopping list"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/plan.png" alt="Plan this week"></td>
    <td width="50%"><img src="docs/screenshots/household.png" alt="Household"></td>
  </tr>
</table>

## Stack

React + Vite + Tailwind on the front, a Hono app on Cloudflare Workers with D1 behind it, and a `shared/` package (types, zod schemas, the matching, scoring and validation logic) used by both. Claude does the planning and receipt reading; everything numeric (costs, quantities, checks) is done in code.

## Run it locally

```sh
npm install
npm test            # vitest across shared/, worker/ and web/src/lib
npm run typecheck
```

The tests cover the matching, scoring and plan checks without any setup. Running the full app needs a Worker, a database and API keys.

## Layout

```
shared/      catalogue, flyer matching, scoring, plan validation, list building (+ tests)
worker/      Hono API, auth, D1 access, planner, receipts, flyer and price imports
  migrations/
  fixtures/  sample flyers for local dev
web/         React app (screens: Week, Plan, List, Pantry, Household)
extension/   browser extension that syncs T&T prices
```

## Known gaps

- Flyer lines the alias matcher can't place are dropped. A Claude fallback is stubbed but not wired up.
- Scoring keeps the top 8 items per category, which can leave a whole protein out of a week.
- No way to hand over household ownership yet.
