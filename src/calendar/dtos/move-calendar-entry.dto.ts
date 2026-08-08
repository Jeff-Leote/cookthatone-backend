import { Type } from 'class-transformer';
import { IsDate, IsEnum } from 'class-validator';
import { MealSlot } from '@prisma/client';

export class MoveCalendarEntryDto {
  @Type(() => Date)
  @IsDate({ message: 'La date planifiée doit être une date valide' })
  plannedDate: Date;

  @IsEnum(MealSlot, { message: "Le créneau de repas n'est pas valide" })
  mealSlot: MealSlot;
}
