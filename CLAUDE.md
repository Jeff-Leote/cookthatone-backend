# CookthatOne : instructions du projet

Application de planification de repas, de stock et de listes de courses. **Deux dépôts, un produit** : l'API (`cookthatone-backend`, ce dossier) et l'interface (`C:\Users\jeffl\Dev\Jeff-Dev\cookthatone-frontend`, son propre Git). Projet personnel de Jeff, support de sa certification CDA (RNCP 37873). Le protocole d'agents ci-dessous reprend celui du Dashboard ECL, installé ici **à la demande de Jeff le 2026-11-08** (exception décidée par Jeff : ce n'est pas un projet MCODE).

## Ce qui fait foi

Le ticket GitHub du travail en cours, `docs/IMPLEMENTATION.md` (jalons et définition de « terminé »), puis les skills du projet dans `.claude/skills/` : `cookthatone-architecture`, `cookthatone-api`, `cookthatone-data-model`, `cookthatone-tests`, `cookthatone-stack`, `cookthatone-cicd`, `cookthatone-setup`. Une décision qui change un skill ou `IMPLEMENTATION.md` se note dans le même commit que le code.

## Stack

Backend : NestJS 11, Prisma 7, PostgreSQL (Docker en local sur le port 5433, Supabase en production), Redis (cache), JWT + bcrypt, Jest, Docker, GitHub Actions, Render. Frontend : Next.js 16, React 19, Tailwind 4, TypeScript, npm, Vercel prévu. Pas de pnpm.

## L'équipe d'agents (`.claude/agents/`)

| Agent                  | Territoire                                                                | Ne touche pas       |
| ---------------------- | ------------------------------------------------------------------------- | ------------------- |
| `frontend`             | dépôt `cookthatone-frontend`                                              | API, schéma, CI API |
| `backend`              | `src/`, `test/`, `scripts/` de ce dépôt                                   | interface, `prisma/` |
| `base-de-donnees`      | `prisma/` : schéma, migrations, seed ; **seul** à modifier le schéma      | code applicatif     |
| `performance-securite` | lecture seule : quotas, performance, sécurité des deux dépôts ; rapporte  | tout fichier        |
| `relecteur`            | lecture seule : verdict avant PR (définition de « terminé »)              | tout fichier        |

**L'orchestrateur, c'est la conversation principale** : un agent ne peut pas en lancer un autre, donc c'est elle qui enchaîne les agents, transmet les contrats (routes, colonnes) d'un agent à l'autre et rend compte à Jeff. Les agents ne sont visibles que dans une session ouverte dans ce dossier.

### Déroulement d'un ticket

1. Lire le ticket et sa ligne dans `docs/IMPLEMENTATION.md` ; vérifier ses dépendances et ses **questions à Jeff** ; **assigner le ticket à Jeff** si ce n'est pas fait.
2. Créer la branche depuis `main` (`feat/`, `fix/`, `chore/`, `docs/`, `ci/`), dans le dossier du dépôt concerné.
3. `base-de-donnees` si la structure change, puis `backend` pour l'API et ses tests, puis `frontend` pour l'interface. Chaque agent rend son contrat à l'agent suivant.
4. Pour tout ticket d'interface : `/impeccable audit` en lecture seule (aucun P0 ni P1 ouvert), puis `design:accessibility-review` en fin de jalon. `ui-ux-pro-max` sert à proposer, jamais à imposer.
5. `performance-securite` avant la PR ; corriger ce qu'il rapporte en renvoyant à l'agent concerné.
6. `relecteur` : verdict. **Pas de PR tant qu'il y a un bloquant.**
7. Présenter à Jeff le résumé et le verdict. **Il ordonne le commit, la PR et le merge.**

## Règles

- **Jamais de commit, de push, de merge, de PR ni de ticket sans l'ordre explicite de Jeff.** « Faire un travail » ne veut pas dire commiter.
- Commits en français (Conventional Commits), **aucune mention de Claude ni d'une IA** dans le code, les commits, les PR et les tickets. Une branche par ticket, dans le vrai dossier du projet (jamais de worktree ni de copie).
- Rien d'inventé : une information inconnue (fournisseur, prix, choix technique) devient une question à Jeff, écrite dans le ticket.
- Ne jamais lire les valeurs d'un fichier `.env*` (seulement `.env.example`) ni écrire un secret dans le dépôt, un journal ou une réponse.
- Les dépôts sont **publics** : un ticket ou une PR ne décrit jamais une faille de façon exploitable.

## Garde-fous du projet

- **Tout ce qui est fusionné sur `main` se déploie** : le workflow `CD — Deploy` construit l'image, la pousse et déclenche Render, et le conteneur lance `prisma migrate deploy` au démarrage. Une migration est donc **additive d'abord**, compatible avec le code déjà déployé ; un rattrapage de données (`UPDATE`/`DELETE`) passe par un plan validé par Jeff, avec simulation et sauvegarde. Jamais `migrate reset` ni `db push` sur une base partagée.
- Avant de fusionner : lint, `tsc`, tests unitaires et e2e, build verts. Après un déploiement : vérifier `GET /health` sur l'API.
- Offres gratuites : le serveur Render se met en veille (réveil de 30 à 60 s) ; aucune sonde permanente sans accord de Jeff ; quotas dans `QUOTAS_PLAN_GRATUIT.md` (dossier `Mcode/.claude/m2code/process/`).
- Les hooks d'Impeccable restent **désactivés** ; son détecteur se lance à la main à la fin. Ne pas lancer `impeccable update` sans demande de Jeff (il réinstalle les hooks).
- **Audit `security-audit` complet** : depuis la conversation principale, avec un périmètre et un budget fixés par Jeff, avant la mise en production du frontend ; aucun point critique ou élevé confirmé ne reste ouvert.
- Fonctions IA : la clé du fournisseur reste côté serveur ; toute récupération d'URL est protégée contre l'accès aux adresses internes (voir `performance-securite`).

## État

Protocole installé le 2026-11-08 ; audit complet réalisé le même jour ; tickets créés et assignés à Jeff, listés dans `docs/IMPLEMENTATION.md`. Aucun ticket n'est commencé : Jeff donne l'ordre de démarrer le jalon J0.
