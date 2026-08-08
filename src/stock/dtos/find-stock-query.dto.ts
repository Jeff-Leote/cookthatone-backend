import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class FindStockQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean({ message: 'Le filtre « bientôt expiré » doit être vrai ou faux' })
  expiringSoon?: boolean;
}
