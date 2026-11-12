import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHash, randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/services/prisma.service';
import { EmailService } from '../src/email/services/email.service';

function body<T>(res: request.Response): T {
  return res.body as T;
}

interface LoginResponse {
  access_token: string;
  refresh_token: string;
}
interface MessageResponse {
  message: string;
}

describe('Flux refresh token (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let server: App;
  let userId: string;

  const uniqueSuffix = Date.now().toString().slice(-8);
  const user = {
    email: `e2e-refresh-${uniqueSuffix}@test.local`,
    pseudo: `e2erefresh${uniqueSuffix}`,
    password: 'motdepasse123',
  };

  // Capture les emails envoyés sans appel réseau réel.
  const emailCapture: {
    sendPasswordResetEmail: jest.Mock;
    sendVerificationEmail: jest.Mock;
    sendInsufficientStockEmail: jest.Mock;
  } = {
    sendPasswordResetEmail: jest.fn(),
    sendVerificationEmail: jest.fn(),
    sendInsufficientStockEmail: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue(emailCapture)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    // Inscription puis vérification manuelle en base (évite la dépendance réseau Brevo).
    await request(server).post('/auth/register').send(user).expect(201);
    const dbUser = await prisma.user.update({
      where: { email: user.email },
      data: { emailVerified: true },
    });
    userId = dbUser.id;
  });

  afterAll(async () => {
    // Suppression de l'utilisateur de test (cascade supprime ses refresh tokens).
    await prisma.user.deleteMany({ where: { email: user.email } });
    await app.close();
  });

  // Nettoyage des refresh tokens de l'utilisateur de test.
  async function cleanRefreshTokens(): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  // Crée un refresh token directement en base sans passer par l'API login.
  // Évite de consommer le quota BRUTE_FORCE_THROTTLE (5 login/min/IP).
  async function insertRefreshToken(): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { tokenHash, userId, expiresAt },
    });
    return rawToken;
  }

  // -------------------------------------------------------------------
  // POST /auth/login
  // -------------------------------------------------------------------
  describe('POST /auth/login', () => {
    afterEach(async () => {
      await cleanRefreshTokens();
    });

    it('retourne access_token et refresh_token à la connexion', async () => {
      const res = await request(server)
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const parsed = body<LoginResponse>(res);
      expect(typeof parsed.access_token).toBe('string');
      expect(parsed.access_token.length).toBeGreaterThan(0);
      expect(typeof parsed.refresh_token).toBe('string');
      // randomBytes(32).toString('hex') produit 64 caractères
      expect(parsed.refresh_token).toHaveLength(64);
    });
  });

  // -------------------------------------------------------------------
  // POST /auth/refresh
  // -------------------------------------------------------------------
  describe('POST /auth/refresh', () => {
    afterEach(async () => {
      await cleanRefreshTokens();
    });

    it('renvoie un nouveau access_token et refresh_token (rotation)', async () => {
      const rawToken = await insertRefreshToken();

      const res = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: rawToken })
        .expect(200);

      const parsed = body<LoginResponse>(res);
      expect(typeof parsed.access_token).toBe('string');
      expect(typeof parsed.refresh_token).toBe('string');
      expect(parsed.refresh_token).toHaveLength(64);
      // Le nouveau refresh_token est différent de l'ancien
      expect(parsed.refresh_token).not.toBe(rawToken);
    });

    it("rejette l'ancien refresh_token après rotation (401)", async () => {
      const rawToken = await insertRefreshToken();

      // 1er appel : rotation — consomme le token d'origine
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: rawToken })
        .expect(200);

      // 2e appel avec l'ancien token : doit être refusé (rotation)
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: rawToken })
        .expect(401);
    });

    it('rejette un refresh_token invalide (401)', async () => {
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: 'a'.repeat(64) })
        .expect(401);
    });

    it('rejette un body sans refreshToken (400)', async () => {
      await request(server).post('/auth/refresh').send({}).expect(400);
    });
  });

  // -------------------------------------------------------------------
  // POST /auth/logout
  // -------------------------------------------------------------------
  describe('POST /auth/logout', () => {
    afterEach(async () => {
      await cleanRefreshTokens();
    });

    it('déconnecte et renvoie un message de confirmation', async () => {
      const rawToken = await insertRefreshToken();

      const res = await request(server)
        .post('/auth/logout')
        .send({ refreshToken: rawToken })
        .expect(200);

      const parsed = body<MessageResponse>(res);
      expect(parsed.message).toBe('Déconnecté.');
    });

    it('révoque bien le token en base après logout', async () => {
      const rawToken = await insertRefreshToken();
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      // Vérifier que le token existe avant logout
      const before = await prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      expect(before).not.toBeNull();

      // Logout
      await request(server)
        .post('/auth/logout')
        .send({ refreshToken: rawToken })
        .expect(200);

      // Vérifier que le token a bien été supprimé en base
      const after = await prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      expect(after).toBeNull();
    });

    it("logout idempotent : token déjà révoqué ne lève pas d'erreur", async () => {
      const rawToken = await insertRefreshToken();

      // Premier logout
      await request(server)
        .post('/auth/logout')
        .send({ refreshToken: rawToken })
        .expect(200);

      // Deuxième logout sur le même token : deleteMany(count=0), pas d'erreur
      await request(server)
        .post('/auth/logout')
        .send({ refreshToken: rawToken })
        .expect(200);
    });
  });
});
