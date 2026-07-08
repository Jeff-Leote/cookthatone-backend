import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Unit } from '@prisma/client';

export class CreateIngredientDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(Unit)
  defaultUnit: Unit;
}
