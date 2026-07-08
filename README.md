# cookthatone-backend

Backend NestJS pour CookthatOne — projet personnel CDA RNCP37873.

Stack : NestJS v11 · Prisma v5 · PostgreSQL 16 · JWT/Passport · Docker · GitHub Actions.

## Installation

```bash
npm install
docker-compose up -d postgres
npx prisma migrate dev --name init
```

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
