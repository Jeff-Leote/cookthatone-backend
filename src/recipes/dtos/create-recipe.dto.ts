import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Sanitize } from '../../common/decorators/sanitize.decorator';
import { RecipeIngredientDto } from './recipe-ingredient.dto';
import { RecipeStepDto } from './recipe-step.dto';

export class CreateRecipeDto {
  @Sanitize()
  @IsString({ message: 'Le titre doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le titre est requis' })
  title: string;

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

  @IsOptional()
  @IsArray({ message: 'Les ingrédients doivent être une liste' })
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients?: RecipeIngredientDto[];

  @IsOptional()
  @IsArray({ message: 'Les étapes doivent être une liste' })
  @ValidateNested({ each: true })
  @Type(() => RecipeStepDto)
  steps?: RecipeStepDto[];
}
