import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { MealSlot, Prisma, Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { EmailService } from '../../email/services/email.service';
import { CalendarService } from './calendar.service';

describe('CalendarService', () => {
  let service: CalendarService;
  let emailService: { sendInsufficientStockEmail: jest.Mock };
  let prisma: {
    calendarEntry: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    calendarEntryConsumption: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
    recipe: { findUnique: jest.Mock };
    recipeIngredient: { findMany: jest.Mock };
    stock: {
      findUnique: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  const ownedEntry = {
    id: 'entry-1',
    userId: 'user-1',
    recipeId: 'recipe-1',
    plannedDate: new Date('2026-07-06'),
    mealSlot: MealSlot.MIDI,
    servings: 2,
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
      calendarEntryConsumption: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      recipe: { findUnique: jest.fn().mockResolvedValue({ servings: 2 }) },
      recipeIngredient: { findMany: jest.fn().mockResolvedValue([]) },
      stock: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    // Interactive transaction mock: runs the callback with the same mocked
    // client, mirroring how a real Prisma transaction hands the callback a
    // tx client with the same model API.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    emailService = { sendInsufficientStockEmail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<CalendarService>(CalendarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // T11: create() créneau libre -> entrée créée
  it('creates an entry when the slot is free', async () => {
    prisma.calendarEntry.create.mockResolvedValue(ownedEntry);

    const result = await service.create('user-1', {
      recipeId: 'recipe-1',
      plannedDate: ownedEntry.plannedDate,
      mealSlot: MealSlot.MIDI,
      servings: 2,
    });

    expect(result).toEqual(ownedEntry);
  });

  // T12: create() créneau déjà occupe -> ConflictException (409)
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
        servings: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // T13: validate() done=true, même recette -> actualRecipeId = recipeId
  it('sets actualRecipeId to the planned recipe when validating without a replacement', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue(ownedEntry);
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: null,
        }),
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
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: { title: 'Recette de remplacement' },
        }),
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
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: null,
        }),
    );

    const result = await service.validate('user-1', 'entry-1', { done: false });

    expect(result.done).toBe(false);
    expect(result.actualRecipeId).toBeNull();
    expect(result.validatedAt).toBeNull();
  });

  // validate() consomme le stock disponible pour la recette validée
  it('consumes stock for the recipe ingredients when validating', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue(ownedEntry);
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: null,
        }),
    );
    prisma.recipeIngredient.findMany.mockResolvedValue([
      {
        ingredientId: 'ingredient-1',
        quantity: 200,
        unit: Unit.G,
        ingredient: { name: 'Farine' },
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      userId: 'user-1',
      ingredientId: 'ingredient-1',
      quantity: 500,
      unit: Unit.G,
    });

    await service.validate('user-1', 'entry-1', { done: true });

    expect(prisma.stock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { quantity: 300 },
    });
    expect(prisma.calendarEntryConsumption.upsert).toHaveBeenCalledWith({
      where: {
        calendarEntryId_ingredientId: {
          calendarEntryId: 'entry-1',
          ingredientId: 'ingredient-1',
        },
      },
      create: {
        calendarEntryId: 'entry-1',
        ingredientId: 'ingredient-1',
        quantity: 200,
        unit: Unit.G,
      },
      update: { quantity: 200 },
    });
    expect(emailService.sendInsufficientStockEmail).not.toHaveBeenCalled();
  });

  // L'unité du stock est la référence : le besoin de la recette y est converti.
  it('consumes the recipe quantity converted into the stock unit', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue(ownedEntry);
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: null,
        }),
    );
    prisma.recipeIngredient.findMany.mockResolvedValue([
      {
        ingredientId: 'ingredient-1',
        quantity: 200,
        unit: Unit.G,
        ingredient: { name: 'Farine' },
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      userId: 'user-1',
      ingredientId: 'ingredient-1',
      quantity: 1,
      unit: Unit.KG,
    });

    await service.validate('user-1', 'entry-1', { done: true });

    expect(prisma.stock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { quantity: 0.8 },
    });
    const [args] = prisma.calendarEntryConsumption.upsert.mock.calls[0] as [
      { create: { quantity: number; unit: Unit } },
    ];
    expect(args.create).toMatchObject({ quantity: 0.2, unit: Unit.KG });
    expect(emailService.sendInsufficientStockEmail).not.toHaveBeenCalled();
  });

  it('leaves the stock untouched when the units have no equivalent', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue(ownedEntry);
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: null,
        }),
    );
    prisma.recipeIngredient.findMany.mockResolvedValue([
      {
        ingredientId: 'ingredient-1',
        quantity: 200,
        unit: Unit.PIECE,
        ingredient: { name: 'Farine' },
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      userId: 'user-1',
      ingredientId: 'ingredient-1',
      quantity: 500,
      unit: Unit.G,
    });

    await service.validate('user-1', 'entry-1', { done: true });

    expect(prisma.stock.update).not.toHaveBeenCalled();
    expect(prisma.stock.delete).not.toHaveBeenCalled();
    expect(prisma.calendarEntryConsumption.upsert).not.toHaveBeenCalled();
    expect(emailService.sendInsufficientStockEmail).not.toHaveBeenCalled();
  });

  // Les portions choisies pour ce repas peuvent différer des portions de
  // base de la recette : les quantités consommées doivent suivre le ratio.
  it('scales the consumed quantities by the chosen servings', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue({
      ...ownedEntry,
      servings: 4, // recette prévue pour 2, mais 4 portions demandées ici
    });
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: null,
        }),
    );
    prisma.recipe.findUnique.mockResolvedValue({ servings: 2 });
    prisma.recipeIngredient.findMany.mockResolvedValue([
      {
        ingredientId: 'ingredient-1',
        quantity: 200,
        unit: Unit.G,
        ingredient: { name: 'Farine' },
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      userId: 'user-1',
      ingredientId: 'ingredient-1',
      quantity: 1000,
      unit: Unit.G,
    });

    await service.validate('user-1', 'entry-1', { done: true });

    // ratio 4/2 = 2 -> 200g de base devient 400g consommes
    expect(prisma.stock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { quantity: 600 },
    });
  });

  // Quand le stock ne couvre pas toute la recette, on consomme ce qui est
  // disponible (sans passer sous zéro, la ligne épuisée est supprimée) et on
  // notifie par email le manque.
  it('sends an insufficient stock email when stock does not cover the recipe', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue(ownedEntry);
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Gâteau au chocolat' },
          actualRecipe: null,
        }),
    );
    prisma.recipeIngredient.findMany.mockResolvedValue([
      {
        ingredientId: 'ingredient-1',
        quantity: 300,
        unit: Unit.G,
        ingredient: { name: 'Farine' },
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      userId: 'user-1',
      ingredientId: 'ingredient-1',
      quantity: 150,
      unit: Unit.G,
    });
    prisma.user.findUnique.mockResolvedValue({
      email: 'user@example.com',
      pseudo: 'Chef',
    });

    await service.validate('user-1', 'entry-1', { done: true });

    expect(prisma.stock.delete).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
    });
    expect(prisma.stock.update).not.toHaveBeenCalled();
    expect(emailService.sendInsufficientStockEmail).toHaveBeenCalledWith(
      'user@example.com',
      'Chef',
      'Gâteau au chocolat',
      [{ ingredientName: 'Farine', missing: 150, unit: Unit.G }],
    );
  });

  // Dévalider un repas doit remettre au stock exactement ce qui avait été
  // consommé, même si le stock a changé depuis.
  it('restores exactly the consumed quantity when unvalidating a meal', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue({
      ...ownedEntry,
      done: true,
      actualRecipeId: 'recipe-1',
    });
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: null,
        }),
    );
    prisma.calendarEntryConsumption.findMany.mockResolvedValue([
      {
        calendarEntryId: 'entry-1',
        ingredientId: 'ingredient-1',
        quantity: 200,
        unit: Unit.G,
      },
    ]);

    await service.validate('user-1', 'entry-1', { done: false });

    expect(prisma.stock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_ingredientId: {
            userId: 'user-1',
            ingredientId: 'ingredient-1',
          },
        },
        update: { quantity: { increment: 200 } },
      }),
    );
    expect(prisma.calendarEntryConsumption.deleteMany).toHaveBeenCalledWith({
      where: { calendarEntryId: 'entry-1' },
    });
  });
  it('consumes spoons of the recipe from a stock in grams through the ingredient equivalence', async () => {
    prisma.calendarEntry.findUnique.mockResolvedValue(ownedEntry);
    prisma.calendarEntry.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...ownedEntry,
          ...args.data,
          recipe: { title: 'Recette' },
          actualRecipe: null,
        }),
    );
    prisma.recipeIngredient.findMany.mockResolvedValue([
      {
        ingredientId: 'ingredient-1',
        quantity: 1,
        unit: Unit.CUILLERE_A_SOUPE,
        ingredient: { name: 'Farine', gramsPerTablespoon: 10 },
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      userId: 'user-1',
      ingredientId: 'ingredient-1',
      quantity: 500,
      unit: Unit.G,
    });

    await service.validate('user-1', 'entry-1', { done: true });

    // servings du repas 2 pour 2 portions de base : 1 c. à soupe = 10 g
    expect(prisma.stock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { quantity: 490 },
    });
  });
});
