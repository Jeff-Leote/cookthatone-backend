---
name: cookthatone-tests
description: Contient le jeu d'essai formalisé de 17 tests Jest (T01-T17) du backend CookthatOne, service par service, avec entrée/attendu, et le mapping vers les compétences CDA CP3/CP8/CP9. À invoquer avant d'écrire ou de modifier un test unitaire de service, pour ne pas dévier du plan de tests déjà formalisé et garder la traçabilité CDA.
---

# Plan de tests Jest — CookthatOne Backend

Tests unitaires : chaque service est testé isolément via des **mocks de PrismaService**
(jamais de vraie base en test unitaire — voir couche Accès données dans
[[cookthatone-architecture]]). 17 tests couvrant cas nominaux et cas d'erreur.

## Jeu d'essai — 17 tests

| # | Service | Méthode | Entrée | Attendu |
|---|---|---|---|---|
| T01 | AuthService | `register()` | email nouveau + password | `access_token` retourné |
| T02 | AuthService | `register()` | email déjà existant | `ConflictException` (409) |
| T03 | AuthService | `login()` | credentials valides | `access_token` retourné |
| T04 | AuthService | `login()` | mauvais mot de passe | `UnauthorizedException` (401) |
| T05 | AuthService | `login()` | email inconnu | `UnauthorizedException` (401) |
| T06 | RecipesService | `findAll()` | userId valide | tableau de recettes |
| T07 | RecipesService | `findAll()` | userId + `search='carb'` | tableau filtré |
| T08 | RecipesService | `findOne()` | id inexistant | `NotFoundException` (404) |
| T09 | RecipesService | `findOne()` | id d'un autre user | `ForbiddenException` (403) |
| T10 | RecipesService | `create()` | dto complet avec ingr. + étapes | recette créée |
| T11 | CalendarService | `create()` | créneau libre | entrée créée |
| T12 | CalendarService | `create()` | créneau déjà occupé | `ConflictException` (409) |
| T13 | CalendarService | `validate()` | `done=true`, même recette | `actualRecipeId = recipeId` |
| T14 | CalendarService | `validate()` | `done=true`, autre recette | `actualRecipeId = id remplacement` |
| T15 | ShoppingService | `generate()` | stock insuffisant pour la semaine | items avec qté manquante |
| T16 | ShoppingService | `generate()` | stock couvre tous les besoins | items vide |
| T17 | ShoppingService | `validate()` | items cochés | `$transaction` + stock mis à jour |

## Couverture CDA par les tests

| Compétence CDA | Tests |
|---|---|
| CP3 — Composants métier | T10, T11, T13, T14, T15, T16 (logique métier des services) |
| CP8 — Accès données SQL/NoSQL | T15, T16, T17 (mock Prisma + transaction atomique) |
| CP9 — Plans de tests | Ensemble T01 → T17 (jeu d'essai formalisé) |

## Règles

- Ne pas ajouter de test qui frappe une vraie base de données dans cette suite unitaire — c'est
  hors scope du plan formalisé (pas de tests d'intégration ici).
- Toute nouvelle méthode de service ajoutée doit être accompagnée d'au moins un cas nominal et un
  cas d'erreur, dans le même esprit que T01-T17, pour rester cohérent avec CP9.
- Si un test change de comportement attendu, mettre à jour ce tableau en même temps que le code
  (ce fichier est la source de vérité du jeu d'essai, pas seulement le fichier `.spec.ts`).
- `npm run test:cov` doit faire passer les 17 tests avant tout push sur `main` (voir
  [[cookthatone-cicd]]).
