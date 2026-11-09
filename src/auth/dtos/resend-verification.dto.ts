import { IsEmail } from 'class-validator';

export class ResendVerificationDto {
  @IsEmail({}, { message: "L'adresse email n'est pas valide" })
  email: string;
}
