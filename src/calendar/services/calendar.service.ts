import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { CreateCalendarEntryDto } from '../dtos/create-calendar-entry.dto';
import { MoveCalendarEntryDto } from '../dtos/move-calendar-entry.dto';
import { ValidateCalendarEntryDto } from '../dtos/validate-calendar-entry.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  constructor(private readonly prisma: PrismaService) {}

  findWeek(userId: string, date?: Date) {
    const start = startOfWeek(date ?? new Date());
    const end = new Date(start.getTime() + 6 * MS_PER_DAY);

    return this.prisma.calendarEntry.findMany({
      where: { userId, plannedDate: { gte: start, lte: end } },
      orderBy: { plannedDate: 'asc' },
    });
  }

  findRange(userId: string, from: Date, to: Date) {
    return this.prisma.calendarEntry.findMany({
      where: { userId, plannedDate: { gte: from, lte: to } },
      orderBy: { plannedDate: 'asc' },
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
        },
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

    return this.prisma.calendarEntry.update({
      where: { id },
      data: {
        done: dto.done,
        actualRecipeId: dto.done
          ? (dto.actualRecipeId ?? entry.recipeId)
          : null,
        validatedAt: dto.done ? new Date() : null,
      },
    });
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
