-- Unite cl (10 ml) et equivalence poids/volume par ingredient (poids d'une
-- cuillere a soupe en grammes). Migration additive : colonne nullable et
-- nouvelle valeur d'enumeration, compatibles avec le code deja deploye.
ALTER TYPE "Unit" ADD VALUE 'CL';
ALTER TABLE "ingredients" ADD COLUMN "grams_per_tablespoon" DOUBLE PRECISION;
