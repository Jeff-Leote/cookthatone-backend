import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'pseudo must contain only letters, numbers and underscores',
  })
  pseudo: string;

  @IsString()
  @MinLength(8)
  password: string;
}
