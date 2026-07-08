import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecipesController } from './controllers/recipes.controller';
import { RecipesService } from './services/recipes.service';

@Module({
  imports: [PrismaModule],
  controllers: [RecipesController],
  providers: [RecipesService],
})
export class RecipesModule {}
