import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsUUID, Min } from 'class-validator';
import { MealSlot } from '@prisma/client';

export class CreateCalendarEntryDto {
  @IsUUID('4', { message: "L'identifiant de la recette n'est pas valide" })
  recipeId!: string;

  @Type(() => Date)
  @IsDate({ message: 'La date planifiée doit être une date valide' })
  plannedDate!: Date;

  @IsEnum(MealSlot, { message: "Le créneau de repas n'est pas valide" })
  mealSlot!: MealSlot;

  @IsInt({ message: 'Le nombre de portions doit être un entier' })
  @Min(1, { message: 'Le nombre de portions doit être d’au moins 1' })
  servings!: number;
}
