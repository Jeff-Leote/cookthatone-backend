import { IsEnum, IsNumber, IsPositive, IsUUID } from 'class-validator';
import { Unit } from '@prisma/client';

export class RecipeIngredientDto {
  @IsUUID()
  ingredientId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsEnum(Unit)
  unit: Unit;
}
