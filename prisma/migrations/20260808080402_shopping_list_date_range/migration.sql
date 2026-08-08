-- Remplace la semaine fixe (week_start) par une plage libre (period_start,
-- period_end). Les listes existantes deviennent des plages de 7 jours
-- (lundi -> dimanche), pour preserver leur sens.
ALTER TABLE "shopping_lists" RENAME COLUMN "week_start" TO "period_start";
ALTER TABLE "shopping_lists" ADD COLUMN "period_end" DATE;
UPDATE "shopping_lists" SET "period_end" = "period_start" + INTERVAL '6 days';
ALTER TABLE "shopping_lists" ALTER COLUMN "period_end" SET NOT NULL;

-- L'ancienne contrainte "une liste par semaine" ne s'applique plus a une
-- plage libre.
DROP INDEX IF EXISTS "shopping_lists_user_id_week_start_key";

-- Contrainte d'exclusion : aucune liste d'un meme utilisateur ne peut
-- couvrir un jour deja couvert par une autre de ses listes. Equivalent,
-- pour une plage libre, de l'ancienne contrainte d'unicite par semaine :
-- meme garantie au niveau base (protege aussi contre une double soumission
-- concurrente), qui a evite un stock double compte en production.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "shopping_lists"
  ADD CONSTRAINT "shopping_lists_no_overlap"
  EXCLUDE USING gist (
    "user_id" WITH =,
    daterange("period_start", "period_end", '[]') WITH &&
  );
