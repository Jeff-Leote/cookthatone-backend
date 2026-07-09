import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/services/prisma.service';
import { NotificationTaskService } from './notification-task.service';

describe('NotificationTaskService', () => {
  let service: NotificationTaskService;
  let prisma: { calendarEntry: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { calendarEntry: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationTaskService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NotificationTaskService>(NotificationTaskService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('finds unvalidated entries planned for today', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      { id: 'entry-1', userId: 'user-1', done: false },
    ]);

    const result = await service.findTodaysUnvalidatedEntries();

    expect(result).toHaveLength(1);
    expect(prisma.calendarEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('groups unvalidated entries by user when notifying', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      { id: 'entry-1', userId: 'user-1', done: false },
      { id: 'entry-2', userId: 'user-1', done: false },
      { id: 'entry-3', userId: 'user-2', done: false },
    ]);

    const result = await service.notifyEndOfDay();

    expect(result.get('user-1')).toHaveLength(2);
    expect(result.get('user-2')).toHaveLength(1);
  });

  it('returns an empty map when nothing is unvalidated today', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([]);

    const result = await service.notifyEndOfDay();

    expect(result.size).toBe(0);
  });
});
