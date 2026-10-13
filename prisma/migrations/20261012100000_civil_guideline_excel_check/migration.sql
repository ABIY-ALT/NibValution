-- What recalculating the estimation template in Excel itself showed
-- (scripts/guideline/excel: 55 scenarios typed into the template and compared
-- figure by figure with the engine).
--
--   * The progress sheet keeps its own, shorter list of condition defects:
--     it cannot record the three floor-finish defects (codes 31-33), so a
--     building's value as it stands is depreciated without them. The list is
--     added to guideline.condition_defects as progressCodes.
--   * Two more workbook slips get correction switches, both off so the figures
--     stay the workbook's: poolOwnFinishes (Excel prices every pool with the
--     finishes named on the first row of plot civil works) and
--     progressFloorDefects (depreciate the current stage for floor-finish
--     defects too).
--
-- No calculation is stored under the formula these tables serve (civil-2.0.0)
-- yet, so no recorded figure changes. The tables are completed in place; an
-- entry already present is left as it is.

UPDATE "valuation_parameters"
SET "jsonValue" = "jsonValue" || '{"poolOwnFinishes": false, "progressFloorDefects": false}'::jsonb
WHERE "key" = 'excel_fixes.switches'
  AND NOT ("jsonValue" ? 'poolOwnFinishes');

UPDATE "valuation_parameters"
SET "jsonValue" = jsonb_set(
  "jsonValue",
  '{progressCodes}',
  '[7, 8, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25, 27, 28, 29, 35, 36, 38, 39]'::jsonb
)
WHERE "key" = 'guideline.condition_defects'
  AND NOT ("jsonValue" ? 'progressCodes');
