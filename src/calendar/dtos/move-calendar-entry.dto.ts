import { Type } from 'class-transformer';
import { IsDate, IsEnum } from 'class-validator';
import { MealSlot } from '@prisma/client';

export class MoveCalendarEntryDto {
  @Type(() => Date)
  @IsDate()
  plannedDate: Date;

  @IsEnum(MealSlot)
  mealSlot: MealSlot;
}
