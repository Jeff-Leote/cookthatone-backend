import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class FindRecipesQueryDto {
  @IsOptional()
  @IsString({ message: 'La recherche doit être une chaîne de caractères' })
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La page doit être un entier' })
  @IsPositive({ message: 'La page doit être positive' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La limite doit être un entier' })
  @IsPositive({ message: 'La limite doit être positive' })
  limit?: number = 20;
}
