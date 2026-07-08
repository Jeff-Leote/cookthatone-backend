import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { CalendarService } from '../services/calendar.service';
import { CreateCalendarEntryDto } from '../dtos/create-calendar-entry.dto';
import { MoveCalendarEntryDto } from '../dtos/move-calendar-entry.dto';
import { ValidateCalendarEntryDto } from '../dtos/validate-calendar-entry.dto';
import { FindCalendarWeekDto } from '../dtos/find-calendar-week.dto';
import { FindCalendarRangeDto } from '../dtos/find-calendar-range.dto';

@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('week')
  findWeek(
    @Req() req: AuthenticatedRequest,
    @Query() query: FindCalendarWeekDto,
  ) {
    return this.calendarService.findWeek(req.user.userId, query.date);
  }

  @Get()
  findRange(
    @Req() req: AuthenticatedRequest,
    @Query() query: FindCalendarRangeDto,
  ) {
    return this.calendarService.findRange(
      req.user.userId,
      query.from,
      query.to,
    );
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCalendarEntryDto,
  ) {
    return this.calendarService.create(req.user.userId, dto);
  }

  @Patch(':id/move')
  move(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: MoveCalendarEntryDto,
  ) {
    return this.calendarService.move(req.user.userId, id, dto);
  }

  @Patch(':id/validate')
  validate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ValidateCalendarEntryDto,
  ) {
    return this.calendarService.validate(req.user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.calendarService.remove(req.user.userId, id);
  }
}
