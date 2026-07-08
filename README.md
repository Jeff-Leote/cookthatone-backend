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

> **Windows** : le binaire natif Windows du moteur Prisma 7.8.0 échoue avec `P1000: Authentication
> failed ... credentials for (not available)` même avec des identifiants valides, sans qu'aucune
> tentative de connexion n'atteigne Postgres (bug moteur, pas un problème de config). En attendant
> un correctif upstream, lancez les commandes `prisma migrate` depuis un conteneur Linux :
>
> ```bash
> docker run --rm --network cookthatone-backend_default \
>   -v "$(pwd):/app" -w /app \
>   -e DATABASE_URL="postgresql://cookthatone:cookthatone@postgres:5432/cookthatone?schema=public" \
>   node:22-alpine sh -c "npm install --no-save dotenv && npx prisma migrate dev --name init"
> ```
>
> `npx prisma generate` et `npx prisma studio` fonctionnent normalement sur Windows ; seul `migrate`
> (qui invoque le schema-engine natif) est concerné.

## Lancer le projet

```bash
npm run start:dev   # hot-reload, localhost:3000
npx prisma studio    # localhost:5555
```

## Tests

```bash
npm run test:cov
```

## Documentation API

Swagger disponible sur `/api/docs` une fois le serveur démarré.
