import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString({ message: 'Le mot de passe actuel est requis' })
  @IsNotEmpty({ message: 'Le mot de passe actuel est requis' })
  @MaxLength(72, {
    message: 'Le mot de passe actuel ne peut pas dépasser 72 caractères',
  })
  currentPassword: string;

  @IsString({
    message: 'Le nouveau mot de passe doit être une chaîne de caractères',
  })
  @IsNotEmpty({ message: 'Le nouveau mot de passe est requis' })
  @MinLength(8, {
    message: 'Le nouveau mot de passe doit contenir au moins 8 caractères',
  })
  @MaxLength(72, {
    message: 'Le nouveau mot de passe ne peut pas dépasser 72 caractères',
  })
  newPassword: string;
}
