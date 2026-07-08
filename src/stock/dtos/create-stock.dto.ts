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
  @IsUUID()
  ingredientId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsEnum(Unit)
  unit: Unit;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}
