---
name: cookthatone-setup
description: Checklist de démarrage du backend CookthatOne (GitHub, init NestJS local, base de données, génération des modules, vérification finale) avec les commandes exactes à exécuter dans l'ordre. À invoquer quand on démarre le projet backend from scratch ou qu'on doit reproduire l'environnement local.
---

# Checklist démarrage — CookthatOne Backend

Suivre les phases dans l'ordre — chaque phase dépend de la précédente.

## Phase 1 — GitHub

> Le repo `cookthatone-backend` est **déjà créé** — ne pas relancer cette étape, seulement
> vérifier ce qui manque encore (Project Kanban, secret) avant de passer à la Phase 2.

- ~~Créer le repo `cookthatone-backend` (Public · README · `.gitignore` Node · License MIT)~~ fait
- Créer le GitHub Project en mode Kanban : Backlog / In Progress / Done
- Ajouter le secret `RENDER_DEPLOY_HOOK_URL` dans Settings → Secrets → Actions
  (voir [[cookthatone-cicd]] pour où trouver la valeur)

## Phase 2 — Init local

4. Cloner et scaffolder NestJS
   ```bash
   git clone https://github.com/Jeff-Leote/cookthatone-backend
   cd cookthatone-backend
   npm i -g @nestjs/cli
   nest new . --skip-git --package-manager npm
   ```
5. Installer toutes les dépendances
   ```bash
   npm install prisma @prisma/client @nestjs/jwt @nestjs/passport \
     passport passport-jwt @nestjs/config @nestjs/schedule \
     @nestjs/swagger swagger-ui-express \
     class-validator class-transformer bcrypt

   npm install -D @types/passport-jwt @types/bcrypt ts-jest
   ```
6. Init Prisma + coller le schéma
   ```bash
   npx prisma init
   ```
   → remplacer `prisma/schema.prisma` par le fichier livré (voir [[cookthatone-data-model]]) ·
   configurer `.env` (`DATABASE_URL`, `JWT_SECRET`)
7. Copier les fichiers CI/CD et Docker
   ```bash
   mkdir -p .github/workflows
   # coller ci-cd.yml dans .github/workflows/
   # coller Dockerfile et docker-compose.yml à la racine
   ```
   (contenu attendu détaillé dans [[cookthatone-cicd]])

Ne pas ajouter de dépendance hors de la liste de l'étape 5 sans vérifier [[cookthatone-stack]]
d'abord.

## Phase 3 — Base de données

```bash
docker-compose up -d postgres
npx prisma migrate dev --name init
npx prisma studio   # Vérifier les tables sur localhost:5555
```

## Phase 4 — Génération des modules NestJS

```bash
nest g module prisma && nest g service prisma --no-spec
nest g module auth && nest g controller auth && nest g service auth
nest g module recipes && nest g controller recipes && nest g service recipes
nest g module ingredients && nest g controller ingredients && nest g service ingredients
nest g module calendar && nest g controller calendar && nest g service calendar
nest g module stock && nest g controller stock && nest g service stock
nest g module shopping && nest g controller shopping && nest g service shopping
nest g module scheduler
```

Cette liste de modules doit correspondre exactement au tableau de modules dans
[[cookthatone-architecture]] — ne pas en ajouter ou en fusionner sans mettre à jour ce skill.

## Phase 5 — Vérification finale

```bash
npm run start:dev
# → Ouvrir localhost:3000/api/docs (Swagger)
npm run test:cov
# → 17 tests passent (voir [[cookthatone-tests]])
git add . && git commit -m "feat: initial backend setup"
git push origin main
# → GitHub Actions : job CI doit passer au vert (voir [[cookthatone-cicd]])
```

Ne pas considérer le setup terminé tant que ces 3 conditions ne sont pas vraies : Swagger
accessible, 17/17 tests verts, CI vert sur GitHub Actions.
