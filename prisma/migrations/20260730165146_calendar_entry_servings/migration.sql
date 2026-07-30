-- AlterTable
ALTER TABLE "calendar_entries" ADD COLUMN     "servings" INTEGER NOT NULL DEFAULT 1;

-- Backfill: les entrées existantes n'avaient pas de notion de portions,
-- on suppose qu'elles utilisaient les portions de base de leur recette.
UPDATE "calendar_entries"
SET "servings" = "recipes"."servings"
FROM "recipes"
WHERE "recipes"."id" = "calendar_entries"."recipe_id";
