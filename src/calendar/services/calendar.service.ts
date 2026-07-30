import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { EmailService, StockDeficit } from '../../email/services/email.service';
import { CreateCalendarEntryDto } from '../dtos/create-calendar-entry.dto';
import { MoveCalendarEntryDto } from '../dtos/move-calendar-entry.dto';
import { ValidateCalendarEntryDto } from '../dtos/validate-calendar-entry.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Le frontend affiche le titre de la recette planifiée (et de la recette
// réellement cuisinée si elle diffère) sans requête supplémentaire.
const CALENDAR_ENTRY_INCLUDE = {
  recipe: true,
  actualRecipe: true,
} satisfies Prisma.CalendarEntryInclude;

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  findWeek(userId: string, date?: Date) {
    const start = startOfWeek(date ?? new Date());
    const end = new Date(start.getTime() + 6 * MS_PER_DAY);

    return this.prisma.calendarEntry.findMany({
      where: { userId, plannedDate: { gte: start, lte: end } },
      orderBy: { plannedDate: 'asc' },
      include: CALENDAR_ENTRY_INCLUDE,
    });
  }

  findRange(userId: string, from: Date, to: Date) {
    return this.prisma.calendarEntry.findMany({
      where: { userId, plannedDate: { gte: from, lte: to } },
      orderBy: { plannedDate: 'asc' },
      include: CALENDAR_ENTRY_INCLUDE,
    });
  }

  async create(userId: string, dto: CreateCalendarEntryDto) {
    try {
      return await this.prisma.calendarEntry.create({
        data: {
          userId,
          recipeId: dto.recipeId,
          plannedDate: dto.plannedDate,
          mealSlot: dto.mealSlot,
          servings: dto.servings,
        },
        include: CALENDAR_ENTRY_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('This slot is already taken');
      }
      throw error;
    }
  }

  async move(userId: string, id: string, dto: MoveCalendarEntryDto) {
    await this.ensureOwnedEntry(userId, id);

    try {
      return await this.prisma.calendarEntry.update({
        where: { id },
        data: { plannedDate: dto.plannedDate, mealSlot: dto.mealSlot },
        include: CALENDAR_ENTRY_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('This slot is already taken');
      }
      throw error;
    }
  }

  async validate(userId: string, id: string, dto: ValidateCalendarEntryDto) {
    const entry = await this.ensureOwnedEntry(userId, id);
    const willBeDone = dto.done;
    const actualRecipeId = willBeDone
      ? (dto.actualRecipeId ?? entry.recipeId)
      : null;

    const { updated, deficits } = await this.prisma.$transaction(async (tx) => {
      // On annule d'abord la consommation precedente (si le repas etait
      // deja valide) pour repartir sur une base propre, que ce soit pour
      // devalider ou pour re-valider avec une recette differente.
      await this.restoreConsumption(tx, userId, id);

      const deficits = willBeDone
        ? await this.consumeForRecipe(
            tx,
            userId,
            id,
            actualRecipeId!,
            entry.servings,
          )
        : [];

      const updated = await tx.calendarEntry.update({
        where: { id },
        data: {
          done: willBeDone,
          actualRecipeId,
          validatedAt: willBeDone ? new Date() : null,
        },
        include: CALENDAR_ENTRY_INCLUDE,
      });

      return { updated, deficits };
    });

    if (deficits.length > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (user) {
        void this.emailService.sendInsufficientStockEmail(
          user.email,
          user.pseudo,
          updated.actualRecipe?.title ?? updated.recipe.title,
          deficits,
        );
      }
    }

    return updated;
  }

  // Remet au stock exactement ce qui avait ete consomme pour ce repas, puis
  // efface l'historique de consommation : le stock peut avoir change depuis
  // (autre repas cuisine dans l'intervalle), donc on ne recalcule rien, on
  // annule precisement le mouvement precedent.
  private async restoreConsumption(
    tx: Prisma.TransactionClient,
    userId: string,
    calendarEntryId: string,
  ) {
    const consumptions = await tx.calendarEntryConsumption.findMany({
      where: { calendarEntryId },
    });

    for (const consumption of consumptions) {
      await tx.stock.upsert({
        where: {
          userId_ingredientId: {
            userId,
            ingredientId: consumption.ingredientId,
          },
        },
        create: {
          userId,
          ingredientId: consumption.ingredientId,
          quantity: consumption.quantity,
          unit: consumption.unit,
        },
        update: { quantity: { increment: consumption.quantity } },
      });
    }

    await tx.calendarEntryConsumption.deleteMany({
      where: { calendarEntryId },
    });
  }

  // Consomme le stock disponible pour chaque ingredient de la recette, sans
  // jamais le faire passer sous zero. Le manque eventuel est retourne pour
  // notifier l'utilisateur (email), la validation n'est jamais bloquee.
  private async consumeForRecipe(
    tx: Prisma.TransactionClient,
    userId: string,
    calendarEntryId: string,
    recipeId: string,
    servings: number,
  ): Promise<StockDeficit[]> {
    const recipe = await tx.recipe.findUnique({
      where: { id: recipeId },
      select: { servings: true },
    });
    // Les quantites de la recette sont definies pour son nombre de portions
    // de base ; on les met a l'echelle du nombre de portions confirme pour
    // ce repas.
    const ratio = servings / (recipe?.servings ?? 1);

    const recipeIngredients = await tx.recipeIngredient.findMany({
      where: { recipeId },
      include: { ingredient: true },
    });

    const deficits: StockDeficit[] = [];
    for (const recipeIngredient of recipeIngredients) {
      const neededQuantity = recipeIngredient.quantity * ratio;
      const stock = await tx.stock.findUnique({
        where: {
          userId_ingredientId: {
            userId,
            ingredientId: recipeIngredient.ingredientId,
          },
        },
      });
      const available = stock?.quantity ?? 0;
      const consumed = Math.min(available, neededQuantity);
      const missing = neededQuantity - consumed;

      if (consumed > 0 && stock) {
        await tx.stock.update({
          where: { id: stock.id },
          data: { quantity: available - consumed },
        });
        await tx.calendarEntryConsumption.upsert({
          where: {
            calendarEntryId_ingredientId: {
              calendarEntryId,
              ingredientId: recipeIngredient.ingredientId,
            },
          },
          create: {
            calendarEntryId,
            ingredientId: recipeIngredient.ingredientId,
            quantity: consumed,
            unit: recipeIngredient.unit,
          },
          update: { quantity: consumed },
        });
      }

      if (missing > 0) {
        deficits.push({
          ingredientName: recipeIngredient.ingredient.name,
          missing,
          unit: recipeIngredient.unit,
        });
      }
    }

    return deficits;
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnedEntry(userId, id);
    await this.prisma.calendarEntry.delete({ where: { id } });
  }

  private async ensureOwnedEntry(userId: string, id: string) {
    const entry = await this.prisma.calendarEntry.findUnique({
      where: { id },
    });
    if (!entry) {
      throw new NotFoundException('Calendar entry not found');
    }
    if (entry.userId !== userId) {
      throw new ForbiddenException();
    }
    return entry;
  }
}
