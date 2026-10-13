-- Supporting documents are optional: a request can be submitted, and a
-- valuation sent for checking, without any upload (bank request, 2026-10-09).
--
-- The required-documents guard stays in place and reads this flag, so marking
-- a category mandatory again restores the requirement for that category.
UPDATE "document_categories" SET "isMandatory" = false WHERE "isMandatory" = true;
