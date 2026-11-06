-- Indexes for the queries that scan by date or by week. Each one is for a query that otherwise reads whole tables.

-- priceHistory reads every row since a date, across sources; householdReceiptPrices reads one household's receipts by date.
CREATE INDEX IF NOT EXISTS price_history_date ON price_history(date);
CREATE INDEX IF NOT EXISTS price_history_hh ON price_history(household_id, source, date);

-- Week lookups and the Sunday prune (pruneWeeksBefore) filter on week_of, which is not the leading key of these primary keys.
CREATE INDEX IF NOT EXISTS meal_plans_week ON meal_plans(week_of);
CREATE INDEX IF NOT EXISTS checks_week ON checks(week_of);
CREATE INDEX IF NOT EXISTS meal_status_week ON meal_status(week_of);
