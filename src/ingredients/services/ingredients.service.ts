import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import {
  areUnitsCompatible,
  convertQuantity,
  isMassVolumePair,
  unitLabel,
} from '../../common/units';
import { CreateIngredientDto } from '../dtos/create-ingredient.dto';
import { UpdateIngredientDto } from '../dtos/update-ingredient.dto';

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
        data: {
          userId,
          name: dto.name,
          defaultUnit: dto.defaultUnit,
          gramsPerTablespoon: dto.gramsPerTablespoon,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('Cet ingrédient existe déjà');
      }
      throw error;
    }
  }

  // L'unité d'un ingrédient est modifiable. Dans la même famille (g et kg),
  // le stock est converti. D'une famille à l'autre (g et ml), il faut
  // l'équivalence de l'ingrédient (poids d'une cuillère à soupe) ; sans elle,
  // le changement est refusé tant que l'ingrédient est utilisé, plutôt que
  // d'inventer une équivalence.
  async update(userId: string, id: string, dto: UpdateIngredientDto) {
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id },
    });
    if (!ingredient || ingredient.userId !== userId) {
      throw new NotFoundException('Ingrédient introuvable');
    }

    const newUnit = dto.defaultUnit ?? ingredient.defaultUnit;
    const newEquivalence =
      dto.gramsPerTablespoon ?? ingredient.gramsPerTablespoon;
    const unitChanges = newUnit !== ingredient.defaultUnit;
    const equivalenceChanges = newEquivalence !== ingredient.gramsPerTablespoon;
    if (!unitChanges && !equivalenceChanges) {
      return ingredient;
    }
    if (!unitChanges) {
      return this.prisma.ingredient.update({
        where: { id },
        data: { gramsPerTablespoon: newEquivalence },
      });
    }

    if (!areUnitsCompatible(ingredient.defaultUnit, newUnit, newEquivalence)) {
      // Seules les utilisations qui deviendraient incohérentes bloquent : une
      // ligne déjà dans une unité compatible avec la nouvelle unité ne pose
      // aucun problème.
      const incompatible = (unit: Unit) =>
        !areUnitsCompatible(unit, newUnit, newEquivalence);
      const [recipeLines, stockRows, validatedItems] = await Promise.all([
        this.prisma.recipeIngredient.findMany({
          where: { ingredientId: id },
          select: { unit: true, recipe: { select: { title: true } } },
        }),
        this.prisma.stock.findMany({
          where: { ingredientId: id },
          select: { unit: true },
        }),
        this.prisma.shoppingItem.findMany({
          where: { ingredientId: id, list: { validated: true } },
          select: { unit: true },
        }),
      ]);
      const blockingLines = recipeLines.filter((line) =>
        incompatible(line.unit),
      );
      const blockingStock = stockRows.filter((row) => incompatible(row.unit));
      const blockingItems = validatedItems.filter((item) =>
        incompatible(item.unit),
      );
      if (
        blockingLines.length + blockingStock.length + blockingItems.length >
        0
      ) {
        const titles = [
          ...new Set(blockingLines.map((line) => `« ${line.recipe.title} »`)),
        ]
          .slice(0, 3)
          .join(', ');
        const usage = [
          blockingLines.length > 0
            ? `${blockingLines.length} ligne(s) de recette ${titles}`
            : null,
          blockingStock.length > 0 ? 'le stock' : null,
          blockingItems.length > 0 ? 'des listes de courses validées' : null,
        ]
          .filter(Boolean)
          .join(', ');
        const tip = isMassVolumePair(ingredient.defaultUnit, newUnit)
          ? " Renseigne d'abord l'équivalence de l'ingrédient (poids d'une cuillère à soupe)."
          : " Corrige d'abord ces lignes (change leur unité dans la recette ou dans le stock).";
        throw new ConflictException(
          `Impossible de passer « ${ingredient.name} » de ${unitLabel(ingredient.defaultUnit)} à ${unitLabel(newUnit)} : il est utilisé (${usage}) dans une unité sans équivalent.${tip}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const stocks = await tx.stock.findMany({ where: { ingredientId: id } });
      for (const stock of stocks) {
        const converted = convertQuantity(
          stock.quantity,
          stock.unit,
          newUnit,
          newEquivalence,
        );
        if (converted === null) {
          throw new ConflictException(
            `Le stock de « ${ingredient.name} » est en ${unitLabel(stock.unit)}, sans équivalent en ${unitLabel(newUnit)} : corrige-le d'abord`,
          );
        }
        if (converted > 0) {
          await tx.stock.update({
            where: { id: stock.id },
            data: { quantity: converted, unit: newUnit },
          });
        } else {
          await tx.stock.delete({ where: { id: stock.id } });
        }
      }
      return tx.ingredient.update({
        where: { id },
        data: { defaultUnit: newUnit, gramsPerTablespoon: newEquivalence },
      });
    });
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
          'Cet ingrédient est utilisé dans une recette ou dans le stock',
        );
      }
      throw error;
    }
  }
}
