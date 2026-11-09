import { IsEnum, IsNumber, IsOptional, IsPositive } from 'class-validator';
import { Unit } from '@prisma/client';

export class UpdateRecipeIngredientDto {
  @IsOptional()
  @IsNumber({}, { message: 'La quantité doit être un nombre' })
  @IsPositive({ message: 'La quantité doit être positive' })
  quantity?: number;

  @IsOptional()
  @IsEnum(Unit, { message: "L'unité n'est pas valide" })
  unit?: Unit;
}
