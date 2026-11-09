import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // L'API tourne derrière le proxy de Render : on lui fait confiance pour
  // lire l'IP réelle du visiteur dans X-Forwarded-For (1 saut de proxy).
  app.set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.use(
    helmet({
      // CSP par défaut de Helmet bloque les scripts/styles inline utilisés
      // par la page Swagger UI (/api/docs) ; on l'assouplit uniquement sur
      // ces deux directives plutôt que de désactiver la CSP entièrement.
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3001'],
  });

  const config = new DocumentBuilder()
    .setTitle('CookthatOne API')
    .setDescription(
      'API du backend CookthatOne - gestion de recettes, calendrier de repas, stock et courses.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
