---
name: cookthatone-cicd
description: Décrit le pipeline CI/CD GitHub Actions du backend CookthatOne (jobs CI/CD, Dockerfile multi-stage, secrets requis, commandes locales). À invoquer avant de modifier un workflow .github/workflows, le Dockerfile, ou la config de déploiement Render/GHCR, pour respecter le pipeline déjà défini.
---

# Pipeline CI/CD — CookthatOne Backend

## Vue d'ensemble

| Workflow | Fichier | Déclencheur | Étapes principales |
|---|---|---|---|
| CI — Quality | `ci-quality.yml` | push + PR sur `main` | lint → format check |
| CI — Tests (Unit) | `ci-test.yml` | push + PR sur `main` | `npm ci` → `prisma generate` → Jest + coverage |
| CI — Tests e2e | `ci-e2e.yml` | push + PR sur `main` | `npm ci` → `prisma generate` → `migrate deploy` → `test:e2e` |
| CI — Build (TS) | `ci-build.yml` | push + PR sur `main` | `npm ci` → `prisma generate` → `migrate deploy` → `tsc build` |
| CD — Deploy | `cd.yml` | push sur `main` uniquement | Docker build → push GHCR → deploy hook Render |

Le job CD ne doit **jamais** se déclencher sur une pull request — il est gaté sur push direct
`main`, après que les jobs CI soient passés.

## Job e2e (`ci-e2e.yml`)

Le workflow e2e lance `npm run test:e2e` contre une vraie base PostgreSQL (service Docker).
Il **bloque la fusion** d'une PR en cas d'échec dès lors qu'il est ajouté comme check requis
dans la configuration de protection de branche (`main`).

Variables d'environnement injectées :

| Variable | Valeur | Raison |
|---|---|---|
| `DATABASE_URL` | `postgresql://cookthatone:cookthatone@localhost:5432/cookthatone?schema=public` | base e2e du service |
| `REDIS_URL` | `redis://localhost:6379` | valeur factice — Redis est mocké dans les tests e2e |
| `JWT_SECRET` | `test-secret-ci` | valeur factice pour la génération de tokens de test |

La concurrence est activée (`cancel-in-progress: true`) sur toutes les branches sauf `main`,
pour éviter de bloquer le gate de déploiement.

Aucun secret GitHub supplémentaire n'est requis pour ce job.

## Dockerfile multi-stage

- **Stage builder** : installe toutes les dépendances (dev incluses), génère le client Prisma,
  compile TypeScript.
- **Stage runner** : installe uniquement les dépendances de production → image finale ~3x plus
  légère. Ne pas copier `node_modules` du builder tel quel dans le runner.
- **CMD** : `prisma migrate deploy && node dist/main.js` → les migrations s'appliquent
  automatiquement au démarrage du conteneur. Ne pas exécuter `prisma migrate dev` en production.

## Secrets GitHub à configurer

| Secret | Valeur | Où le trouver |
|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | URL webhook Render | Dashboard Render → Settings → Deploy Hook |
| `GITHUB_TOKEN` | automatique | fourni par GitHub Actions, aucune configuration |

Ne jamais committer `RENDER_DEPLOY_HOOK_URL` en clair dans le repo ou un fichier `.env` versionné.

## Commandes développement local

```bash
docker-compose up -d postgres        # Lancer la base PostgreSQL
npx prisma migrate dev --name init   # Appliquer les migrations
npm run start:dev                    # Démarrer le back en hot-reload
npx prisma studio                    # Vérifier les tables → localhost:5555
npm run test:cov                     # Lancer les tests avec couverture
```
