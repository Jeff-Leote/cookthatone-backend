import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { CreateStockDto } from '../dtos/create-stock.dto';
import { UpdateStockDto } from '../dtos/update-stock.dto';
import { FindStockQueryDto } from '../dtos/find-stock-query.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const EXPIRING_SOON_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string, query: FindStockQueryDto) {
    return this.prisma.stock.findMany({
      where: {
        userId,
        ...(query.expiringSoon
          ? {
              expiresAt: {
                not: null,
                lte: new Date(
                  Date.now() + EXPIRING_SOON_WINDOW_DAYS * MS_PER_DAY,
                ),
              },
            }
          : {}),
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async create(userId: string, dto: CreateStockDto) {
    try {
      return await this.prisma.stock.create({
        data: {
          userId,
          ingredientId: dto.ingredientId,
          quantity: dto.quantity,
          unit: dto.unit,
          expiresAt: dto.expiresAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('This ingredient is already in stock');
      }
      throw error;
    }
  }

  async update(userId: string, id: string, dto: UpdateStockDto) {
    await this.ensureOwnedStock(userId, id);
    return this.prisma.stock.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnedStock(userId, id);
    await this.prisma.stock.delete({ where: { id } });
  }

  private async ensureOwnedStock(userId: string, id: string) {
    const stock = await this.prisma.stock.findUnique({ where: { id } });
    if (!stock) {
      throw new NotFoundException('Stock entry not found');
    }
    if (stock.userId !== userId) {
      throw new ForbiddenException();
    }
    return stock;
  }
}
