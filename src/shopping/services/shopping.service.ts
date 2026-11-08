import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { ACCESS_DENIED_MESSAGE } from '../../common/messages';
import {
  convertQuantity,
  isMassVolumePair,
  roundQuantity,
  unitLabel,
} from '../../common/units';
import { GenerateShoppingListDto } from '../dtos/generate-shopping-list.dto';
import { UpdateShoppingItemDto } from '../dtos/update-shopping-item.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Le nom de la contrainte d'exclusion GiST posee en migration (voir
// prisma/migrations/*_shopping_list_date_range) : filet de sécurité si deux
// requêtes concurrentes passent toutes les deux le pre-check applicatif.
const NO_OVERLAP_CONSTRAINT = 'shopping_lists_no_overlap';

function formatDateFr(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class ShoppingService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.shoppingList.findMany({
      where: { userId },
      orderBy: { periodStart: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const list = await this.prisma.shoppingList.findUnique({
      where: { id },
      include: { items: { include: { ingredient: true } } },
    });
    if (!list) {
      throw new NotFoundException('Liste de courses introuvable');
    }
    if (list.userId !== userId) {
      throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
    }
    return list;
  }

  async generate(userId: string, dto: GenerateShoppingListDto) {
    const { periodStart, periodEnd } = dto;
    if (periodEnd < periodStart) {
      throw new BadRequestException(
        'La date de fin doit être postérieure ou égale à la date de début',
      );
    }

    const entries = await this.prisma.calendarEntry.findMany({
      where: { userId, plannedDate: { gte: periodStart, lte: periodEnd } },
      include: { recipe: { include: { recipeIngredients: true } } },
    });

    // Chaque jour de la plage doit avoir au moins un repas programmé : une
    // liste de courses n'a pas de sens pour un jour sans recette planifiée.
    const plannedDays = new Set(
      entries.map((entry) => toIsoDate(entry.plannedDate)),
    );
    const dayCount =
      Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY) +
      1;
    for (let i = 0; i < dayCount; i++) {
      const day = new Date(periodStart.getTime() + i * MS_PER_DAY);
      if (!plannedDays.has(toIsoDate(day))) {
        throw new BadRequestException(
          `Le ${formatDateFr(day)} n'a pas de recette programmée`,
        );
      }
    }

    // Réutilise la liste existante si la plage est exactement identique
    // (régénération), sinon vérifie qu'aucune autre liste du même
    // utilisateur ne couvre déjà un jour de cette plage.
    const existing = await this.prisma.shoppingList.findFirst({
      where: { userId, periodStart, periodEnd },
    });
    if (existing?.validated) {
      throw new ConflictException(
        'Cette liste de courses est déjà validée, dévalidez-la avant de la régénérer',
      );
    }

    const overlapping = await this.prisma.shoppingList.findFirst({
      where: {
        userId,
        ...(existing ? { id: { not: existing.id } } : {}),
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        `Cette période chevauche une liste de courses existante (${formatDateFr(overlapping.periodStart)} au ${formatDateFr(overlapping.periodEnd)})`,
      );
    }

    const ingredientIds = [
      ...new Set(
        entries.flatMap((entry) =>
          entry.recipe.recipeIngredients.map((line) => line.ingredientId),
        ),
      ),
    ];

    const [stockEntries, ingredients] = await Promise.all([
      this.prisma.stock.findMany({
        where: { userId, ingredientId: { in: ingredientIds } },
      }),
      this.prisma.ingredient.findMany({
        where: { id: { in: ingredientIds } },
      }),
    ]);
    const unitByIngredient = new Map(
      ingredients.map((ingredient) => [ingredient.id, ingredient.defaultUnit]),
    );
    const nameByIngredient = new Map(
      ingredients.map((ingredient) => [ingredient.id, ingredient.name]),
    );
    const equivalenceByIngredient = new Map(
      ingredients.map((ingredient) => [
        ingredient.id,
        ingredient.gramsPerTablespoon,
      ]),
    );
    const hint = (a: Unit, b: Unit) =>
      isMassVolumePair(a, b)
        ? " (renseigne l'équivalence de l'ingrédient dans le catalogue)"
        : '';

    // L'unité de l'ingrédient est la référence : besoins et stock y sont
    // convertis avant d'être comparés. Deux unités sans équivalent (grammes
    // et cuillères) ne sont jamais additionnées : on le signale.
    const conflicts: string[] = [];

    const neededByIngredient = new Map<string, number>();
    for (const entry of entries) {
      // Les quantités de la recette sont définies pour son nombre de
      // portions de base ; on les met à l'échelle du nombre de portions
      // choisi pour ce repas précis.
      const ratio = entry.servings / entry.recipe.servings;
      for (const line of entry.recipe.recipeIngredients) {
        const referenceUnit = unitByIngredient.get(line.ingredientId)!;
        const converted = convertQuantity(
          line.quantity * ratio,
          line.unit,
          referenceUnit,
          equivalenceByIngredient.get(line.ingredientId),
        );
        if (converted === null) {
          conflicts.push(
            `« ${nameByIngredient.get(line.ingredientId)} » est en ${unitLabel(line.unit)} dans « ${entry.recipe.title} » alors que son unité est ${unitLabel(referenceUnit)}${hint(line.unit, referenceUnit)}`,
          );
          continue;
        }
        neededByIngredient.set(
          line.ingredientId,
          (neededByIngredient.get(line.ingredientId) ?? 0) + converted,
        );
      }
    }

    const stockByIngredient = new Map<string, number>();
    for (const stock of stockEntries) {
      const referenceUnit = unitByIngredient.get(stock.ingredientId)!;
      const converted = convertQuantity(
        stock.quantity,
        stock.unit,
        referenceUnit,
        equivalenceByIngredient.get(stock.ingredientId),
      );
      if (converted === null) {
        conflicts.push(
          `le stock de « ${nameByIngredient.get(stock.ingredientId)} » est en ${unitLabel(stock.unit)} alors que son unité est ${unitLabel(referenceUnit)}${hint(stock.unit, referenceUnit)}`,
        );
        continue;
      }
      stockByIngredient.set(stock.ingredientId, converted);
    }

    if (conflicts.length > 0) {
      const shown = [...new Set(conflicts)].slice(0, 3).join(' ; ');
      throw new BadRequestException(
        `Unités incompatibles : ${shown}. Corrige-les avant de générer la liste.`,
      );
    }

    const items = [...neededByIngredient.entries()]
      .map(([ingredientId, quantityNeeded]) => ({
        ingredientId,
        quantityNeeded: roundQuantity(quantityNeeded),
        quantityInStock: stockByIngredient.get(ingredientId) ?? 0,
        unit: unitByIngredient.get(ingredientId)!,
      }))
      .filter((item) => item.quantityInStock < item.quantityNeeded);

    if (existing) {
      // Une liste (non validée) existe déjà pour exactement cette plage : on
      // la remplace plutôt que d'en creer une seconde.
      return this.prisma.$transaction(async (tx) => {
        await tx.shoppingItem.deleteMany({ where: { listId: existing.id } });
        return tx.shoppingList.update({
          where: { id: existing.id },
          data: { items: items.length ? { create: items } : undefined },
          include: { items: { include: { ingredient: true } } },
        });
      });
    }

    try {
      return await this.prisma.shoppingList.create({
        data: {
          userId,
          periodStart,
          periodEnd,
          items: items.length ? { create: items } : undefined,
        },
        include: { items: { include: { ingredient: true } } },
      });
    } catch (error) {
      // Filet de sécurité : deux requêtes concurrentes ont pu passer toutes
      // les deux le pre-check de chevauchement ci-dessus avant qu'aucune
      // n'ait écrit ; la contrainte d'exclusion GiST bloque la seconde au
      // niveau base, on la traduit juste en message clair.
      if (
        error instanceof Error &&
        error.message.includes(NO_OVERLAP_CONSTRAINT)
      ) {
        throw new ConflictException(
          'Cette période chevauche une liste de courses existante',
        );
      }
      throw error;
    }
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
      throw new NotFoundException(
        'Article introuvable dans la liste de courses',
      );
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
        throw new ConflictException('Cette liste de courses est déjà validée');
      }

      const items = await tx.shoppingItem.findMany({
        where: { listId: id, checked: true },
      });
      const equivalences = await this.equivalencesOf(tx, items);

      for (const item of items) {
        const purchasedQuantity = Math.max(
          0,
          item.quantityNeeded - item.quantityInStock,
        );
        await this.addToStock(
          tx,
          userId,
          item.ingredientId,
          purchasedQuantity,
          item.unit,
          equivalences.get(item.ingredientId),
        );
        // On enregistre la quantité exacte ajoutée au stock, pour pouvoir
        // l'annuler précisément si la liste est dévalidée plus tard (le
        // stock peut avoir changé depuis, ex: consommation via le calendrier).
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
      // Même principe de claim atomique que validate(), en sens inverse.
      const claimed = await tx.shoppingList.updateMany({
        where: { id, validated: true },
        data: { validated: false },
      });
      if (claimed.count === 0) {
        throw new ConflictException("Cette liste de courses n'est pas validée");
      }

      const items = await tx.shoppingItem.findMany({
        where: { listId: id, purchasedQuantity: { gt: 0 } },
      });
      const equivalences = await this.equivalencesOf(tx, items);

      for (const item of items) {
        const stock = await tx.stock.findUnique({
          where: {
            userId_ingredientId: { userId, ingredientId: item.ingredientId },
          },
        });
        if (stock) {
          const current = convertQuantity(
            stock.quantity,
            stock.unit,
            item.unit,
            equivalences.get(item.ingredientId),
          );
          if (current === null) {
            throw new ConflictException(
              `Le stock de cet ingrédient est en ${unitLabel(stock.unit)}, incompatible avec ${unitLabel(item.unit)} : corrige-le avant de dévalider la liste`,
            );
          }
          const remaining = roundQuantity(current - item.purchasedQuantity);
          if (remaining > 0) {
            await tx.stock.update({
              where: { id: stock.id },
              data: { quantity: remaining, unit: item.unit },
            });
          } else {
            await tx.stock.delete({ where: { id: stock.id } });
          }
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

  // Équivalence poids/volume des ingrédients d'une liste (une seule requête).
  private async equivalencesOf(
    tx: Prisma.TransactionClient,
    items: { ingredientId: string }[],
  ) {
    const ingredients = await tx.ingredient.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.ingredientId))] } },
    });
    return new Map(
      ingredients.map((ingredient) => [
        ingredient.id,
        ingredient.gramsPerTablespoon,
      ]),
    );
  }

  // Même unité que la ligne de stock : incrément atomique (deux validations
  // simultanées ne s'écrasent pas). Unité différente (donnée ancienne) : la
  // ligne est convertie puis normalisée dans l'unité de l'ingrédient.
  private async addToStock(
    tx: Prisma.TransactionClient,
    userId: string,
    ingredientId: string,
    quantity: number,
    unit: Unit,
    gramsPerTablespoon?: number | null,
  ) {
    const where = { userId_ingredientId: { userId, ingredientId } };
    const existing = await tx.stock.findUnique({ where });
    if (!existing || existing.unit === unit) {
      await tx.stock.upsert({
        where,
        create: { userId, ingredientId, quantity, unit },
        update: { quantity: { increment: quantity } },
      });
      return;
    }
    const current = convertQuantity(
      existing.quantity,
      existing.unit,
      unit,
      gramsPerTablespoon,
    );
    if (current === null) {
      throw new ConflictException(
        `Le stock de cet ingrédient est en ${unitLabel(existing.unit)}, incompatible avec ${unitLabel(unit)} : corrige-le avant de valider la liste`,
      );
    }
    await tx.stock.update({
      where: { id: existing.id },
      data: { quantity: roundQuantity(current + quantity), unit },
    });
  }

  private async ensureOwnedList(userId: string, id: string) {
    const list = await this.prisma.shoppingList.findUnique({ where: { id } });
    if (!list) {
      throw new NotFoundException('Liste de courses introuvable');
    }
    if (list.userId !== userId) {
      throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
    }
    return list;
  }
}
