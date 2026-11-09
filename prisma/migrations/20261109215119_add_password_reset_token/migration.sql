-- Stockage du token de réinitialisation de mot de passe côté base pour
-- permettre la révocation après usage. On stocke le hash bcrypt (jamais
-- le token brut) et une date d'expiration. Migration additive : deux
-- colonnes nullable, aucune donnée existante n'est affectée.
ALTER TABLE "users" ADD COLUMN "password_reset_token" TEXT;
ALTER TABLE "users" ADD COLUMN "password_reset_expiry" TIMESTAMP(3);

-- Contrainte d'unicité sur le hash (deux utilisateurs ne peuvent pas avoir
-- le même token actif simultanément ; garantit aussi l'index de recherche).
CREATE UNIQUE INDEX "users_password_reset_token_key" ON "users"("password_reset_token");
