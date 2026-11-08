import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
} from 'class-validator';
import { Unit } from '@prisma/client';
import { Sanitize } from '../../common/decorators/sanitize.decorator';

export class CreateIngredientDto {
  @Sanitize()
  @IsString({ message: 'Le nom doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  name: string;

  @IsEnum(Unit, { message: "L'unité par défaut n'est pas valide" })
  defaultUnit: Unit;

  // Poids d'une cuillère à soupe (15 ml) en grammes : relie le poids au volume
  // pour cet ingrédient (farine ≈ 10 g).
  @IsOptional()
  @IsNumber(
    {},
    { message: "Le poids d'une cuillère à soupe doit être un nombre" },
  )
  @IsPositive({ message: "Le poids d'une cuillère à soupe doit être positif" })
  @Max(100, {
    message: "Le poids d'une cuillère à soupe doit rester sous 100 g",
  })
  gramsPerTablespoon?: number;
}
