# Sauvegardes et restauration de la base Supabase

Ticket B#90. Ce document décrit comment sauvegarder la base de production (Supabase) et comment la restaurer. Il a été **testé en local** (voir la section « Test réalisé ») ; l'export depuis le vrai Supabase **n'a pas été testé** : il demande la chaîne de connexion de Jeff.

## 1. Situation

- Le projet Supabase est sur le **plan gratuit**. Selon la documentation officielle de Supabase, ce plan n'inclut **aucune sauvegarde automatique** (les sauvegardes quotidiennes, conservées 7 jours, sont une fonction du plan Pro). D'où cette procédure d'export manuel, et la recommandation du projet de garder au moins une copie hors de la machine.
- Conséquence : si une migration ou un rattrapage de données tourne mal en production, **il n'existe aucun point de retour** tant qu'une sauvegarde manuelle n'a pas été faite. Les migrations partent en production à chaque déploiement (`prisma migrate deploy` au démarrage du conteneur).
- L'application a son propre JWT et n'utilise que le schéma `public` (tables métier et `_prisma_migrations` de Prisma, extension `btree_gist` pour la contrainte de non-chevauchement des listes de courses). Un export limité au schéma `public` suffit : pas de schémas `auth` ni `storage`, pas de rôles. **Storage n'est pas utilisé** par l'application : aucun fichier à sauvegarder de ce côté.

### Quand sauvegarder

Obligatoire :

- **avant tout déploiement contenant une migration destructive** (suppression ou renommage de colonne ou de table, changement de type) ;
- **avant tout rattrapage de données** (`UPDATE` ou `DELETE` en production, par exemple B#83 et B#79), et la restauration doit avoir été éprouvée avant (c'est l'objet du test ci-dessous).

Recommandé :

- avant toute migration, même additive, tant que l'application contient des données réelles ;
- en routine : **fréquence à décider par Jeff**. Proposition : une fois par semaine, plus avant chaque opération à risque, en gardant les 4 dernières sauvegardes. Rien n'est automatisé : une sauvegarde manuelle peut être oubliée.

## 2. Export

### Prérequis

- Docker Desktop lancé. Aucune installation de la CLI Supabase ni de PostgreSQL : le client `pg_dump` vient de l'image officielle `postgres`.
- Un dossier de sortie **hors du dépôt** (les dumps contiennent des données personnelles). Exemple : `C:\Sauvegardes\cookthatone`. Éviter un dossier synchronisé automatiquement (OneDrive) sauf choix assumé et archive chiffrée.

### Chaîne de connexion

La chaîne de connexion de la base est **un secret** : elle ne s'écrit dans aucun fichier, aucun journal, aucun ticket. Elle passe par une variable d'environnement du shell, saisie à la main, qui disparaît à la fermeture du terminal.

Où la trouver : tableau de bord Supabase, projet CookthatOne, bouton **Connect**.

- **Connexion directe** : commencer par elle. Le bouton Connect indique ce que chaque mode exige du réseau (IPv4 ou IPv6) : **à lire à ce moment-là, non testé ici**.
- **Session pooler** : à essayer si la connexion directe échoue (par exemple faute d'IPv6, **à confirmer**).
- **Transaction pooler** : par prudence, l'éviter pour `pg_dump` et `pg_restore`, qui ouvrent des connexions de longue durée. **Non vérifié.**

Hôte, port et utilisateur sont ceux affichés par le bouton Connect pour le mode choisi : ne rien deviner.

Deux pièges vérifiés :

- Ne pas réutiliser telle quelle la `DATABASE_URL` de Prisma : ses paramètres `?schema=public` ou `?pgbouncer=true` font échouer `pg_dump` (`invalid URI query parameter`). Prendre la chaîne affichée par le bouton Connect, sans ces paramètres.
- Si le mot de passe contient des caractères spéciaux, ils doivent être encodés en pourcentage dans l'URL (Supabase affiche la forme correcte ; en cas de doute, réinitialiser le mot de passe de la base).

### Choisir la version du client

Le `pg_dump` doit être d'une **version majeure supérieure ou égale** à celle du serveur Supabase, sinon il refuse de se connecter (`aborting because of server version mismatch`, constaté lors du test).

Vérifier la version du serveur : tableau de bord Supabase, **SQL Editor**, puis :

```sql
SELECT version();
```

Prendre l'image `postgres:<version majeure>-alpine` correspondante (`postgres:17-alpine` si le serveur est en 17.x, etc.). Les exemples ci-dessous utilisent `17` : **à remplacer par la version relevée**. Le test a été fait avec les versions 16 et 17 seulement.

Vérifier aussi, dans le même éditeur SQL, où est installée l'extension utilisée par la contrainte d'exclusion :

```sql
SELECT extname, extnamespace::regnamespace FROM pg_extension WHERE extname = 'btree_gist';
```

Le résultat attendu est le schéma `public` (c'est le cas en local). S'il s'agit d'un autre schéma (par exemple `extensions`), voir la section 6 (« non testé »).

### Commande (PowerShell)

```powershell
# Saisie de la chaîne de connexion (non écrite dans l'historique du terminal, mais visible à l'écran pendant la saisie)
$env:SUPABASE_DB_URL = Read-Host "Chaîne de connexion Supabase"

$dest = 'C:\Sauvegardes\cookthatone'
New-Item -ItemType Directory -Force $dest | Out-Null
$env:FICHIER = "cookthatone-$(Get-Date -Format 'yyyy-MM-dd-HHmm').dump"

docker run --rm -e SUPABASE_DB_URL -e FICHIER -v "${dest}:/backup" postgres:17-alpine `
  sh -c 'pg_dump $SUPABASE_DB_URL -Fc --schema=public --extension=btree_gist --no-owner --no-privileges -f /backup/$FICHIER'
```

- `-Fc` : format « custom » (compressé, restaurable table par table avec `pg_restore`).
- `--schema=public` : uniquement le schéma de l'application.
- `--extension=btree_gist` : ajoute au dump la ligne `CREATE EXTENSION btree_gist`. **Sans elle, la restauration échoue** sur la contrainte `shopping_lists_no_overlap` (`data type text has no default operator class for access method "gist"`), car `--schema` seul n'inclut pas les extensions. Constaté lors du test.
- `--no-owner --no-privileges` : le dump ne contient ni propriétaires ni droits, qui n'existent pas dans une base jetable.
- La variable est passée au conteneur par `-e NOM` (sans valeur) : la chaîne de connexion ne figure pas dans la ligne de commande Docker.
- Pas de guillemets doubles à l'intérieur de `sh -c '...'` : Windows PowerShell 5.1 les supprime lors de l'appel à une commande native. Conséquence : la variable n'est pas entre guillemets, et un `*` ou un `?` dans la chaîne de connexion serait interprété par le shell du conteneur (cas improbable : le mot de passe encodé en pourcentage n'en contient pas).

Variante Git Bash : la même commande sur une seule ligne, avec `MSYS_NO_PATHCONV=1` devant et un chemin Windows pour `-v` (voir « Chemins sous Windows »). La saisie du secret devient `read -rs SUPABASE_DB_URL; export SUPABASE_DB_URL`.

Contrôle immédiat : le fichier existe et n'est pas vide (`Get-ChildItem $dest`), et `docker run --rm -v "${dest}:/backup" postgres:17-alpine pg_restore -l /backup/<fichier>` liste bien les 12 tables (les 11 tables de l'application et `_prisma_migrations`).

À la fin, effacer la variable : `Remove-Item Env:SUPABASE_DB_URL`.

### Chemins sous Windows

- **PowerShell** : `-v "${dest}:/backup"` avec un chemin Windows (`C:\...`) fonctionne tel quel. C'est la variante recommandée.
- **Git Bash** : sans précaution, le chemin du conteneur est déformé (`/backup` devient `C:/Program Files/Git/backup`). Il faut préfixer la commande par `MSYS_NO_PATHCONV=1` et donner un chemin Windows entre guillemets (`-v "C:\Users\...\cookthatone:/backup"`). Variante testée. Un chemin de style `/c/Users/...` ne règle pas le problème.

## 3. Restauration vers une base jetable (test de restauration)

À faire **avant tout rattrapage de données** et après le premier export réel, puis de temps en temps : une sauvegarde jamais restaurée n'est pas une sauvegarde.

La version du serveur cible (et de `pg_restore`) doit être **supérieure ou égale** à celle du `pg_dump` qui a produit le fichier (voir « Test réalisé » : un dump produit par `pg_dump` 17 ne se restaure pas avec `pg_restore` 16). Le plus simple : même image `postgres:<majeure>-alpine` partout.

### 3.1 Créer la base jetable

```powershell
docker run -d --name restore-test -e POSTGRES_PASSWORD=jetable -e POSTGRES_DB=restore_test -p 5441:5432 postgres:17-alpine
```

Port 5441 : libre par rapport au Postgres de développement (5433), au Postgres par défaut (5432) et à Supabase local (54322). Attendre quelques secondes que la base démarre. Le mot de passe `jetable` est sans valeur : la base est supprimée en fin de test.

### 3.2 Restaurer

```powershell
$dest = 'C:\Sauvegardes\cookthatone'
$env:FICHIER = '<nom du fichier .dump>'

# Liste des objets à restaurer, sans « CREATE SCHEMA public » (le schéma existe déjà dans la cible)
docker run --rm -v "${dest}:/backup" postgres:17-alpine pg_restore -l "/backup/$env:FICHIER" |
  Select-String -NotMatch ' SCHEMA - public| COMMENT - SCHEMA public' |
  ForEach-Object { $_.Line } | Set-Content -Encoding ascii "$dest\liste.txt"

docker run --rm -e PGPASSWORD=jetable -v "${dest}:/backup" postgres:17-alpine `
  pg_restore -h host.docker.internal -p 5441 -U postgres -d restore_test `
  --no-owner --no-privileges --exit-on-error -L /backup/liste.txt "/backup/$env:FICHIER"
```

- Sans la liste filtrée, `pg_restore` signale une seule erreur, sans conséquence (`schema "public" already exists`), mais se termine avec un code de sortie 1, ce qui masque une vraie erreur. La liste filtrée permet d'utiliser `--exit-on-error` : tout échec arrête la restauration.
- `host.docker.internal` désigne la machine hôte depuis un conteneur Docker Desktop.
- Le fichier `liste.txt` ne contient que des noms d'objets, pas de données ; il peut être supprimé après usage.

### 3.3 Vérifier

Comparer la base d'origine et la base restaurée. Le même script s'exécute sur les deux :

```powershell
$sql = @'
SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text AS lignes
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
'@
# Base d'origine (Supabase) : nécessite SUPABASE_DB_URL ; faire la comparaison sur une base qui ne reçoit pas d'écritures,
# sinon les comptes diffèrent légitimement entre l'export et la vérification.
$src = $sql | docker run --rm -i -e SUPABASE_DB_URL postgres:17-alpine sh -c 'psql $SUPABASE_DB_URL -At'
# Base restaurée
$tgt = $sql | docker exec -i restore-test psql -U postgres -d restore_test -At

if ($src -and -not (Compare-Object $src $tgt)) { 'Comptes identiques' } else { 'DIFFERENCE : voir $src et $tgt' }
```

Puis vérifier la structure (nombre d'index, de contraintes, contrainte d'exclusion, migrations Prisma terminées, extension). Le résultat doit être identique des deux côtés :

```powershell
$sql2 = @'
SELECT 'index' AS controle, count(*) AS valeur FROM pg_indexes WHERE schemaname = 'public'
UNION ALL SELECT 'contraintes', count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
UNION ALL SELECT 'exclusion_gist', count(*) FROM pg_constraint WHERE contype = 'x'
UNION ALL SELECT 'migrations_terminees', count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL
UNION ALL SELECT 'extension_btree_gist', count(*) FROM pg_extension WHERE extname = 'btree_gist';
'@
$src2 = $sql2 | docker run --rm -i -e SUPABASE_DB_URL postgres:17-alpine sh -c 'psql $SUPABASE_DB_URL -At'
$tgt2 = $sql2 | docker exec -i restore-test psql -U postgres -d restore_test -At
if ($src2 -and -not (Compare-Object $src2 $tgt2)) { 'Structure identique' } else { 'DIFFERENCE' }
```

Points à contrôler : la table `_prisma_migrations` est présente et ses migrations sont terminées (sinon `prisma migrate deploy` voudrait rejouer des migrations déjà appliquées) ; l'index et la contrainte d'exclusion des listes de courses existent (les valeurs `index`, `contraintes` et `exclusion_gist` ci-dessus).

### 3.4 Supprimer la base jetable et les dumps

```powershell
docker rm -f restore-test
Remove-Item "$dest\liste.txt"
# puis, selon la politique de conservation (section 6), supprimer ou archiver chiffré le fichier .dump
```

## 4. Restauration en production après un sinistre

Cette procédure **écrase** la base de production. Elle n'est lancée que sur décision de Jeff.

Risques à avoir en tête avant de commencer :

- **Écrasement des données** : tout ce qui a été écrit depuis l'export est perdu. Si des utilisateurs ont demandé la suppression de leur compte après la date du dump, ces suppressions doivent être refaites après la restauration (RGPD).
- **Indisponibilité** : l'API doit être arrêtée pendant l'opération pour éviter des écritures concurrentes.
- **Désynchronisation code et schéma** : le schéma restauré est celui de la date du dump. Si des migrations ont été déployées depuis, elles seront rejouées au prochain démarrage du conteneur (`_prisma_migrations` est restaurée avec le dump), ce qui est normal ; si c'est une migration qui a provoqué le sinistre, **ne pas redéployer la version fautive** avant correction.

Étapes :

1. **Arrêter l'écriture** : suspendre le service API sur Render (ou le rendre inaccessible). Noter l'heure.
2. **Sauvegarder l'état actuel**, même abîmé, avec la commande de la section 2 (autre nom de fichier), pour pouvoir récupérer des données si besoin. Si la base est inaccessible, passer à l'étape suivante.
3. **Choisir le dump** : le plus récent dont la restauration jetable a été vérifiée (section 3).
4. **Restaurer par-dessus la base de production** : mêmes commandes que la section 3.2, avec la chaîne de connexion de production à la place de la base jetable, et les options `--clean --if-exists` ajoutées à `pg_restore`. Elles suppriment d'abord les objets présents dans le dump (tables, types, index, extension) avant de les recréer. Les objets créés après la date du dump ne sont pas supprimés. Utiliser la connexion directe ou le Session pooler, pas le Transaction pooler.
5. **Vérifier** : comptes de lignes, index, contraintes et migrations (section 3.3, en comparant à ce que le dump devait contenir).
6. **Relancer l'API**, puis contrôler `GET /health` et un parcours simple (connexion, lecture d'une recette).
7. **Rédiger un compte rendu** : cause, heure du dump restauré, données perdues, suppressions de comptes à refaire.

La variante `--clean --if-exists` a été testée en local contre une base jetable volontairement abîmée (lignes supprimées, table supprimée) : le résultat était identique à la source. Elle n'a **pas** été testée contre Supabase. Une alternative plus sûre, si le quota de projets du plan gratuit le permet (non vérifié) : restaurer dans un nouveau projet Supabase, vérifier, puis changer la chaîne de connexion de l'API.

**Storage** : non concerné, l'application ne l'utilise pas. Il n'y a rien d'autre à restaurer côté Supabase (pas de schéma `auth`, pas de fonctions, pas de rôles personnalisés).

## 5. Test réalisé

Date : 2026-11-24. Machine : Windows 11, Docker Desktop.

- **Source** : base de développement locale (`postgres:16-alpine`, serveur 16.11), utilisée en lecture seule par `pg_dump`. Elle tient lieu de stand-in du serveur Supabase : **ce n'est pas Supabase**.
- **Cibles jetables** : conteneurs `postgres:16-alpine` (16.11, port 5440) et `postgres:17-alpine` (17.12, port 5441), supprimés en fin de test.
- **Clients** : `pg_dump` / `pg_restore` 17.12 (image `postgres:17-alpine`) et 16.11 (image `postgres:16-alpine`).
- **Contenu comparé** : 12 tables, dont `_prisma_migrations`, 24 index, 29 contraintes (dont 1 contrainte d'exclusion GiST), extension `btree_gist`.

Comptes de lignes (identiques entre la source et chaque cible restaurée avec succès) :

| Table                         | Lignes |
| ----------------------------- | -----: |
| `_prisma_migrations`          |     10 |
| `calendar_entries`            |      1 |
| `calendar_entry_consumptions` |      0 |
| `ingredients`                 |      9 |
| `recipe_ingredients`          |      6 |
| `recipe_steps`                |      2 |
| `recipes`                     |      5 |
| `refresh_tokens`              |      2 |
| `shopping_items`              |      3 |
| `shopping_lists`              |      2 |
| `stock`                       |      5 |
| `users`                       |      8 |

Combinaisons essayées :

| Dump produit par                           | Restauré avec   | Serveur cible | Résultat                                                                                                                                                                                                           |
| ------------------------------------------ | --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pg_dump` 17                               | `pg_restore` 16 | 16            | **Échec** : `unsupported version (1.16) in file header` (le format d'archive de la version 17 est illisible par la 16).                                                                                            |
| `pg_dump` 17                               | `pg_restore` 17 | 16            | **Échec** : `unrecognized configuration parameter "transaction_timeout"` (paramètre inconnu du serveur 16).                                                                                                        |
| `pg_dump` 17 sans `--extension`            | `pg_restore` 17 | 17            | **Échec** sur la contrainte GiST (`no default operator class for access method "gist"`) ; plus l'erreur `schema "public" already exists`.                                                                          |
| `pg_dump` 17 avec `--extension=btree_gist` | `pg_restore` 17 | 17            | Succès avec la liste filtrée et `--exit-on-error` : comptes, index, contraintes et migrations identiques. Sans la liste filtrée : une seule erreur bénigne (`schema "public" already exists`) et code de sortie 1. |
| `pg_dump` 16                               | `pg_restore` 16 | 16            | Succès, comptes et structure identiques.                                                                                                                                                                           |
| `pg_dump` 16                               | `pg_restore` 17 | 17            | Succès, comptes identiques (dump plus ancien que le serveur : accepté).                                                                                                                                            |
| `pg_dump` 16 lancé contre un serveur 17    | sans objet      | 17            | **Échec** à l'export : `aborting because of server version mismatch` (client plus ancien que le serveur).                                                                                                          |
| `--clean --if-exists` sur base abîmée      | `pg_restore` 17 | 17            | Succès : comptes et structure identiques à la source.                                                                                                                                                              |

Enseignements :

1. Prendre pour `pg_dump` la **même version majeure que le serveur Supabase**, et restaurer sur un serveur de version **supérieure ou égale**, avec le `pg_restore` de cette même version.
2. Ajouter `--extension=btree_gist` à l'export, sans quoi la contrainte `shopping_lists_no_overlap` ne se recrée pas.
3. Filtrer `CREATE SCHEMA public` de la liste de restauration pour obtenir une restauration sans erreur.

Chaîne complète exécutée en PowerShell 5.1 (export, liste filtrée, restauration, comparaison des comptes) : succès, comptes identiques. Les fichiers de dump et les conteneurs jetables ont été supprimés après le test.

## 6. Limites et ce qui n'est pas testé

**Non testé contre Supabase, à valider par Jeff au premier export** :

- l'export lui-même depuis le vrai Supabase (connexion directe ou Session pooler, droits du rôle de connexion, version du serveur) ;
- les exigences réseau de chaque mode de connexion (IPv4 ou IPv6) et l'usage du Transaction pooler avec `pg_dump` et `pg_restore` ;
- le comportement si `btree_gist` est installée dans un autre schéma que `public` (par exemple `extensions`) : la ligne `CREATE EXTENSION` du dump pourrait demander que ce schéma existe dans la base cible, à créer au préalable (`CREATE SCHEMA extensions;`) ; la définition de l'index pourrait aussi y faire référence ;
- la restauration `--clean --if-exists` directement dans la base Supabase de production ;
- les versions de serveur autres que 16 et 17.

Après le premier export réel, Jeff relève la version du serveur, le schéma de l'extension et les comptes de lignes, puis rejoue la section 3 ; le résultat remplace ou complète ce paragraphe.

**Limites de la procédure** :

- **Conservation hors site** : un fichier gardé uniquement sur le PC de Jeff ne protège pas d'une panne du disque. Garder au moins une copie ailleurs.
- **Données personnelles (RGPD)** : les dumps contiennent des adresses e-mail, des mots de passe hachés et des jetons de rafraîchissement. Ne **jamais** les committer (le dossier de sortie est hors du dépôt), les stocker chiffrés (archive chiffrée type 7-Zip AES-256, ou disque chiffré type BitLocker) et supprimer les anciens. Une personne qui demande l'effacement de ses données doit aussi disparaître des sauvegardes conservées, ou être ré-effacée après toute restauration : la durée de conservation est donc à garder courte.
- **Pas de rétention automatique** : la suppression des anciens fichiers est manuelle.
- **Sauvegarde manuelle** : elle peut être oubliée ; aucune alerte n'existe.
- **Pas de restauration à un instant précis** : on revient à la date du dump.
- Le passage au plan Pro de Supabase donnerait des sauvegardes quotidiennes conservées 7 jours.
