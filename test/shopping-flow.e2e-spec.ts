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
  items: EntityId[];
}
interface StockEntry {
  ingredient: { name: string };
  quantity: number;
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
  const day1 = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const day2 = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
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
      const list = body<ShoppingListResponse>(res);
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
      expect(stockByName.get('Farine e2e')).toBe(0);
      expect(stockByName.get('Sucre e2e')).toBe(0);
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
});
