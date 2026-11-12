import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/services/prisma.service';
import { EmailService } from '../src/email/services/email.service';

// supertest type ses réponses en `any` : ce petit assistant centralise le
// seul cast du fichier plutôt que d'en semer un peu partout.
function body<T>(res: request.Response): T {
  return res.body as T;
}

interface AuthResponse {
  access_token: string;
}
interface ErrorResponse {
  message: string | string[];
}
interface EntityId {
  id: string;
}
interface RecipeResponse {
  id: string;
  title: string;
  recipeIngredients: unknown[];
}
interface ShoppingListResponse {
  id: string;
  periodStart: string;
  items: EntityId[];
}
interface StockEntry {
  ingredient: { name: string };
  quantity: number;
}
interface StockEntryWithUnit extends StockEntry {
  unit: string;
}
interface ShoppingItemWithIngredient {
  quantityNeeded: number;
  quantityInStock: number;
  unit: string;
  ingredient: { name: string };
}

// Tests d'intégration + tests système + tests de sécurité (CP9) sur le
// flux le plus représentatif du projet : inscription -> planification ->
// génération et validation d'une liste de courses (le scénario T17).
//
// Contrairement aux tests unitaires (T01-T17, jest, PrismaService mocké),
// ce fichier ne mocke rien côté métier : l'application est démarrée
// entièrement (guards, pipes, controllers, services, Prisma) contre la
// vraie base Postgres locale. Seul EmailService est stubbé, pour ne pas
// dépendre d'un vrai appel réseau vers Brevo à chaque exécution.
describe('Parcours liste de courses (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let server: App;

  // Suffixe court : le pseudo est contraint à 20 caractères max (RegisterDto).
  const uniqueSuffix = Date.now().toString().slice(-8);
  const user1 = {
    email: `e2e-user1-${uniqueSuffix}@test.local`,
    pseudo: `e2euser1${uniqueSuffix}`,
    password: 'motdepasse123',
  };
  const user2 = {
    email: `e2e-user2-${uniqueSuffix}@test.local`,
    pseudo: `e2euser2${uniqueSuffix}`,
    password: 'motdepasse123',
  };

  let token1: string;
  let token2: string;
  let recipeId: string;
  let shoppingListId: string;
  let itemIds: string[];

  // Deux jours consécutifs proches dans le futur : indépendants de la date
  // du jour d'exécution, jamais en conflit avec une donnée déjà existante
  // puisque les utilisateurs de test sont créés à la volée.
  // Si +10 jours tombe un dimanche, on recule d'un jour (samedi) : samedi et
  // dimanche sont dans la même semaine lun-dim pour splitIntoWeeks, alors que
  // dimanche+lundi sont dans deux semaines différentes → deux listes séparées.
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const base = new Date(Date.now() + 10 * MS_PER_DAY);
  const day1 =
    base.getUTCDay() === 0 ? new Date(base.getTime() - MS_PER_DAY) : base;
  const day2 = new Date(day1.getTime() + MS_PER_DAY);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({
        sendVerificationEmail: () => Promise.resolve(),
        sendInsufficientStockEmail: () => Promise.resolve(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    // Même pipe global qu'en production (main.ts) : whitelist + transform,
    // sinon les DTOs ne se comportent pas comme en conditions réelles.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    server = app.getHttpServer();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Nettoyage. Les ingrédients sont protégés par ON DELETE RESTRICT
    // depuis recipe_ingredients/stock/shopping_items (cf. prisma/schema.prisma) :
    // un simple `user.deleteMany` cascade dans un ordre non garanti et peut
    // percuter cette contrainte. On vide donc explicitement les tables
    // RESTRICT-dépendantes avant de supprimer les utilisateurs de test.
    const testUsers = await prisma.user.findMany({
      where: { email: { in: [user1.email, user2.email] } },
      select: { id: true },
    });
    const userIds = testUsers.map((u) => u.id);
    if (userIds.length > 0) {
      await prisma.shoppingItem.deleteMany({
        where: { list: { userId: { in: userIds } } },
      });
      await prisma.recipeIngredient.deleteMany({
        where: { recipe: { userId: { in: userIds } } },
      });
      await prisma.stock.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app.close();
  });

  // -------------------------------------------------------------------
  // Tests d'intégration + système : inscription, authentification
  // -------------------------------------------------------------------
  describe('Inscription et authentification', () => {
    it("refuse la connexion tant que l'email n'est pas vérifié", async () => {
      await request(server).post('/auth/register').send(user1).expect(201);

      const res = await request(server).post('/auth/login').send(user1);
      expect(res.status).toBe(401);
    });

    it("connecte l'utilisateur une fois l'email vérifié directement en base", async () => {
      // Vérification manuelle en base : simule le clic sur le lien reçu
      // par email, sans dépendre d'un vrai envoi/réception de mail.
      await prisma.user.update({
        where: { email: user1.email },
        data: { emailVerified: true },
      });

      const res = await request(server).post('/auth/login').send(user1);
      expect(res.status).toBe(200);
      const parsed = body<AuthResponse>(res);
      expect(parsed.access_token).toBeDefined();
      token1 = parsed.access_token;
    });
  });

  // -------------------------------------------------------------------
  // Tests de sécurité
  // -------------------------------------------------------------------
  describe('Sécurité', () => {
    it('refuse une route protégée sans jeton (401)', async () => {
      await request(server).get('/auth/me').expect(401);
    });

    it('refuse un jeton invalide (401)', async () => {
      await request(server)
        .get('/auth/me')
        .set('Authorization', 'Bearer ceci-nest-pas-un-jeton-valide')
        .expect(401);
    });

    it('rejette un payload invalide en 400 (validation déclarative)', async () => {
      const res = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({ title: '' })
        .expect(400);
      expect(body<ErrorResponse>(res).message).toBeDefined();
    });

    it("stocke une entrée contenant des caractères d'injection SQL comme une simple chaîne, sans erreur serveur", async () => {
      const maliciousTitle = "Gâteau'); DROP TABLE users; --";
      const res = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({ title: maliciousTitle, servings: 4 })
        .expect(201);
      const created = body<RecipeResponse>(res);
      expect(created.title).toBe(maliciousTitle);

      // La table users existe toujours : la chaîne n'a jamais été
      // interprétée comme du SQL (Prisma paramètre systématiquement).
      const stillThere = await prisma.user.findUnique({
        where: { email: user1.email },
      });
      expect(stillThere).not.toBeNull();

      await request(server)
        .delete(`/recipes/${created.id}`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(204);
    });
  });

  // -------------------------------------------------------------------
  // Tests d'intégration + système : préparation du scénario
  // -------------------------------------------------------------------
  describe('Préparation — ingrédients, recette, calendrier', () => {
    it('crée les deux ingrédients nécessaires', async () => {
      const farineRes = await request(server)
        .post('/ingredients')
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: 'Farine e2e', defaultUnit: 'G' })
        .expect(201);
      const sucreRes = await request(server)
        .post('/ingredients')
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: 'Sucre e2e', defaultUnit: 'G' })
        .expect(201);
      const farine = body<EntityId>(farineRes);
      const sucre = body<EntityId>(sucreRes);

      const recipeRes = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Gâteau e2e',
          servings: 4,
          ingredients: [
            { ingredientId: farine.id, quantity: 500, unit: 'G' },
            { ingredientId: sucre.id, quantity: 200, unit: 'G' },
          ],
        })
        .expect(201);
      const recipe = body<RecipeResponse>(recipeRes);
      recipeId = recipe.id;
      expect(recipe.recipeIngredients).toHaveLength(2);
    });

    it('planifie la recette sur deux jours', async () => {
      await request(server)
        .post('/calendar')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          recipeId,
          plannedDate: isoDate(day1),
          mealSlot: 'SOIR',
          servings: 4,
        })
        .expect(201);
      await request(server)
        .post('/calendar')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          recipeId,
          plannedDate: isoDate(day2),
          mealSlot: 'SOIR',
          servings: 4,
        })
        .expect(201);
    });

    it('refuse un second repas sur le même créneau déjà occupé (409, non-régression T12)', async () => {
      await request(server)
        .post('/calendar')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          recipeId,
          plannedDate: isoDate(day1),
          mealSlot: 'SOIR',
          servings: 2,
        })
        .expect(409);
    });
  });

  // -------------------------------------------------------------------
  // Tests d'intégration + système : le scénario T17 rejoué en conditions
  // réelles (vraie base, vrai serveur HTTP, transaction Prisma réelle)
  // -------------------------------------------------------------------
  describe('Génération et validation atomique de la liste de courses', () => {
    it('refuse de générer sur une plage avec un jour sans recette planifiée (400)', async () => {
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const res = await request(server)
        .post('/shopping/generate')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          periodStart: isoDate(day1),
          periodEnd: isoDate(farFuture),
        })
        .expect(400);
      expect(body<ErrorResponse>(res).message).toContain('recette programmée');
    });

    it('génère la liste sur la plage complète (400 - stock = besoin réel)', async () => {
      const res = await request(server)
        .post('/shopping/generate')
        .set('Authorization', `Bearer ${token1}`)
        .send({ periodStart: isoDate(day1), periodEnd: isoDate(day2) })
        .expect(201);
      const list = body<ShoppingListResponse[]>(res)[0];
      shoppingListId = list.id;
      // 2 jours x recette (farine 500g, sucre 200g) = 1000g farine, 400g sucre
      expect(list.items).toHaveLength(2);
    });

    it('refuse de régénérer sur une plage qui chevauche la liste existante (409)', async () => {
      await request(server)
        .post('/shopping/generate')
        .set('Authorization', `Bearer ${token1}`)
        .send({ periodStart: isoDate(day2), periodEnd: isoDate(day2) })
        .expect(409);
    });

    it('coche les articles puis valide la liste : le stock est créé de façon atomique', async () => {
      const list = await request(server)
        .get(`/shopping/${shoppingListId}`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);
      itemIds = body<ShoppingListResponse>(list).items.map((i) => i.id);

      for (const itemId of itemIds) {
        await request(server)
          .patch(`/shopping/${shoppingListId}/items/${itemId}`)
          .set('Authorization', `Bearer ${token1}`)
          .send({ checked: true })
          .expect(200);
      }

      await request(server)
        .post(`/shopping/${shoppingListId}/validate`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(201);

      const stock = await request(server)
        .get('/stock')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);
      const stockByName = new Map(
        body<StockEntry[]>(stock).map((s) => [s.ingredient.name, s.quantity]),
      );
      expect(stockByName.get('Farine e2e')).toBe(1000);
      expect(stockByName.get('Sucre e2e')).toBe(400);
    });

    it('refuse de valider une seconde fois la même liste (409, protection contre la concurrence)', async () => {
      await request(server)
        .post(`/shopping/${shoppingListId}/validate`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(409);
    });

    it('dévalide la liste : le stock ajouté est retiré précisément', async () => {
      await request(server)
        .post(`/shopping/${shoppingListId}/unvalidate`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(201);

      const stock = await request(server)
        .get('/stock')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);
      const stockByName = new Map(
        body<StockEntry[]>(stock).map((s) => [s.ingredient.name, s.quantity]),
      );
      expect(stockByName.has('Farine e2e')).toBe(false);
      expect(stockByName.has('Sucre e2e')).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // Tests de sécurité : cloisonnement entre utilisateurs (ownership)
  // -------------------------------------------------------------------
  describe('Cloisonnement des données entre utilisateurs', () => {
    it('crée un second utilisateur et le connecte', async () => {
      await request(server).post('/auth/register').send(user2).expect(201);
      await prisma.user.update({
        where: { email: user2.email },
        data: { emailVerified: true },
      });
      const res = await request(server)
        .post('/auth/login')
        .send(user2)
        .expect(200);
      token2 = body<AuthResponse>(res).access_token;
    });

    it("refuse à l'utilisateur 2 l'accès à une recette de l'utilisateur 1 (403, pas 404)", async () => {
      await request(server)
        .get(`/recipes/${recipeId}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(403);
    });

    it("renvoie 404 pour une recette qui n'existe pas du tout (distinction 403/404)", async () => {
      await request(server)
        .get('/recipes/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${token1}`)
        .expect(404);
    });

    it("refuse à l'utilisateur 2 l'accès à la liste de courses de l'utilisateur 1 (403)", async () => {
      await request(server)
        .get(`/shopping/${shoppingListId}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------
  // Unités cohérentes : l'unité d'un ingrédient est définitive, recettes
  // et stock s'y alignent, la liste de courses compare dans cette unité.
  // -------------------------------------------------------------------
  describe('Unités cohérentes entre recette, stock et liste de courses', () => {
    const day3 = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
    let rizId: string;
    let laitId: string;

    it("enregistre un stock saisi en kg dans l'unité de l'ingrédient (g)", async () => {
      const rizRes = await request(server)
        .post('/ingredients')
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: 'Riz e2e', defaultUnit: 'G' })
        .expect(201);
      const laitRes = await request(server)
        .post('/ingredients')
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: 'Lait e2e', defaultUnit: 'ML' })
        .expect(201);
      rizId = body<EntityId>(rizRes).id;
      laitId = body<EntityId>(laitRes).id;

      const stockRes = await request(server)
        .post('/stock')
        .set('Authorization', `Bearer ${token1}`)
        .send({ ingredientId: rizId, quantity: 1, unit: 'KG' })
        .expect(201);
      const stock = body<StockEntryWithUnit>(stockRes);
      expect(stock.quantity).toBe(1000);
      expect(stock.unit).toBe('G');
    });

    it("refuse un stock dans une unité sans équivalent avec celle de l'ingrédient (400)", async () => {
      const res = await request(server)
        .post('/stock')
        .set('Authorization', `Bearer ${token1}`)
        .send({ ingredientId: laitId, quantity: 2, unit: 'PIECE' })
        .expect(400);
      expect(String(body<ErrorResponse>(res).message)).toContain(
        "n'est pas compatible avec « Lait e2e » (ml)",
      );
    });

    it("refuse une ligne de recette dans une unité sans équivalent avec celle de l'ingrédient (400)", async () => {
      const res = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Riz refusé e2e',
          ingredients: [{ ingredientId: rizId, quantity: 1, unit: 'L' }],
        })
        .expect(400);
      expect(String(body<ErrorResponse>(res).message)).toContain(
        "n'est pas compatible avec « Riz e2e » (g)",
      );
    });

    it("refuse un ingrédient qui n'appartient pas à l'utilisateur (404)", async () => {
      await request(server)
        .post('/stock')
        .set('Authorization', `Bearer ${token2}`)
        .send({ ingredientId: rizId, quantity: 1, unit: 'KG' })
        .expect(404);
    });

    it("convertit le stock quand l'unité de l'ingrédient change dans la même famille (g vers kg)", async () => {
      const res = await request(server)
        .patch(`/ingredients/${rizId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ defaultUnit: 'KG' })
        .expect(200);
      expect(body<{ defaultUnit: string }>(res).defaultUnit).toBe('KG');

      const stock = await request(server)
        .get('/stock')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);
      const riz = body<StockEntryWithUnit[]>(stock).find(
        (s) => s.ingredient.name === 'Riz e2e',
      );
      expect(riz?.quantity).toBe(1);
      expect(riz?.unit).toBe('KG');

      // Retour en g : le stock repasse à 1000 g (la suite du scénario part de là).
      await request(server)
        .patch(`/ingredients/${rizId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ defaultUnit: 'G' })
        .expect(200);
    });

    it('refuse de changer de famille un ingrédient utilisé, sans équivalent possible (409)', async () => {
      const res = await request(server)
        .patch(`/ingredients/${rizId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ defaultUnit: 'ML' })
        .expect(409);
      expect(String(body<ErrorResponse>(res).message)).toContain(
        'il est utilisé',
      );
    });

    it("refuse de modifier l'ingrédient d'un autre utilisateur (404)", async () => {
      await request(server)
        .patch(`/ingredients/${rizId}`)
        .set('Authorization', `Bearer ${token2}`)
        .send({ defaultUnit: 'KG' })
        .expect(404);
    });

    it('génère la liste en comparant le besoin (kg) au stock converti (g)', async () => {
      const recipeRes = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Riz au lait e2e',
          servings: 2,
          ingredients: [
            { ingredientId: rizId, quantity: 1.5, unit: 'KG' },
            { ingredientId: laitId, quantity: 2, unit: 'CUILLERE_A_SOUPE' },
          ],
        })
        .expect(201);
      const riceRecipeId = body<EntityId>(recipeRes).id;

      await request(server)
        .post('/calendar')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          recipeId: riceRecipeId,
          plannedDate: isoDate(day3),
          mealSlot: 'SOIR',
          servings: 2,
        })
        .expect(201);

      const listRes = await request(server)
        .post('/shopping/generate')
        .set('Authorization', `Bearer ${token1}`)
        .send({ periodStart: isoDate(day3), periodEnd: isoDate(day3) })
        .expect(201);
      const items =
        body<{ items: ShoppingItemWithIngredient[] }[]>(listRes)[0].items;
      const byName = new Map(items.map((i) => [i.ingredient.name, i]));

      const riz = byName.get('Riz e2e');
      expect(riz?.quantityNeeded).toBe(1500);
      expect(riz?.quantityInStock).toBe(1000);
      expect(riz?.unit).toBe('G');

      const lait = byName.get('Lait e2e');
      expect(lait?.quantityNeeded).toBe(30);
      expect(lait?.quantityInStock).toBe(0);
      expect(lait?.unit).toBe('ML');
    });
  });

  // -------------------------------------------------------------------
  // Équivalence par ingrédient : une cuillère à soupe pèse X g, ce qui
  // relie les grammes aux cuillères pour le stock et la liste de courses.
  // -------------------------------------------------------------------
  describe('Équivalence poids / cuillère par ingrédient', () => {
    const day4 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    let farineId: string;

    it('crée une farine avec 500 g en stock', async () => {
      const res = await request(server)
        .post('/ingredients')
        .set('Authorization', `Bearer ${token1}`)
        .send({ name: 'Farine cuillère e2e', defaultUnit: 'G' })
        .expect(201);
      farineId = body<EntityId>(res).id;

      await request(server)
        .post('/stock')
        .set('Authorization', `Bearer ${token1}`)
        .send({ ingredientId: farineId, quantity: 500, unit: 'G' })
        .expect(201);
    });

    it("refuse un volume (cl) tant que l'équivalence n'est pas renseignée (400)", async () => {
      const res = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Gâteau refusé e2e',
          ingredients: [{ ingredientId: farineId, quantity: 1, unit: 'CL' }],
        })
        .expect(400);
      expect(String(body<ErrorResponse>(res).message)).toContain(
        "renseigne d'abord son équivalence",
      );
    });

    it('accepte une cuillère à soupe sans équivalence (repli de 15 g)', async () => {
      await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Cuillère sans équivalence e2e',
          ingredients: [
            { ingredientId: farineId, quantity: 1, unit: 'CUILLERE_A_SOUPE' },
          ],
        })
        .expect(201);
    });

    it("renseigne l'équivalence : 1 cuillère à soupe de farine = 10 g", async () => {
      const res = await request(server)
        .patch(`/ingredients/${farineId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ gramsPerTablespoon: 10 })
        .expect(200);
      expect(body<{ gramsPerTablespoon: number }>(res).gramsPerTablespoon).toBe(
        10,
      );
    });

    it('convertit le stock en ml puis en g quand l’unité change de famille avec l’équivalence', async () => {
      await request(server)
        .patch(`/ingredients/${farineId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ defaultUnit: 'ML' })
        .expect(200);
      let stock = await request(server)
        .get('/stock')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);
      let farine = body<StockEntryWithUnit[]>(stock).find(
        (s) => s.ingredient.name === 'Farine cuillère e2e',
      );
      // 10 g pour 15 ml : 500 g = 750 ml
      expect(farine?.quantity).toBe(750);
      expect(farine?.unit).toBe('ML');

      await request(server)
        .patch(`/ingredients/${farineId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ defaultUnit: 'G' })
        .expect(200);
      stock = await request(server)
        .get('/stock')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);
      farine = body<StockEntryWithUnit[]>(stock).find(
        (s) => s.ingredient.name === 'Farine cuillère e2e',
      );
      expect(farine?.quantity).toBe(500);
      expect(farine?.unit).toBe('G');
    });

    it('refuse deux lignes du même ingrédient dans une recette (400)', async () => {
      const res = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Doublon e2e',
          ingredients: [
            { ingredientId: farineId, quantity: 600, unit: 'G' },
            { ingredientId: farineId, quantity: 3, unit: 'CUILLERE_A_SOUPE' },
          ],
        })
        .expect(400);
      expect(String(body<ErrorResponse>(res).message)).toContain(
        'apparaît plusieurs fois',
      );
    });

    it('modifie la quantité et l’unité d’une ligne de recette existante', async () => {
      const recipeRes = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Ligne modifiée e2e',
          ingredients: [{ ingredientId: farineId, quantity: 100, unit: 'G' }],
        })
        .expect(201);
      const id = body<EntityId>(recipeRes).id;

      const res = await request(server)
        .patch(`/recipes/${id}/ingredients/${farineId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ quantity: 3, unit: 'CUILLERE_A_SOUPE' })
        .expect(200);
      expect(body<{ quantity: number; unit: string }>(res)).toMatchObject({
        quantity: 3,
        unit: 'CUILLERE_A_SOUPE',
      });

      const refused = await request(server)
        .patch(`/recipes/${id}/ingredients/${farineId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ unit: 'PIECE' })
        .expect(400);
      expect(String(body<ErrorResponse>(refused).message)).toContain(
        "n'est pas compatible",
      );

      await request(server)
        .patch(`/recipes/${id}/ingredients/${farineId}`)
        .set('Authorization', `Bearer ${token2}`)
        .send({ quantity: 1 })
        .expect(403);
    });

    it('découpe une période à cheval sur deux semaines en une liste par semaine, et régénérer les remplace', async () => {
      // Prochain dimanche à au moins 60 jours : dimanche et lundi sont dans
      // deux semaines différentes (lundi au dimanche).
      const sunday = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7));
      const monday = new Date(sunday.getTime() + 24 * 60 * 60 * 1000);

      const recipeRes = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Deux semaines e2e',
          servings: 2,
          ingredients: [{ ingredientId: farineId, quantity: 100, unit: 'G' }],
        })
        .expect(201);
      for (const day of [sunday, monday]) {
        await request(server)
          .post('/calendar')
          .set('Authorization', `Bearer ${token1}`)
          .send({
            recipeId: body<EntityId>(recipeRes).id,
            plannedDate: isoDate(day),
            mealSlot: 'MIDI',
            servings: 2,
          })
          .expect(201);
      }

      const generate = () =>
        request(server)
          .post('/shopping/generate')
          .set('Authorization', `Bearer ${token1}`)
          .send({ periodStart: isoDate(sunday), periodEnd: isoDate(monday) })
          .expect(201);

      const first = body<ShoppingListResponse[]>(await generate());
      expect(first).toHaveLength(2);
      expect(first.map((list) => list.periodStart.slice(0, 10))).toEqual([
        isoDate(sunday),
        isoDate(monday),
      ]);

      // Régénérer remplace les deux listes au lieu d'en créer d'autres.
      const second = body<ShoppingListResponse[]>(await generate());
      expect(second.map((list) => list.id)).toEqual(
        first.map((list) => list.id),
      );
    });

    it('compare 63 cuillères à soupe (630 g) au stock de 500 g', async () => {
      const recipeRes = await request(server)
        .post('/recipes')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          title: 'Gâteau e2e',
          servings: 2,
          ingredients: [
            { ingredientId: farineId, quantity: 63, unit: 'CUILLERE_A_SOUPE' },
          ],
        })
        .expect(201);

      await request(server)
        .post('/calendar')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          recipeId: body<EntityId>(recipeRes).id,
          plannedDate: isoDate(day4),
          mealSlot: 'SOIR',
          servings: 2,
        })
        .expect(201);

      const listRes = await request(server)
        .post('/shopping/generate')
        .set('Authorization', `Bearer ${token1}`)
        .send({ periodStart: isoDate(day4), periodEnd: isoDate(day4) })
        .expect(201);
      const items =
        body<{ items: ShoppingItemWithIngredient[] }[]>(listRes)[0].items;
      const farine = items.find(
        (i) => i.ingredient.name === 'Farine cuillère e2e',
      );

      expect(farine?.quantityNeeded).toBe(630);
      expect(farine?.quantityInStock).toBe(500);
      expect(farine?.unit).toBe('G');
    });
  });
});
