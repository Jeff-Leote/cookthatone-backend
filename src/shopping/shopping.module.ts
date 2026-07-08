import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShoppingController } from './controllers/shopping.controller';
import { ShoppingService } from './services/shopping.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShoppingController],
  providers: [ShoppingService],
})
export class ShoppingModule {}
