import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StockController } from './controllers/stock.controller';
import { StockService } from './services/stock.service';

@Module({
  imports: [PrismaModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
