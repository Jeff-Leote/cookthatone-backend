import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { RecipeStepDto } from './recipe-step.dto';

export class ReplaceRecipeStepsDto {
  @IsArray({ message: 'Les étapes doivent être une liste' })
  @ValidateNested({ each: true })
  @Type(() => RecipeStepDto)
  steps: RecipeStepDto[];
}
