import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/services/prisma.service';
import { EmailService } from '../src/email/services/email.service';
import {
  HTTP_URL_MAX_LENGTH,
  httpUrlMessage,
} from '../src/common/decorators/is-http-url.decorator';

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
interface RecipeResponse {
  id: string;
  title: string;
  sourceUrl: string | null;
}

// Adresse de la source d'une recette (B#85) : l'application est démarrée en
// entier contre la base locale, seul EmailService est stubbé.
describe('Recettes : adresse de la source (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let server: App;
  let token: string;

  const uniqueSuffix = Date.now().toString().slice(-8);
  const user = {
    email: `e2e-source-${uniqueSuffix}@test.local`,
    pseudo: `e2esrc${uniqueSuffix}`,
    password: 'motdepasse123',
  };
  const sourceUrl = 'https://exemple.fr/recettes/tarte?a=1&b=2#etapes';
  const otherUrl = 'http://exemple.fr/autre';
  const sourceUrlMessage = httpUrlMessage("L'adresse de la source");

  // Le limiteur global tolère 30 requêtes par minute et par IP : chaque requête
  // authentifiée porte une IP source distincte (voir `trust proxy` plus bas)
  // pour que le nombre de cas de cette suite ne le déclenche pas.
  let requestCount = 0;
  const auth = () => ({
    Authorization: `Bearer ${token}`,
    'X-Forwarded-For': `10.1.${requestCount >> 8}.${requestCount++ & 255}`,
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
    // Les recettes partent en cascade avec l'utilisateur de test.
    await prisma.user.deleteMany({ where: { email: user.email } });
    await app.close();
  });

  function createRecipe(extra: Record<string, unknown> = {}) {
    return request(server)
      .post('/recipes')
      .set(auth())
      .send({ title: 'Tarte e2e', ...extra });
  }

  it('crée une recette avec sourceUrl et la renvoie telle que saisie (201)', async () => {
    const res = await createRecipe({ sourceUrl: `  ${sourceUrl}  ` }).expect(
      201,
    );
    // Espaces retirés, « & » et fragment intacts.
    expect(body<RecipeResponse>(res).sourceUrl).toBe(sourceUrl);
  });

  it('renvoie sourceUrl dans le détail et dans la liste', async () => {
    const created = body<RecipeResponse>(
      await createRecipe({ title: 'Tarte liste e2e', sourceUrl }).expect(201),
    );

    const detail = await request(server)
      .get(`/recipes/${created.id}`)
      .set(auth())
      .expect(200);
    expect(body<RecipeResponse>(detail).sourceUrl).toBe(sourceUrl);

    const list = await request(server)
      .get('/recipes')
      .query({ search: 'Tarte liste e2e' })
      .set(auth())
      .expect(200);
    const found = body<RecipeResponse[]>(list).find((r) => r.id === created.id);
    expect(found?.sourceUrl).toBe(sourceUrl);
  });

  it('renvoie sourceUrl à null quand elle est omise', async () => {
    const res = await createRecipe({ title: 'Sans source e2e' }).expect(201);
    const created = body<RecipeResponse>(res);
    expect(created.sourceUrl).toBeNull();

    const detail = await request(server)
      .get(`/recipes/${created.id}`)
      .set(auth())
      .expect(200);
    expect(body<RecipeResponse>(detail).sourceUrl).toBeNull();
  });

  it('remplace, conserve puis efface la source avec PATCH', async () => {
    const created = body<RecipeResponse>(
      await createRecipe({ title: 'Patch e2e', sourceUrl }).expect(201),
    );
    const patch = (payload: Record<string, unknown>) =>
      request(server).patch(`/recipes/${created.id}`).set(auth()).send(payload);

    const replaced = await patch({ sourceUrl: otherUrl }).expect(200);
    expect(body<RecipeResponse>(replaced).sourceUrl).toBe(otherUrl);

    // Champ absent : la source ne bouge pas.
    const untouched = await patch({ title: 'Patch e2e renommée' }).expect(200);
    expect(body<RecipeResponse>(untouched).sourceUrl).toBe(otherUrl);

    const cleared = await patch({ sourceUrl: null }).expect(200);
    expect(body<RecipeResponse>(cleared).sourceUrl).toBeNull();

    const detail = await request(server)
      .get(`/recipes/${created.id}`)
      .set(auth())
      .expect(200);
    expect(body<RecipeResponse>(detail).sourceUrl).toBeNull();
  });

  it.each(['HTTP://exemple.fr', 'Http://exemple.fr'])(
    'accepte %s et le renvoie tel que saisi',
    async (value) => {
      const res = await createRecipe({ sourceUrl: value }).expect(201);
      expect(body<RecipeResponse>(res).sourceUrl).toBe(value);
    },
  );

  it("accepte une apostrophe dans le chemin et la stocke intacte (décision : l'apostrophe n'est pas refusée)", async () => {
    const withApostrophe = "https://exemple.fr/recettes/l'agneau-roti?a=1&b=2";
    const res = await createRecipe({ sourceUrl: withApostrophe }).expect(201);
    const created = body<RecipeResponse>(res);
    expect(created.sourceUrl).toBe(withApostrophe);

    const row = await prisma.recipe.findUnique({ where: { id: created.id } });
    expect(row?.sourceUrl).toBe(withApostrophe);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'ftp://exemple.fr',
    'exemple.fr',
    'https://user:pass@exemple.fr',
    'http:evil.fr',
    'https:///x',
    'https://exemple.fr/a<b',
    'https://exemple.fr/a"b',
    'https://exemple.fr/a\u200bb',
    'https://exemple.fr/a\u202eb',
    'https://exemple.fr/a\u0085b',
    '',
    '   ',
  ])(
    'refuse la source %j à la création (400, message en français)',
    async (value) => {
      const res = await createRecipe({ sourceUrl: value }).expect(400);
      expect(body<ErrorResponse>(res).message).toContain(sourceUrlMessage);
    },
  );

  it('refuse null à la création (400) : il ne sert qu’à effacer à la modification', async () => {
    await createRecipe({ sourceUrl: null }).expect(400);
  });

  it.each([['javascript:alert(1)'], ['https://exemple.fr/a<b'], [''], ['   ']])(
    'refuse la source %j à la modification et ne change rien en base (400)',
    async (value) => {
      const created = body<RecipeResponse>(
        await createRecipe({ title: 'Patch invalide e2e', sourceUrl }).expect(
          201,
        ),
      );
      const res = await request(server)
        .patch(`/recipes/${created.id}`)
        .set(auth())
        .send({ sourceUrl: value })
        .expect(400);
      expect(body<ErrorResponse>(res).message).toEqual([sourceUrlMessage]);

      const row = await prisma.recipe.findUnique({
        where: { id: created.id },
      });
      expect(row?.sourceUrl).toBe(sourceUrl);
    },
  );

  it('accepte exactement 2048 caractères et refuse 2049 (400)', async () => {
    const prefix = 'https://exemple.fr/';
    const atLimit = prefix + 'a'.repeat(HTTP_URL_MAX_LENGTH - prefix.length);
    expect(atLimit).toHaveLength(HTTP_URL_MAX_LENGTH);

    const ok = await createRecipe({ sourceUrl: atLimit }).expect(201);
    expect(body<RecipeResponse>(ok).sourceUrl).toBe(atLimit);

    const tooLong = await createRecipe({ sourceUrl: `${atLimit}a` }).expect(
      400,
    );
    expect(body<ErrorResponse>(tooLong).message).toContain(sourceUrlMessage);
  });

  it('refuse un nombre, un objet ou un tableau comme source (400)', async () => {
    await createRecipe({ sourceUrl: 42 }).expect(400);
    await createRecipe({ sourceUrl: { href: 'https://exemple.fr' } }).expect(
      400,
    );
    await createRecipe({ sourceUrl: ['https://exemple.fr'] }).expect(400);
  });
});
