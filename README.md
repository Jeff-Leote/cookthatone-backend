# cookthatone-backend

Backend NestJS pour CookthatOne — projet personnel CDA RNCP37873.

Stack : NestJS v11 · Prisma v7 · PostgreSQL 16 · JWT/Passport · Docker · GitHub Actions.

## Installation

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npx prisma migrate dev --name init
```

> **Windows** : les connexions TCP reelles vers le Postgres docker-compose echouent depuis un
> process Node natif Windows dans cet environnement, avec des erreurs `P1000: Authentication
> failed ... credentials for (not available)` (Prisma) ou `authentification par mot de passe
> echouee` (driver `pg` brut) — sans qu'aucune tentative de connexion n'atteigne Postgres (rien
> dans ses logs). Confirme independant de Prisma : le driver `pg` pur echoue de la meme facon, et
> changer la methode d'authentification (`trust` compris) ne change rien. C'est un probleme reseau
> Windows/Docker Desktop de cet environnement, pas un bug de code ni de config — et ca ne touche
> pas la CI (runners Linux) ni la prod (Docker Linux sur Render).
>
> `npx prisma generate` fonctionne normalement sur Windows (il n'ouvre pas de connexion reseau).
> Pour tout ce qui interroge reellement la base (`prisma migrate`, `prisma studio`, `npm run
> start`/`start:dev`, tester les endpoints en local), lancez la commande depuis un conteneur Linux
> sur le meme reseau Docker :
>
> ```bash
> docker run --rm --network cookthatone-backend_default \
>   -v "$(pwd):/app" -w /app \
>   -e DATABASE_URL="postgresql://cookthatone:cookthatone@postgres:5432/cookthatone?schema=public" \
>   node:22-alpine sh -c "npm install --no-save dotenv && npx prisma migrate dev --name init"
> ```
>
> Pour lancer le serveur complet en Linux, le plus simple reste WSL2 (npm install natif, pas de
> mount cross-OS) plutot qu'un conteneur ephemere avec `node_modules` Windows monte dedans (les
> binaires natifs comme `bcrypt` ou les moteurs Prisma ne sont pas compatibles entre OS).

## Lancer le projet

```bash
npm run start:dev   # hot-reload, localhost:3000
npx prisma studio    # localhost:5555
```

> **Windows** : les deux commandes ci-dessus ouvrent une vraie connexion a Postgres — voir la note
> Windows dans la section Installation pour le contournement (conteneur Linux / WSL2).

## Tests

```bash
npm run test:cov
```

## Documentation API

Swagger disponible sur `/api/docs` une fois le serveur démarré.
