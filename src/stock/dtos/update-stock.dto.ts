import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class UpdateStockDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantity?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}
