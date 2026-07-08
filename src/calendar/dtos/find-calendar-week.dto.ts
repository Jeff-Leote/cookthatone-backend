import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class FindCalendarWeekDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date?: Date;
}
