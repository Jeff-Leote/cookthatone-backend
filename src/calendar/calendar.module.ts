import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { CalendarController } from './controllers/calendar.controller';
import { CalendarService } from './services/calendar.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
