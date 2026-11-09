---
name: cookthatone-api
description: Liste tous les endpoints REST du backend CookthatOne (auth, recipes, calendar, stock, shopping) avec méthode, route et contrat attendu. À invoquer avant de créer, modifier ou consommer une route API, pour garder les routes, verbes HTTP et payloads cohérents avec le contrat déjà défini.
---

# Endpoints API — CookthatOne Backend

Règle transverse : toutes les routes sauf `/auth` sont protégées par `JwtAuthGuard`. Le `userId`
est **toujours** extrait du token JWT (`req.user.id`), **jamais** passé dans l'URL ou le body.
Swagger est disponible sur `/api/docs` et doit rester à jour (décorateurs `@ApiTags`,
`@ApiOperation`, etc. sur chaque route).

## Auth — `/auth`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Non | créer un compte → message de confirmation ; email de vérification envoyé |
| POST | `/auth/login` | Non | connexion → `{ access_token }` |
| GET | `/auth/me` | Oui | profil utilisateur connecté |
| GET | `/auth/verify-email?token=` | Non | valider l'adresse email depuis le lien reçu par email (réponse HTML) |
| POST | `/auth/forgot-password` | Non | demande de réinitialisation `{ email }` → message générique (throttle 3/15 min/IP) |
| POST | `/auth/reset-password` | Non | réinitialisation `{ token, newPassword }` ; token `purpose: 'password-reset'`, durée 1 h |
| POST | `/auth/resend-verification` | Non | renvoi du mail de vérification `{ email }` → message générique (throttle 3/15 min/IP) |
| PATCH | `/auth/change-password` | Oui | changement connecté `{ currentPassword, newPassword }` ; vérifie le mot de passe actuel |

**Contrat de sécurité** :
- `/auth/forgot-password` et `/auth/resend-verification` : réponse toujours identique (ne révèle pas l'existence d'un compte). Throttle dédié : 3 req / 15 min par IP.
- `/auth/reset-password` : le token doit avoir `purpose: 'password-reset'` ; un token `email-verification` est rejeté (401), et vice-versa.
- `/auth/change-password` : `userId` extrait du JWT, jamais du body ou de l'URL.

## Recipes — `/recipes`

| Méthode | Route | Description |
|---|---|---|
| GET | `/recipes` | lister ses recettes (`search?`, `page?`, `limit?`) |
| POST | `/recipes` | créer une recette (titre, ingrédients, étapes) |
| GET | `/recipes/:id` | détail d'une recette + ingrédients + étapes |
| PATCH | `/recipes/:id` | modifier une recette |
| DELETE | `/recipes/:id` | supprimer une recette |
| POST | `/recipes/:id/ingredients` | ajouter un ingrédient à la recette |
| PATCH | `/recipes/:id/ingredients/:iid` | modifier la quantité et/ou l'unité d'une ligne (même contrôle d'unité que l'ajout) |
| DELETE | `/recipes/:id/ingredients/:iid` | retirer un ingrédient |
| PUT | `/recipes/:id/steps` | remplacer toutes les étapes |

## Calendar — `/calendar`

| Méthode | Route | Description |
|---|---|---|
| GET | `/calendar/week` | entrées de la semaine en cours (`date?`) |
| GET | `/calendar` | entrées entre deux dates (`from`, `to`) |
| POST | `/calendar` | planifier une recette sur un créneau |
| PATCH | `/calendar/:id/move` | déplacer (drag & drop) → `{ plannedDate, mealSlot }` |
| PATCH | `/calendar/:id/validate` | valider repas → `{ done, actualRecipeId? }` |
| DELETE | `/calendar/:id` | supprimer une entrée du calendrier |

## Stock — `/stock`

| Méthode | Route | Description |
|---|---|---|
| GET | `/stock` | lister le stock (`expiringSoon?: bool`) |
| POST | `/stock` | ajouter un ingrédient au stock |
| PATCH | `/stock/:id` | mettre à jour quantité / date d'expiration |
| DELETE | `/stock/:id` | retirer un ingrédient du stock |

## Shopping — `/shopping`

| Méthode | Route | Description |
|---|---|---|
| GET | `/shopping` | lister ses listes de courses |
| POST | `/shopping/generate` | générer les listes d'une période `{ periodStart, periodEnd }` → **tableau** de listes, une par semaine (lundi au dimanche) ; le stock sert d'abord aux premières semaines ; régénérer remplace les listes de mêmes semaines |
| GET | `/shopping/:id` | détail d'une liste + articles |
| PATCH | `/shopping/:id/items/:iid` | cocher / décocher un article → `{ checked }` |
| POST | `/shopping/:id/validate` | valider courses → MAJ stock atomique (transaction) |
| DELETE | `/shopping/:id` | supprimer une liste de courses |

## Points d'attention lors de l'implémentation

- `/recipes/:id` (GET) et `/calendar/:id/validate` : vérifier que la ressource appartient bien à
  `req.user.id` avant de répondre (`ForbiddenException` sinon — voir T09 dans
  [[cookthatone-tests]]).
- `/calendar` POST/`move` : un créneau déjà occupé doit lever `ConflictException` (409), pas
  écraser silencieusement (voir T12).
- `/shopping/:id/validate` : doit passer par `$transaction` Prisma pour garantir l'atomicité de
  la mise à jour du stock (voir T17 et [[cookthatone-data-model]] pour le modèle `stock`).

## Unités (ticket #93)

- L'unité d'un ingrédient (`defaultUnit`) est **modifiable** (décision de Jeff) : `PATCH /ingredients/:id` `{ defaultUnit }`. Même famille (g et kg) : le stock est converti. Autre famille (g et ml) : possible si l'ingrédient a une équivalence (voir ci-dessous), sinon `409` tant qu'il est utilisé (recette, stock, liste validée).
- Familles convertibles : poids (g, kg) ; volume (ml, cl = 10 ml, l, c. à soupe = 15 ml, c. à café = 5 ml, tasse = 240 ml). `PIECE` et `PINCEE` n'ont aucun équivalent, même avec une équivalence.
- `POST /stock` : l'ingrédient doit appartenir à l'utilisateur ; une unité compatible est convertie et le stock est enregistré dans l'unité de l'ingrédient ; une unité sans équivalent renvoie `400` (« L'unité X n'est pas compatible avec « Y » (z) »).
- `POST /recipes` et `POST /recipes/:id/ingredients` : même contrôle sur chaque ligne (l'unité saisie est conservée, convertie au calcul).
- `POST /shopping/generate` : besoins et stock convertis dans l'unité de l'ingrédient ; une donnée incompatible renvoie `400` « Unités incompatibles : … » qui nomme l'ingrédient et la recette.
- Validation d'un repas : le besoin est converti dans l'unité du stock ; une unité sans équivalent laisse le stock intact (avertissement dans les journaux, jamais de blocage).
- **Équivalence par ingrédient** (`Ingredient.gramsPerTablespoon`, optionnelle, 0 < x ≤ 100) : poids d'une cuillère à soupe (15 ml) de l'ingrédient (farine ≈ 10 g). Elle relie poids et volume pour cet ingrédient : stock, lignes de recette, liste de courses, validation de repas et changement d'unité s'en servent (`convertQuantity(q, from, to, gramsPerTablespoon)`). Renseignée via `POST /ingredients` ou `PATCH /ingredients/:id` ; sans elle, **les cuillères (c. à soupe, c. à café) utilisent le repli universel 1 g = 1 ml, soit 15 g la c. à soupe** (décision de Jeff, `DEFAULT_GRAMS_PER_TABLESPOON`). Le repli ne couvre que les cuillères : g contre ml, cl, l ou tasse restent refusés (400) tant que l'équivalence n'est pas renseignée. Le poids propre à l'ingrédient prime toujours.
