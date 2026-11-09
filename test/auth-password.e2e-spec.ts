import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/services/prisma.service';
import { EmailService } from '../src/email/services/email.service';
import { JwtService } from '@nestjs/jwt';

function body<T>(res: request.Response): T {
  return res.body as T;
}

interface AuthResponse {
  access_token: string;
}
interface MessageResponse {
  message: string;
}

describe('Flux mot de passe (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let server: App;

  const uniqueSuffix = Date.now().toString().slice(-8);
  const user = {
    email: `e2e-pwd-${uniqueSuffix}@test.local`,
    pseudo: `e2epwd${uniqueSuffix}`,
    password: 'motdepasse123',
  };

  let token: string;

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
    jwtService = app.get(JwtService);

    // Inscription puis vérification manuelle en base (évite la dépendance réseau Brevo).
    await request(server).post('/auth/register').send(user).expect(201);
    await prisma.user.update({
      where: { email: user.email },
      data: { emailVerified: true },
    });

    const res = await request(server).post('/auth/login').send(user);
    token = body<AuthResponse>(res).access_token;
  });

  afterAll(async () => {
    // Nettoyage minimal : suppression de l'utilisateur de test.
    await prisma.user.deleteMany({ where: { email: user.email } });
    await app.close();
  });

  // -------------------------------------------------------------------
  // forgot-password
  // -------------------------------------------------------------------
  describe('POST /auth/forgot-password', () => {
    it('renvoie un message générique pour un email connu', async () => {
      const res = await request(server)
        .post('/auth/forgot-password')
        .send({ email: user.email })
        .expect(200);
      const parsed = body<MessageResponse>(res);
      expect(parsed.message).toContain('Si cette adresse');
      expect(emailCapture.sendPasswordResetEmail).toHaveBeenCalledWith(
        user.email,
        user.pseudo,
        expect.stringContaining('/reset-password?token='),
      );
    });

    it('renvoie le même message générique pour un email inconnu', async () => {
      emailCapture.sendPasswordResetEmail.mockClear();

      const res = await request(server)
        .post('/auth/forgot-password')
        .send({ email: 'inconnu@test.local' })
        .expect(200);
      const parsed = body<MessageResponse>(res);
      expect(parsed.message).toContain('Si cette adresse');
      expect(emailCapture.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // reset-password
  // -------------------------------------------------------------------
  describe('POST /auth/reset-password', () => {
    // Extrait le token JWT depuis l'URL de reset envoyée par le service email.
    async function obtainResetToken(): Promise<string> {
      emailCapture.sendPasswordResetEmail.mockClear();
      await request(server)
        .post('/auth/forgot-password')
        .send({ email: user.email })
        .expect(200);
      const [, , resetUrl] = emailCapture.sendPasswordResetEmail.mock
        .calls[0] as [string, string, string];
      const tok = new URL(resetUrl).searchParams.get('token');
      if (!tok) throw new Error('token absent de resetUrl');
      return tok;
    }

    it('réinitialise le mot de passe avec un token valide puis permet la connexion', async () => {
      const resetToken = await obtainResetToken();

      const res = await request(server)
        .post('/auth/reset-password')
        .send({ token: resetToken, newPassword: 'nouveaumotdepasse123' })
        .expect(200);
      expect(body<MessageResponse>(res).message).toContain('réinitialisé');

      // Le nouveau mot de passe permet de se connecter.
      const loginRes = await request(server)
        .post('/auth/login')
        .send({ email: user.email, password: 'nouveaumotdepasse123' });
      expect(loginRes.status).toBe(200);
      expect(body<AuthResponse>(loginRes).access_token).toBeDefined();

      // Restaure le mot de passe original via Prisma pour préserver le quota
      // EMAIL_SPAM (3 req/15 min) et ne pas bloquer les tests suivants.
      await prisma.user.update({
        where: { email: user.email },
        data: {
          passwordHash: await bcrypt.hash(user.password, 10),
          passwordResetToken: null,
          passwordResetExpiry: null,
        },
      });
    });

    it('rejette un token invalide (401)', async () => {
      await request(server)
        .post('/auth/reset-password')
        .send({
          token: 'ceci-nest-pas-un-token',
          newPassword: 'nouveaumotdepasse123',
        })
        .expect(401);
    });

    it('rejette un token avec le mauvais purpose (401)', async () => {
      const dbUser = await prisma.user.findUnique({
        where: { email: user.email },
      });
      // Token de vérification d'email détourné pour le reset : interdit.
      // On le forge manuellement car forgot-password ne produit jamais ce purpose.
      const wrongToken = jwtService.sign(
        { sub: dbUser!.id, purpose: 'email-verification' },
        { expiresIn: '1h' },
      );

      await request(server)
        .post('/auth/reset-password')
        .send({ token: wrongToken, newPassword: 'nouveaumotdepasse123' })
        .expect(401);
    });

    it('rejette un body sans token (400)', async () => {
      await request(server)
        .post('/auth/reset-password')
        .send({ newPassword: 'nouveaumotdepasse123' })
        .expect(400);
    });

    it('rejette un nouveau mot de passe trop court (400)', async () => {
      // La validation DTO (longueur minimale) se déclenche avant la vérification
      // du token en base : un token forgé suffit pour ce cas.
      const dbUser = await prisma.user.findUnique({
        where: { email: user.email },
      });
      const shortTestToken = jwtService.sign(
        { sub: dbUser!.id, purpose: 'password-reset' },
        { expiresIn: '1h' },
      );

      await request(server)
        .post('/auth/reset-password')
        .send({ token: shortTestToken, newPassword: 'court' })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------
  // resend-verification
  // -------------------------------------------------------------------
  describe('POST /auth/resend-verification', () => {
    it('renvoie un message générique pour un email connu non vérifié', async () => {
      // Crée un second utilisateur non vérifié pour ce test.
      const unverifiedEmail = `e2e-unv-${uniqueSuffix}@test.local`;
      await request(server)
        .post('/auth/register')
        .send({
          email: unverifiedEmail,
          pseudo: `e2eunv${uniqueSuffix}`,
          password: 'motdepasse123',
        })
        .expect(201);
      emailCapture.sendVerificationEmail.mockClear();

      const res = await request(server)
        .post('/auth/resend-verification')
        .send({ email: unverifiedEmail })
        .expect(200);
      expect(body<MessageResponse>(res).message).toContain('Si cette adresse');
      expect(emailCapture.sendVerificationEmail).toHaveBeenCalled();

      // Nettoyage.
      await prisma.user.deleteMany({ where: { email: unverifiedEmail } });
    });

    it('renvoie le même message générique pour un email inconnu', async () => {
      emailCapture.sendVerificationEmail.mockClear();

      const res = await request(server)
        .post('/auth/resend-verification')
        .send({ email: 'inconnu-resend@test.local' })
        .expect(200);
      expect(body<MessageResponse>(res).message).toContain('Si cette adresse');
      expect(emailCapture.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // change-password
  // -------------------------------------------------------------------
  describe('PATCH /auth/change-password', () => {
    it('refuse sans jeton (401)', async () => {
      await request(server)
        .patch('/auth/change-password')
        .send({
          currentPassword: user.password,
          newPassword: 'nouveaumotdepasse123',
        })
        .expect(401);
    });

    it('refuse si le mot de passe actuel est incorrect (401)', async () => {
      await request(server)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'mauvais-mdp',
          newPassword: 'nouveaumotdepasse123',
        })
        .expect(401);
    });

    it('rejette un nouveau mot de passe trop court (400)', async () => {
      await request(server)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: user.password, newPassword: 'court' })
        .expect(400);
    });

    it('change le mot de passe avec le bon mot de passe actuel', async () => {
      const newPassword = 'nouveaumotdepasse123';

      const res = await request(server)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: user.password, newPassword })
        .expect(200);
      expect(body<MessageResponse>(res).message).toContain('modifié');

      // Le nouveau mot de passe permet de se connecter.
      const loginRes = await request(server)
        .post('/auth/login')
        .send({ email: user.email, password: newPassword });
      expect(loginRes.status).toBe(200);

      // Restaure le mot de passe original.
      await request(server)
        .patch('/auth/change-password')
        .set(
          'Authorization',
          `Bearer ${body<AuthResponse>(loginRes).access_token}`,
        )
        .send({ currentPassword: newPassword, newPassword: user.password })
        .expect(200);
    });
  });
});
