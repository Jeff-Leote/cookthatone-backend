import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: "L'adresse email n'est pas valide" })
  email: string;

  @IsString({ message: 'Le mot de passe est requis' })
  @MaxLength(72, {
    message: 'Le mot de passe ne peut pas dépasser 72 caractères',
  })
  password: string;
}
