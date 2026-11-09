# CookthatOne : plan de réalisation

Plan issu de l'audit du 2026-11-08 (voir `docs/AUDIT_2026-11-08.md`). Chaque ligne est un ticket GitHub **assigné à Jeff**. `B#` = dépôt `cookthatone-backend`, `F#` = dépôt `cookthatone-frontend`. Le protocole de travail est dans `CLAUDE.md`.

## 1. Définition de « terminé » (pour tout ticket)

1. Critères d'acceptation du ticket tous cochés, rien de plus (pas de refactor hors sujet).
2. Backend : `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run test:e2e`, `npm run build` verts. Frontend : `lint`, `typecheck`, `format:check`, `build` verts (et les tests dès F#43).
3. Tests ajoutés : cas nominal **et** cas d'erreur ; une route nouvelle ou modifiée a son test e2e.
4. Migration **additive** (elle part en production au déploiement) ; rattrapage de données ou migration destructive seulement dans un plan validé par Jeff, avec simulation et sauvegarde.
5. Interface : contrôlée à 375 px et au clavier ; `impeccable detect` sur les fichiers modifiés ; aucun P0 ni P1 ouvert à l'`/impeccable audit`.
6. Skills du projet et documentation à jour dans la même PR.
7. Agent `performance-securite` (si le ticket touche sécurité ou performance), puis agent `relecteur` : **« Prêt pour Jeff »**.
8. Jeff ordonne le commit, la PR et le merge ; après un déploiement, `GET /health` vérifié.

## 2. Jalons et tickets

Ordre conseillé à l'intérieur d'un jalon : de haut en bas.

### J0 : process et hygiène

| Ticket | Prio | Sujet |
| --- | --- | --- |
| B#74 / F#41 | P3 | Fins de ligne (`.gitattributes`) : **en premier**, pour des diffs lisibles |
| B#72 | P1 | Vulnérabilités npm de production et PR Dependabot (backend) |
| F#42 | P1 | Vulnérabilités npm et PR Dependabot (frontend) |
| F#43 | P1 | Tests frontend et job CI |
| B#73 | P2 | Tests e2e en CI (service Postgres) |
| B#71 | P2 | Valider le protocole d'agents, décider de son versionnement |

### J1 : sécurité et robustesse

| Ticket | Prio | Sujet | Dépend de |
| --- | --- | --- | --- |
| B#75 | P1 | Confiance au proxy pour le limiteur de débit | |
| B#76 → F#44 | P2 | Session : durée du jeton et stockage hors `localStorage` | décision de Jeff |
| B#77 → F#45 | P2 | Mot de passe oublié, renvoi de la vérification, changement | |
| B#78 → F#46 | P2 | Suppression de compte et export des données (RGPD) | décision de calendrier |
| B#79 | P3 | Lignes de stock à zéro (rattrapage) et pagination | sauvegarde |
| B#80 | P3 | Swagger et journalisation en production | décision de Jeff |
| B#81 | P3 | Route de santé Render et réveil à froid | action de Jeff sur Render |

### J2 : majuscules sur les recettes et les ingrédients

| Ticket | Prio | Sujet | Dépend de |
| --- | --- | --- | --- |
| B#82 | P2 | Décorateur de majuscule initiale ; unicité insensible à la casse (migration **après** B#83) | B#83 pour l'index |
| B#83 | P2 | Rattrapage des données existantes (simulation, fusion des doublons de casse) | plan validé, sauvegarde (B#90) |
| F#47 | P2 | Saisie et affichage avec majuscule | B#82 |

### J3 : import de recette par URL

| Ticket | Prio | Sujet | Dépend de |
| --- | --- | --- | --- |
| B#84 | P1 | Cadrage et questions à Jeff (fournisseur, budget, langue, source, quota) | |
| B#86 | P1 | Récupérateur d'URL sécurisé | |
| B#85 | P2 | Champ `sourceUrl` | B#84 |
| B#87 | P1 | Route d'aperçu (JSON-LD puis repli) | B#84, B#86, B#82 |
| B#88 | P2 | Confirmation : recette et ingrédients manquants | B#87 |
| F#48 | P1 | Écran « Importer depuis un lien » | B#87, B#88 |
| B#89 | P3 | Ajout par la voix (plus tard, rien avant la fin de J3) | J3 terminé |

### J4 : design, accessibilité, responsive (frontend)

Voir aussi l'audit RGAA existant : **F#13** et la PR **F#27**.

| Ticket | Prio | Sujet |
| --- | --- | --- |
| F#49 | P1 | Un titre de page unique par écran |
| F#50 | P2 | Cibles tactiles de 44 px |
| F#51 | P2 | Texte de 12 px minimum |
| F#52 | P2 | Icônes SVG à la place des emoji |
| F#53 | P2 | Refonte du tableau de bord |
| F#54 | P2 | Calendrier mobile (vue agenda) |
| F#55 | P2 | Thèmes jour et sombre (décision de Jeff) |
| F#56 | P2 | Retours d'action visibles et réveil du serveur |
| F#57 | P3 | Confirmations de suppression en `<dialog>` |
| F#58 | P3 | Mouvement réduit sans perdre les retours |
| F#59 | P3 | `PRODUCT.md` et `DESIGN.md` |
| F#60 | P3 | Lighthouse sur la version construite |

### J5 : mise en ligne propre

| Ticket | Prio | Sujet |
| --- | --- | --- |
| B#90 | P2 | Sauvegardes Supabase et restauration testée (**avant** B#83 et B#79 en production) |
| B#91 | P2 | Audit `security-audit` complet (périmètre et budget fixés par Jeff) |
| B#92 | P3 | README, skills et dossier CDA à jour |
| F#14 | | Déploiement Vercel (ticket existant) |

## 3. Questions ouvertes à Jeff

Chaque ticket étiqueté `à-cadrer` contient ses questions ; aucune réponse n'est supposée.

- **B#71** versionner le dossier des agents ? les skills restent-ils locaux ?
- **B#76** option de session (cookie `httpOnly` côté Next.js, jeton de rafraîchissement, ou `localStorage` raccourci) et durée.
- **B#78** RGPD : avant ou après la soutenance ? délai de grâce ?
- **B#80** Swagger public ou protégé en production ? suivi des erreurs ?
- **B#83** règle de fusion de deux ingrédients de même nom ; fenêtre d'exécution en production.
- **B#84** fournisseur, modèle et budget du repli ; langue ; `sourceUrl` ; quota ; création automatique des ingrédients.
- **F#55** thème clair voulu ?
- **B#90** accès Supabase, plan, fréquence de sauvegarde.
- **B#91** profil et budget de l'audit de sécurité.

## 4. Garde-fous

- Tout ce qui est fusionné sur `main` se déploie ; le conteneur lance `prisma migrate deploy` au démarrage.
- Aucune sonde permanente sur l'API sans accord de Jeff (quotas gratuits, réveil à froid).
- Dépôts publics : un ticket ou une PR ne décrit jamais une faille de façon exploitable.
