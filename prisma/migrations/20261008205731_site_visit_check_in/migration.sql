-- Site visits become GPS check-ins: the phone's position, its accuracy, the
-- distance from the property, and the verdict - with the radius and accuracy
-- limit in force when it was judged, so a later configuration change does not
-- re-judge an old visit.
--
-- The generated proposal also dropped the seven trigram search indexes; those
-- lines were removed (prisma/migrations/README.md, section 1).

-- CreateEnum
CREATE TYPE "SiteVisitCheck" AS ENUM ('VERIFIED', 'OUTSIDE_RADIUS', 'LOW_ACCURACY', 'LOCATION_SET', 'NO_LOCATION');

-- AlterTable
ALTER TABLE "site_visits" ADD COLUMN     "accuracyMeters" DECIMAL(10,2),
ADD COLUMN     "distanceMeters" DECIMAL(12,2),
ADD COLUMN     "locationCheck" "SiteVisitCheck" NOT NULL DEFAULT 'NO_LOCATION',
ADD COLUMN     "maxAccuracyMeters" INTEGER,
ADD COLUMN     "radiusMeters" INTEGER;
