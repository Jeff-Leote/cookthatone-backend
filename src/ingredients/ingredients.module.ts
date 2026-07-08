import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IngredientsController } from './controllers/ingredients.controller';
import { IngredientsService } from './services/ingredients.service';

@Module({
  imports: [PrismaModule],
  controllers: [IngredientsController],
  providers: [IngredientsService],
})
export class IngredientsModule {}
