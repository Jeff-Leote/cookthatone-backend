import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/services/prisma.service';
import { EmailService } from '../src/email/services/email.service';

// supertest type ses réponses en `any` : un seul cast, centralisé ici.
function body<T>(res: request.Response): T {
  return res.body as T;
}

interface AuthResponse {
  access_token: string;
}
interface ErrorResponse {
  message: string | string[];
}
interface NamedResponse {
  id: string;
  name: string;
}
interface TitledResponse {
  id: string;
  title: string;
}

// Majuscule initiale des titres de recette et des noms d'ingrédient (B#82).
describe('Majuscule initiale (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let server: App;
  let token: string;

  const uniqueSuffix = Date.now().toString().slice(-8);
  const user = {
    email: `e2e-capitalize-${uniqueSuffix}@test.local`,
    pseudo: `e2ecap${uniqueSuffix}`,
    password: 'motdepasse123',
  };

  // Le limiteur global tolère 30 requêtes par minute et par IP : chaque requête
  // porte une IP source distincte pour que cette suite ne le déclenche pas.
  let requestCount = 0;
  const auth = () => ({
    Authorization: `Bearer ${token}`,
    'X-Forwarded-For': `10.2.${requestCount >> 8}.${requestCount++ & 255}`,
  });

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

    const nestApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    // Même réglage qu'en production : l'IP est lue dans X-Forwarded-For.
    nestApp.set('trust proxy', 1);
    app = nestApp;
    // Même pipe global qu'en production (main.ts).
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await request(server).post('/auth/register').send(user).expect(201);
    await prisma.user.update({
      where: { email: user.email },
      data: { emailVerified: true },
    });
    const login = await request(server).post('/auth/login').send(user);
    token = body<AuthResponse>(login).access_token;
  });

  afterAll(async () => {
    // Les recettes et les ingrédients partent en cascade avec l'utilisateur.
    await prisma.user.deleteMany({ where: { email: user.email } });
    await app.close();
  });

  const createIngredient = (name: unknown) =>
    request(server)
      .post('/ingredients')
      .set(auth())
      .send({ name, defaultUnit: 'G' });
  const createRecipe = (title: unknown) =>
    request(server).post('/recipes').set(auth()).send({ title });

  describe('ingrédients', () => {
    it('renvoie « farine » en « Farine » (201)', async () => {
      const res = await createIngredient('farine').expect(201);
      expect(body<NamedResponse>(res).name).toBe('Farine');
    });

    it('refuse « Farine » puis « farine » en doublon (409, message français)', async () => {
      for (const name of ['Farine', '  farine ']) {
        const res = await createIngredient(name).expect(409);
        expect(body<ErrorResponse>(res).message).toBe(
          'Cet ingrédient existe déjà',
        );
      }
    });

    it('normalise espaces, balisage et « œ »', async () => {
      const spaces = await createIngredient('  sucre   roux ').expect(201);
      expect(body<NamedResponse>(spaces).name).toBe('Sucre roux');
      const markup = await createIngredient('<b>ail</b>').expect(201);
      expect(body<NamedResponse>(markup).name).toBe('Ail');
      const ligature = await createIngredient('œufs').expect(201);
      expect(body<NamedResponse>(ligature).name).toBe('Œufs');
    });

    it('refuse un nom d’espaces (400, message existant, sans doublon)', async () => {
      const res = await createIngredient('   ').expect(400);
      expect(body<ErrorResponse>(res).message).toEqual(['Le nom est requis']);
    });

    it('refuse un nom qui n’est pas une chaîne (400)', async () => {
      const res = await createIngredient(42).expect(400);
      expect(body<ErrorResponse>(res).message).toEqual([
        'Le nom doit être une chaîne de caractères',
      ]);
    });
  });

  describe('recettes', () => {
    it('renvoie « crêpes maison » en « Crêpes maison » (201)', async () => {
      const res = await createRecipe('crêpes maison').expect(201);
      expect(body<TitledResponse>(res).title).toBe('Crêpes maison');
    });

    it('laisse « 3 chocolats » et « pâte à CRÊPES » comme saisis', async () => {
      const digit = await createRecipe('3 chocolats').expect(201);
      expect(body<TitledResponse>(digit).title).toBe('3 chocolats');
      const caps = await createRecipe('pâte à CRÊPES').expect(201);
      expect(body<TitledResponse>(caps).title).toBe('Pâte à CRÊPES');
    });

    it('applique la règle à la modification du titre', async () => {
      const created = body<TitledResponse>(
        await createRecipe('Tarte').expect(201),
      );
      const res = await request(server)
        .patch(`/recipes/${created.id}`)
        .set(auth())
        .send({ title: '  éclair   au café ' })
        .expect(200);
      expect(body<TitledResponse>(res).title).toBe('Éclair au café');
    });

    it('refuse un titre d’espaces à la création et à la modification (400)', async () => {
      const created = body<TitledResponse>(
        await createRecipe('Gratin').expect(201),
      );
      const onCreate = await createRecipe('   ').expect(400);
      expect(body<ErrorResponse>(onCreate).message).toEqual([
        'Le titre est requis',
      ]);
      const onUpdate = await request(server)
        .patch(`/recipes/${created.id}`)
        .set(auth())
        .send({ title: '   ' })
        .expect(400);
      expect(body<ErrorResponse>(onUpdate).message).toEqual([
        'Le titre ne peut pas être vide',
      ]);
    });
  });
});
