import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import {
  HTTP_URL_MAX_LENGTH,
  httpUrlMessage,
  IsHttpUrl,
} from '../../common/decorators/is-http-url.decorator';
import { Capitalize } from '../../common/decorators/capitalize.decorator';
import { Sanitize } from '../../common/decorators/sanitize.decorator';

export class UpdateRecipeDto {
  @IsOptional()
  @Sanitize()
  @Capitalize()
  @IsString({ message: 'Le titre doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le titre ne peut pas être vide' })
  title?: string;

  @IsOptional()
  @Sanitize()
  @IsString({ message: 'La description doit être une chaîne de caractères' })
  description?: string;

  @IsOptional()
  @IsInt({ message: 'Le temps de préparation doit être un entier' })
  @Min(0, { message: 'Le temps de préparation ne peut pas être négatif' })
  prepTimeMin?: number;

  @IsOptional()
  @IsInt({ message: 'Le temps de cuisson doit être un entier' })
  @Min(0, { message: 'Le temps de cuisson ne peut pas être négatif' })
  cookTimeMin?: number;

  @IsOptional()
  @IsInt({ message: 'Le nombre de portions doit être un entier' })
  @IsPositive({ message: 'Le nombre de portions doit être positif' })
  servings?: number;

  // `null` efface la source ; l'absence du champ la laisse inchangée. Pas de
  // @Sanitize() : il réécrirait les « & » de l'adresse.
  @ApiPropertyOptional({
    description:
      "Adresse de la page d'origine de la recette (http ou https) ; null l'efface",
    example: 'https://exemple.fr/recettes/tarte',
    maxLength: HTTP_URL_MAX_LENGTH,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsHttpUrl({ message: httpUrlMessage("L'adresse de la source") })
  sourceUrl?: string | null;
}
