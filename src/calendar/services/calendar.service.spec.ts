import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { MealSlot, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { CalendarService } from './calendar.service';

describe('CalendarService', () => {
  let service: CalendarService;
  let prisma: {
    calendarEntry: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const ownedEntry = {
    id: 'entry-1',
    userId: 'user-1',
    recipeId: 'recipe-1',
    plannedDate: new Date('2026-07-06'),
    mealSlot: MealSlot.MIDI,
    done: false,
    actualRecipeId: null,
  };

  beforeEach(async () => {
    prisma = {
      calendarEntry: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CalendarService>(CalendarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // T11: create() creneau libre -> entree creee
  it('creates an entry when the slot is free', async () => {
    prisma.calendarEntry.create.mockResolvedValue(ownedEntry);

    const result = await service.create('user-1', {
      recipeId: 'recipe-1',
      plannedDate: ownedEntry.plannedDate,
      mealSlot: MealSlot.MIDI,
    });

    expect(result).toEqual(ownedEntry);
  });

  // T12: create() creneau deja occupe -> ConflictException (409)
  it('throws ConflictException when the slot is already taken', async () => {
    prisma.calendarEntry.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );

    await expect(
      service.create('user-1', {
        recipeId: 'recipe-1',
        plannedDate: ownedEntry.plannedDate,
        mealSlot: MealSlot.MIDI,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // T13: validate() done=true, meme recette -> actualRecipeId = recipeId
  it('sets actualRecipeId to the planned recipe when validating without a replacement', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue(ownedEntry);
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ownedEntry, ...args.data }),
    );

    const result = await service.validate('user-1', 'entry-1', { done: true });

    expect(result.actualRecipeId).toBe('recipe-1');
    expect(result.done).toBe(true);
  });

  // T14: validate() done=true, autre recette -> actualRecipeId = id remplacement
  it('sets actualRecipeId to the replacement recipe when provided', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue(ownedEntry);
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ownedEntry, ...args.data }),
    );

    const result = await service.validate('user-1', 'entry-1', {
      done: true,
      actualRecipeId: 'recipe-2',
    });

    expect(result.actualRecipeId).toBe('recipe-2');
  });

  it('clears actualRecipeId and validatedAt when un-validating', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue({
      ...ownedEntry,
      done: true,
      actualRecipeId: 'recipe-1',
    });
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ownedEntry, ...args.data }),
    );

    const result = await service.validate('user-1', 'entry-1', { done: false });

    expect(result.done).toBe(false);
    expect(result.actualRecipeId).toBeNull();
  });
});
