---
name: cookthatone-stack
description: Référence la stack technique imposée du backend CookthatOne (NestJS/Prisma/PostgreSQL) et l'infra (Docker, GitHub Actions, Render, Supabase). À invoquer avant d'ajouter une dépendance, de choisir un outil, ou de configurer l'environnement local/déploiement, pour rester aligné avec les choix déjà validés plutôt que d'introduire une techno alternative.
---

# Stack technique — CookthatOne Backend

Projet personnel CDA RNCP37873 (dossier dû 2026-07-20, soutenance septembre 2026). La stack
ci-dessous est figée sur le choix de *framework* : ne pas proposer d'alternative (ex. TypeORM,
Fastify, Express nu, MongoDB) sans que l'utilisateur le demande explicitement. Les numéros de
version mineurs/majeurs, eux, ne sont pas gravés dans le marbre — utiliser la dernière version
stable au moment de l'implémentation sauf contrainte explicite (voir note Prisma ci-dessous).

## Back-end

| Couche | Techno | Rôle |
|---|---|---|
| Runtime | Node.js 20 | exécution JS |
| Framework | NestJS v11 | architecture en couches + DI |
| ORM | Prisma v7 (dernière stable) | accès BDD typé + migrations |
| Base de données | PostgreSQL 16 | persistance relationnelle |
| Cache (V2 seulement) | Redis | cache recherche / sessions — ne pas implémenter en V1 |
| Auth | JWT + Passport | authentification stateless |
| Validation | class-validator | validation automatique des DTOs |
| Documentation | Swagger / OpenAPI | générée automatiquement, exposée sur `/api/docs` |
| Scheduler | @nestjs/schedule | cron notification fin de journée |

## Infrastructure & DevOps

| Outil | Usage |
|---|---|
| Docker + Compose | environnement local reproductible |
| GitHub Actions | pipeline CI/CD (lint → tests → build → deploy) |
| GHCR | registry d'images Docker |
| Render | hébergement back NestJS (free tier) |
| Supabase | PostgreSQL gratuit permanent (500 MB, pas d'expiration) |
| Vercel | hébergement front React+Vite (V2, hors scope backend) |
| UptimeRobot | ping toutes les 5 min pour éviter le sleep Render |

## Configuration Render — points d'attention

| Paramètre | Valeur | Raison |
|---|---|---|
| `trust proxy` | `1` (défini dans `main.ts`) | L'API tourne derrière le proxy de Render ; sans ce réglage, le limiteur de débit voit l'IP du proxy et non celle du visiteur. Ne pas modifier sans confirmer la topologie de l'hébergeur. |

## Règles

- Redis et Vercel sont **V2** — ne pas les intégrer tant que la V1 n'est pas livrée.
- Le free tier Render dort après inactivité ; UptimeRobot compense ça en prod, pas besoin de
  reproduire ce comportement en local/dev.
- Supabase sert de PostgreSQL managé gratuit — ne pas proposer de migrer vers un autre provider
  sans raison explicite (coût, quota).
- Prisma : le PDF d'origine indiquait v5 (version courante au moment de sa rédaction). Passé en
  v7 (dernière stable) le 2026-07-07 car aucune contrainte technique ne justifiait de rester sur
  une version obsolète pour un projet qui continue jusqu'à septembre 2026. Si une raison précise
  impose v5 (tuto suivi, dossier déjà rédigé qui la mentionne), revenir dessus explicitement.
