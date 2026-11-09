import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: "L'adresse email n'est pas valide" })
  email: string;
}
