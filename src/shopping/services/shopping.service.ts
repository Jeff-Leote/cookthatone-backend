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

    const existing = await this.prisma.shoppingList.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    });
    if (existing?.validated) {
      throw new ConflictException(
        'Cette liste de courses est déjà validée, dévalidez-la avant de la régénérer',
      );
    }

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

    if (existing) {
      // Une liste (non validee) existe deja pour cette semaine : on la
      // remplace plutot que d'en creer une seconde, pour respecter la
      // contrainte d'unicite (une liste par semaine par utilisateur).
      return this.prisma.$transaction(async (tx) => {
        await tx.shoppingItem.deleteMany({ where: { listId: existing.id } });
        return tx.shoppingList.update({
          where: { id: existing.id },
          data: { items: items.length ? { create: items } : undefined },
          include: { items: { include: { ingredient: true } } },
        });
      });
    }

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
    await this.ensureOwnedList(userId, id);

    await this.prisma.$transaction(async (tx) => {
      // Atomically claim the list: only one concurrent validate() call can
      // flip validated false -> true, since Postgres serializes concurrent
      // UPDATEs on the same row. A losing call sees count 0 and knows
      // another request already validated it, before any stock is touched.
      const claimed = await tx.shoppingList.updateMany({
        where: { id, validated: false },
        data: { validated: true },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Shopping list already validated');
      }

      const items = await tx.shoppingItem.findMany({
        where: { listId: id, checked: true },
      });

      for (const item of items) {
        const purchasedQuantity = Math.max(
          0,
          item.quantityNeeded - item.quantityInStock,
        );
        await tx.stock.upsert({
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
        // On enregistre la quantite exacte ajoutee au stock, pour pouvoir
        // l'annuler precisement si la liste est devalidee plus tard (le
        // stock peut avoir change depuis, ex: consommation via le calendrier).
        await tx.shoppingItem.update({
          where: { id: item.id },
          data: { purchasedQuantity },
        });
      }
    });

    return this.findOne(userId, id);
  }

  async unvalidate(userId: string, id: string) {
    await this.ensureOwnedList(userId, id);

    await this.prisma.$transaction(async (tx) => {
      // Meme principe de claim atomique que validate(), en sens inverse.
      const claimed = await tx.shoppingList.updateMany({
        where: { id, validated: true },
        data: { validated: false },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Shopping list is not validated');
      }

      const items = await tx.shoppingItem.findMany({
        where: { listId: id, purchasedQuantity: { gt: 0 } },
      });

      for (const item of items) {
        const stock = await tx.stock.findUnique({
          where: {
            userId_ingredientId: { userId, ingredientId: item.ingredientId },
          },
        });
        if (stock) {
          await tx.stock.update({
            where: { id: stock.id },
            data: {
              quantity: Math.max(0, stock.quantity - item.purchasedQuantity),
            },
          });
        }
        await tx.shoppingItem.update({
          where: { id: item.id },
          data: { purchasedQuantity: 0 },
        });
      }
    });

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
