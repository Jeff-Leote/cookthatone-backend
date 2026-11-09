---
name: cookthatone-data-model
description: Décrit le schéma Prisma / modèle de données du backend CookthatOne (tables, relations, contraintes uniques, règles de suppression) et les décisions de conception qui les justifient. À invoquer avant de modifier prisma/schema.prisma, d'écrire une migration, ou d'ajouter un champ/une relation, pour ne pas contredire les invariants déjà décidés.
---

# Modèle de données — CookthatOne Backend

## Tables et relations clés

| Table | Rôle | Relations clés |
|---|---|---|
| `users` | compte utilisateur | racine de toutes les données utilisateur |
| `recipes` | recette complète | → users, recipe_ingredients, recipe_steps |
| `ingredients` | ingrédient — **table pivot centrale** | → users · utilisé par recettes, stock et courses |
| `recipe_ingredients` | liaison recette ↔ ingrédient | → recipes + ingredients (quantité + unité) |
| `recipe_steps` | étapes ordonnées d'une recette | → recipes (`stepOrder` unique par recette) |
| `calendar_entries` | repas planifié / réalisé | → users, recipes ×2 (prévu + réel) |
| `stock` | quantités en stock par ingrédient | → users + ingredients (unique par user/ingredient) |
| `shopping_lists` | liste de courses hebdomadaire | → users |
| `shopping_items` | articles d'une liste de courses | → shopping_lists + ingredients |

## Décisions de conception (invariants à respecter)

- **`Ingredient` est la table pivot** : référencée par `recipe_ingredients`, `stock` ET
  `shopping_items` → permet la déduction automatique du stock. Ne pas dupliquer les ingrédients
  par contexte (ex. un ingrédient "recette" différent d'un ingrédient "stock").
- **`CalendarEntry` a deux FK vers `recipes`** : `recipeId` (prévu) et `actualRecipeId` nullable
  (réalisé) → conserve un historique fidèle même si l'utilisateur remplace la recette au moment
  de valider le repas.
- `@@unique([userId, name])` sur `Ingredient` → impossible d'avoir deux fois le même ingrédient
  pour un même utilisateur. Toute création d'ingrédient doit vérifier/gérer ce conflit
  (upsert ou `ConflictException`).
- `@@unique([userId, plannedDate, mealSlot])` sur `CalendarEntry` → un seul repas par créneau
  (midi/soir) par jour et par utilisateur.
- `onDelete: Restrict` sur les ingrédients → la suppression d'un ingrédient doit être **bloquée**
  s'il est utilisé dans une recette ou dans le stock. Ne pas remplacer par `Cascade` ou
  `SetNull` : c'est un choix délibéré pour éviter la perte silencieuse de données.
- `quantityInStock` dans `ShoppingItem` est un **snapshot figé** à la génération de la liste, pas
  une valeur recalculée en live. Ne pas le transformer en champ dérivé/computed.

## Quand modifier le schéma

Toute nouvelle table ou relation doit respecter le principe : `ingredients` reste le pivot unique,
et les FK vers `recipes` depuis `calendar_entries` doivent garder la distinction prévu/réalisé.
Avant d'ajouter une contrainte `@@unique` ou un `onDelete`, vérifier qu'elle ne contredit pas
celles listées ci-dessus.
