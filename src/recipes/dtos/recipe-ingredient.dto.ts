import { IsEnum, IsNumber, IsPositive, IsUUID } from 'class-validator';
import { Unit } from '@prisma/client';

export class RecipeIngredientDto {
  @IsUUID('4', { message: "L'identifiant de l'ingrédient n'est pas valide" })
  ingredientId: string;

  @IsNumber({}, { message: 'La quantité doit être un nombre' })
  @IsPositive({ message: 'La quantité doit être positive' })
  quantity: number;

  @IsEnum(Unit, { message: "L'unité n'est pas valide" })
  unit: Unit;
}
