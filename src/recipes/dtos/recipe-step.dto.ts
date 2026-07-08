import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class RecipeStepDto {
  @IsInt()
  @Min(1)
  stepOrder: number;

  @IsString()
  @IsNotEmpty()
  instruction: string;
}
