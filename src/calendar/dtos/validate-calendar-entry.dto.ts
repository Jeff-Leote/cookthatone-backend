import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class ValidateCalendarEntryDto {
  @IsBoolean({ message: 'Le statut de validation doit être vrai ou faux' })
  done: boolean;

  @IsOptional()
  @IsUUID('4', { message: "L'identifiant de la recette n'est pas valide" })
  actualRecipeId?: string;
}
