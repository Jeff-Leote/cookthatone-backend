import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Unit } from '@prisma/client';
import { Sanitize } from '../../common/decorators/sanitize.decorator';

export class CreateIngredientDto {
  @Sanitize()
  @IsString({ message: 'Le nom doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  name: string;

  @IsEnum(Unit, { message: "L'unité par défaut n'est pas valide" })
  defaultUnit: Unit;
}
