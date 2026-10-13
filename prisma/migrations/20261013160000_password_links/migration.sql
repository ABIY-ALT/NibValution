-- Emailed one-time links to set up or reset a password, replacing the
-- temporary passwords an administrator used to hand out. Only the SHA-256 of
-- each token is stored.

-- CreateEnum
CREATE TYPE "PasswordTokenPurpose" AS ENUM ('SETUP', 'RESET');

-- CreateTable
CREATE TABLE "password_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "PasswordTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_tokens_tokenHash_key" ON "password_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_tokens_userId_usedAt_idx" ON "password_tokens"("userId", "usedAt");

-- AddForeignKey
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- How long an emailed link stays usable. Inserted here rather than left to the
-- seed, because re-running the seed also resets the seeded users' passwords.
INSERT INTO "system_configurations" ("id", "key", "value", "valueType", "description", "updatedAt") VALUES
  (gen_random_uuid(), 'security.password_link_hours', '24', 'number', 'How many hours an emailed set-up or reset-password link stays valid. Each link works once.', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
