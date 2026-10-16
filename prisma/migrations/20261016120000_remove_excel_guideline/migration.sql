-- Remove the Excel estimation template's calculation tables.
--
-- The valuator now enters the market and forced-sale values; nothing
-- calculates a figure, so the guideline reference tables taken from the Excel
-- template (guideline.*) and the switches that corrected its known issues
-- (excel_fixes.switches) are no longer read. They were added to every
-- parameter set by migrations 20261009120000 and 20261012100000, which stay in
-- place as history; their SQL can restore the tables if they are ever needed.
--
-- Valuations calculated with these tables keep their full working: each
-- calculation run and signed report holds its own snapshot.
--
-- Data only: there is no schema change in this migration.
DELETE FROM "valuation_parameters"
WHERE "key" LIKE 'guideline.%'
   OR "key" = 'excel_fixes.switches';
