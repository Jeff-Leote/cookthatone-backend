import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class FindCalendarWeekDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'La date doit être une date valide' })
  date?: Date;
}
