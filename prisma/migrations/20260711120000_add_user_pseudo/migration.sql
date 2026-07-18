-- AlterTable: add pseudo as nullable first (existing rows have none yet)
ALTER TABLE "users" ADD COLUMN "pseudo" TEXT;

-- Backfill: give existing rows a placeholder unique pseudo derived from their id
UPDATE "users" SET "pseudo" = 'user_' || substring(replace("id", '-', ''), 1, 12)
WHERE "pseudo" IS NULL;

-- AlterTable: pseudo is now required
ALTER TABLE "users" ALTER COLUMN "pseudo" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_pseudo_key" ON "users"("pseudo");
