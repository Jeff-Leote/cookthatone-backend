import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class FindRecipesQueryDto {
  @IsOptional()
  @IsString({ message: 'La recherche doit être une chaîne de caractères' })
  @MaxLength(100, {
    message: 'La recherche ne peut pas dépasser 100 caractères',
  })
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
