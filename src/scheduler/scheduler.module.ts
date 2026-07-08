import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationTaskService } from './services/notification-task.service';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  providers: [NotificationTaskService],
})
export class SchedulerModule {}
