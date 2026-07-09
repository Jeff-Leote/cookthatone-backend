import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/services/prisma.service';

@Injectable()
export class NotificationTaskService {
  private readonly logger = new Logger(NotificationTaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  findTodaysUnvalidatedEntries() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

    return this.prisma.calendarEntry.findMany({
      where: { plannedDate: { gte: start, lte: end }, done: false },
      include: { user: true, recipe: true },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_9PM)
  async notifyEndOfDay() {
    const entries = await this.findTodaysUnvalidatedEntries();

    const entriesByUser = new Map<string, typeof entries>();
    for (const entry of entries) {
      const userEntries = entriesByUser.get(entry.userId) ?? [];
      userEntries.push(entry);
      entriesByUser.set(entry.userId, userEntries);
    }

    for (const [userId, userEntries] of entriesByUser) {
      this.logger.log(
        `User ${userId} has ${userEntries.length} unvalidated meal(s) planned today`,
      );
    }

    return entriesByUser;
  }
}
