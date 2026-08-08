import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
} from 'class-validator';
import { Unit } from '@prisma/client';

export class CreateStockDto {
  @IsUUID('4', { message: "L'identifiant de l'ingrédient n'est pas valide" })
  ingredientId: string;

  @IsNumber({}, { message: 'La quantité doit être un nombre' })
  @IsPositive({ message: 'La quantité doit être positive' })
  quantity: number;

  @IsEnum(Unit, { message: "L'unité n'est pas valide" })
  unit: Unit;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: "La date d'expiration doit être une date valide" })
  expiresAt?: Date;
}
