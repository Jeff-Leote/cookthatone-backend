import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class UpdateStockDto {
  @IsOptional()
  @IsNumber({}, { message: 'La quantité doit être un nombre' })
  @IsPositive({ message: 'La quantité doit être positive' })
  quantity?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: "La date d'expiration doit être une date valide" })
  expiresAt?: Date;
}
