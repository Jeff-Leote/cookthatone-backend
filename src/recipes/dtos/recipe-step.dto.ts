import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Sanitize } from '../../common/decorators/sanitize.decorator';

export class RecipeStepDto {
  @IsInt({ message: "L'ordre de l'étape doit être un entier" })
  @Min(1, { message: 'L’ordre de l’étape doit être d’au moins 1' })
  stepOrder: number;

  @Sanitize()
  @IsString({ message: "L'instruction doit être une chaîne de caractères" })
  @IsNotEmpty({ message: "L'instruction ne peut pas être vide" })
  instruction: string;
}
