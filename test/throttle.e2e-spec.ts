import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/services/email.service';

// IP uniques par milliseconde : évite les interférences avec le TTL (60 s)
// d'une exécution précédente sur le même environnement.
const seed = Date.now();
const oct2 = (seed >> 16) & 255;
const oct3 = (seed >> 8) & 255;
const IP_A = `10.${oct2}.${oct3}.1`;
const IP_B = `10.${oct2}.${oct3}.2`;

describe('Limiteur de débit : trust proxy (e2e)', () => {
  let app: NestExpressApplication;
  let server: App;

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

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    // Même réglage qu'en production : l'IP réelle est lue dans X-Forwarded-For.
    app.set('trust proxy', 1);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('deux IP différentes ont des compteurs de tentatives indépendants', async () => {
    const payload = { email: 'nobody@test.local', password: 'wrongpassword' };

    // 5 tentatives depuis IP_A → le guard laisse passer (pas encore throttlé).
    // Le code retourné par l'auth (401 si la DB répond, 500 sinon) n'est
    // pas vérifié ici : seul le throttle nous intéresse.
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', IP_A)
        .send(payload);
      expect(res.status).not.toBe(429);
    }

    // 6e tentative depuis IP_A → throttle actif (429).
    const throttled = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', IP_A)
      .send(payload);
    expect(throttled.status).toBe(429);

    // IP_B n'a envoyé aucune tentative : son compteur est vierge,
    // le guard la laisse passer (pas 429).
    const otherIp = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', IP_B)
      .send(payload);
    expect(otherIp.status).not.toBe(429);
  }, 30000);
});
