-- Site photos carry the phone's position and are judged against the property
-- like a check-in; site visits notify the Maker Manager.
--
-- The generated proposal also dropped the seven trigram search indexes; those
-- lines were removed (prisma/migrations/README.md, section 1).

-- AlterTable
ALTER TABLE "property_documents" ADD COLUMN     "accuracyMeters" DECIMAL(10,2),
ADD COLUMN     "distanceMeters" DECIMAL(12,2),
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "locationCheck" "SiteVisitCheck",
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "siteVisitId" UUID;

-- CreateIndex
CREATE INDEX "property_documents_siteVisitId_idx" ON "property_documents"("siteVisitId");

-- AddForeignKey
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "site_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Configuration and notification rules for site visits. Inserted here rather
-- than left to the seed, because re-running the seed also resets the seeded
-- users' passwords. Existing rows are left exactly as an administrator set them.
INSERT INTO "system_configurations" ("id", "key", "value", "valueType", "description", "updatedAt") VALUES
  (gen_random_uuid(), 'site_visit.radius_meters', '200', 'number', 'How close to the property, in metres, a site check-in must be to count as verified on site. Widen it for large compounds.', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'site_visit.max_accuracy_meters', '100', 'number', 'The vaguest GPS fix, in metres, a check-in may report and still be judged. A vaguer fix is recorded as low accuracy.', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'site_visit.require_on_site', '0', 'number', 'Set to 1 so a case can be submitted for checking only with a visit checked in at the property, or one whose remarks explain why it could not be.', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "notification_rules" ("id", "eventType", "roles", "channels", "template", "updatedAt") VALUES
  (gen_random_uuid(), 'SITE_VISIT_RECORDED', '["MAKER_MANAGER"]', '["IN_APP"]', 'site-visit-recorded', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SITE_VISIT_FLAGGED', '["MAKER_MANAGER"]', '["IN_APP", "EMAIL"]', 'site-visit-flagged', CURRENT_TIMESTAMP)
ON CONFLICT ("eventType") DO NOTHING;
