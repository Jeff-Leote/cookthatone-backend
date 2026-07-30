import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsUUID, Min } from 'class-validator';
import { MealSlot } from '@prisma/client';

export class CreateCalendarEntryDto {
  @IsUUID()
  recipeId!: string;

  @Type(() => Date)
  @IsDate()
  plannedDate!: Date;

  @IsEnum(MealSlot)
  mealSlot!: MealSlot;

  @IsInt()
  @Min(1)
  servings!: number;
}
