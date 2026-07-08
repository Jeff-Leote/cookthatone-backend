import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/services/prisma.service';
import { GenerateShoppingListDto } from '../dtos/generate-shopping-list.dto';
import { UpdateShoppingItemDto } from '../dtos/update-shopping-item.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_LENGTH_DAYS = 6;

@Injectable()
export class ShoppingService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.shoppingList.findMany({
      where: { userId },
      orderBy: { weekStart: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const list = await this.prisma.shoppingList.findUnique({
      where: { id },
      include: { items: { include: { ingredient: true } } },
    });
    if (!list) {
      throw new NotFoundException('Shopping list not found');
    }
    if (list.userId !== userId) {
      throw new ForbiddenException();
    }
    return list;
  }

  async generate(userId: string, dto: GenerateShoppingListDto) {
    const weekStart = dto.weekStart;
    const weekEnd = new Date(
      weekStart.getTime() + WEEK_LENGTH_DAYS * MS_PER_DAY,
    );

    const entries = await this.prisma.calendarEntry.findMany({
      where: { userId, plannedDate: { gte: weekStart, lte: weekEnd } },
      include: { recipe: { include: { recipeIngredients: true } } },
    });

    const neededByIngredient = new Map<string, number>();
    for (const entry of entries) {
      for (const recipeIngredient of entry.recipe.recipeIngredients) {
        neededByIngredient.set(
          recipeIngredient.ingredientId,
          (neededByIngredient.get(recipeIngredient.ingredientId) ?? 0) +
            recipeIngredient.quantity,
        );
      }
    }

    const ingredientIds = [...neededByIngredient.keys()];

    const [stockEntries, ingredients] = await Promise.all([
      this.prisma.stock.findMany({
        where: { userId, ingredientId: { in: ingredientIds } },
      }),
      this.prisma.ingredient.findMany({
        where: { id: { in: ingredientIds } },
      }),
    ]);
    const stockByIngredient = new Map(
      stockEntries.map((stock) => [stock.ingredientId, stock.quantity]),
    );
    const unitByIngredient = new Map(
      ingredients.map((ingredient) => [ingredient.id, ingredient.defaultUnit]),
    );

    const items = [...neededByIngredient.entries()]
      .map(([ingredientId, quantityNeeded]) => ({
        ingredientId,
        quantityNeeded,
        quantityInStock: stockByIngredient.get(ingredientId) ?? 0,
        unit: unitByIngredient.get(ingredientId)!,
      }))
      .filter((item) => item.quantityInStock < item.quantityNeeded);

    return this.prisma.shoppingList.create({
      data: {
        userId,
        weekStart,
        items: items.length ? { create: items } : undefined,
      },
      include: { items: { include: { ingredient: true } } },
    });
  }

  async updateItemChecked(
    userId: string,
    listId: string,
    itemId: string,
    dto: UpdateShoppingItemDto,
  ) {
    await this.ensureOwnedList(userId, listId);

    const item = await this.prisma.shoppingItem.findUnique({
      where: { id: itemId },
    });
    if (!item || item.listId !== listId) {
      throw new NotFoundException('Shopping item not found');
    }

    return this.prisma.shoppingItem.update({
      where: { id: itemId },
      data: { checked: dto.checked },
    });
  }

  async validate(userId: string, id: string) {
    const list = await this.ensureOwnedList(userId, id);
    if (list.validated) {
      throw new ConflictException('Shopping list already validated');
    }

    const items = await this.prisma.shoppingItem.findMany({
      where: { listId: id, checked: true },
    });

    await this.prisma.$transaction([
      ...items.map((item) => {
        const purchasedQuantity = Math.max(
          0,
          item.quantityNeeded - item.quantityInStock,
        );
        return this.prisma.stock.upsert({
          where: {
            userId_ingredientId: { userId, ingredientId: item.ingredientId },
          },
          create: {
            userId,
            ingredientId: item.ingredientId,
            quantity: purchasedQuantity,
            unit: item.unit,
          },
          update: { quantity: { increment: purchasedQuantity } },
        });
      }),
      this.prisma.shoppingList.update({
        where: { id },
        data: { validated: true },
      }),
    ]);

    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnedList(userId, id);
    await this.prisma.shoppingList.delete({ where: { id } });
  }

  private async ensureOwnedList(userId: string, id: string) {
    const list = await this.prisma.shoppingList.findUnique({ where: { id } });
    if (!list) {
      throw new NotFoundException('Shopping list not found');
    }
    if (list.userId !== userId) {
      throw new ForbiddenException();
    }
    return list;
  }
}
