import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: "L'adresse email n'est pas valide" })
  email: string;

  @IsString({ message: 'Le pseudo doit être une chaîne de caractères' })
  @Length(3, 20, {
    message: 'Le pseudo doit contenir entre 3 et 20 caractères',
  })
  @Matches(/^\w+$/, {
    message:
      'Le pseudo ne peut contenir que des lettres, chiffres et underscores',
  })
  pseudo: string;

  @IsString({ message: 'Le mot de passe doit être une chaîne de caractères' })
  @MinLength(8, {
    message: 'Le mot de passe doit contenir au moins 8 caractères',
  })
  password: string;
}
