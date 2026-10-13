-- Roles gain an enabled/disabled state so a role can be retired without being
-- deleted: the audit trail names the role a person held when they acted, and
-- that name must keep resolving.
ALTER TABLE "roles" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Property and document categories gain the free-text description that request
-- types already carry, so the administrator who creates one can say what it is
-- for rather than leaving the next person to infer it from the code.
ALTER TABLE "property_categories" ADD COLUMN     "description" TEXT;
ALTER TABLE "document_categories" ADD COLUMN     "description" TEXT;

-- ---------------------------------------------------------------------------
-- NOTE FOR WHOEVER GENERATES THE NEXT MIGRATION
-- ---------------------------------------------------------------------------
-- `prisma migrate dev` proposed dropping seven GIN trigram indexes here, as it
-- did for the previous migration:
--
--   civil_properties_lhc_trgm, machinery_serial_trgm, vehicles_plate_trgm,
--   vehicles_chassis_trgm, valuation_cases_owner_name_trgm,
--   valuation_cases_applicant_name_trgm, valuation_cases_case_number_trgm
--
-- Those DROP statements were deliberately removed. Prisma has no syntax for a
-- GIN trigram index, so it cannot see them in schema.prisma and reports them as
-- drift on every generation. They are not drift - they are what makes the
-- partial-match search in spec section 24 possible ("show me anything with
-- Tesfaye in the owner name"); a b-tree cannot serve that query.
--
-- Every future migration will propose the same drops. Strip them, exactly as
-- here, or the search silently degrades to full table scans.
-- See prisma/migrations/README.md.
