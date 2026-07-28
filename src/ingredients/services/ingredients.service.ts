import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { CreateIngredientDto } from '../dtos/create-ingredient.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const FOREIGN_KEY_CONSTRAINT_VIOLATION = 'P2003';

@Injectable()
export class IngredientsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.ingredient.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, dto: CreateIngredientDto) {
    try {
      return await this.prisma.ingredient.create({
        data: { userId, name: dto.name, defaultUnit: dto.defaultUnit },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          'Cet ingrédient existe déjà dans ton catalogue',
        );
      }
      throw error;
    }
  }

  async remove(userId: string, id: string) {
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id },
    });
    if (!ingredient || ingredient.userId !== userId) {
      throw new NotFoundException('Ingrédient introuvable');
    }

    try {
      await this.prisma.ingredient.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          'Cet ingrédient est utilisé dans une recette ou ton stock, impossible de le supprimer',
        );
      }
      throw error;
    }
  }
}
