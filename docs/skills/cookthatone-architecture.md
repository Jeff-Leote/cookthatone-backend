---
name: cookthatone-architecture
description: Définit l'architecture en couches (Presentation/Métier/Accès données/Persistance) et la liste des modules NestJS du backend CookthatOne, alignée sur le Bloc 2 du référentiel CDA RNCP37873. À invoquer avant de créer un module/service/controller ou de décider où placer une logique, pour respecter la séparation des couches déjà actée.
---

# Architecture en couches — CookthatOne Backend

L'architecture est déjà actée (voir aussi la conversation de conception dédiée côté utilisateur) —
ce skill sert de référence pour rester cohérent avec elle, pas pour la redéfinir.

## Couches

| Couche | Composants NestJS | Responsabilité |
|---|---|---|
| Présentation | Controllers + DTOs + Guards | réception HTTP, validation, réponse JSON, Swagger |
| Métier | Services | logique applicative, règles métier, transactions Prisma |
| Accès données | PrismaService + schéma | requêtes SQL, ORM, migrations automatiques |
| Persistance | PostgreSQL + Redis (V2) | stockage physique |

## Règle fondamentale

**Chaque couche ne communique qu'avec la couche adjacente.** Un Controller n'appelle jamais Prisma
directement — il délègue toujours au Service. Cette séparation permet de tester chaque couche
isolément via des mocks (voir [[cookthatone-tests]]).

Concrètement :
- Un `*Controller` ne doit importer/injecter que son `*Service` correspondant (jamais
  `PrismaService`).
- Toute règle métier (validation de créneau, calcul de stock, transaction) vit dans le Service,
  pas dans le Controller ni dans un DTO.
- Le `PrismaService` est le seul point d'accès à la base — pas de requête SQL brute ailleurs.

## Modules NestJS

| Module | Controller | Service | Dépendances |
|---|---|---|---|
| PrismaModule | — | PrismaService | — |
| AuthModule | AuthController | AuthService | Prisma, JwtModule |
| RecipesModule | RecipesController | RecipesService | Prisma |
| IngredientsModule | IngredientsController | IngredientsService | Prisma |
| CalendarModule | CalendarController | CalendarService | Prisma |
| StockModule | StockController | StockService | Prisma |
| ShoppingModule | ShoppingController | ShoppingService | Prisma |
| SchedulerModule | — | NotificationTask | Prisma, ScheduleModule |

`SchedulerModule` n'a pas de Controller : c'est un module purement interne (cron), pas exposé en
HTTP.

## Sécurité transverse

Toutes les routes sauf `/auth` sont protégées par `JwtAuthGuard` (voir [[cookthatone-api]]) —
le Guard fait partie de la couche Présentation, pas de la couche Métier.
