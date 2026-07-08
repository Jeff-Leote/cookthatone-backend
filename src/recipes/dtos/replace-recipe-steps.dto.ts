import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { RecipeStepDto } from './recipe-step.dto';

export class ReplaceRecipeStepsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeStepDto)
  steps: RecipeStepDto[];
}
