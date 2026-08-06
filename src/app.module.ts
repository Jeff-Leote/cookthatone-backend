import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RecipesModule } from './recipes/recipes.module';
import { IngredientsModule } from './ingredients/ingredients.module';
import { CalendarModule } from './calendar/calendar.module';
import { StockModule } from './stock/stock.module';
import { ShoppingModule } from './shopping/shopping.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Limite globale par IP contre les abus généraux ; /auth/login et
    // /auth/register appliquent une limite plus stricte dédiée au
    // brute-force (voir @Throttle() sur AuthController).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 30 }]),
    PrismaModule,
    AuthModule,
    RecipesModule,
    IngredientsModule,
    CalendarModule,
    StockModule,
    ShoppingModule,
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
