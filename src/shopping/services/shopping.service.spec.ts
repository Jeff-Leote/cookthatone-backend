import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { ShoppingService } from './shopping.service';

describe('ShoppingService', () => {
  let service: ShoppingService;
  let prisma: {
    shoppingList: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    shoppingItem: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    calendarEntry: { findMany: jest.Mock };
    stock: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    ingredient: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const ownedList = {
    id: 'list-1',
    userId: 'user-1',
    periodStart: new Date('2026-07-06'),
    periodEnd: new Date('2026-07-06'),
    validated: false,
  };

  beforeEach(async () => {
    prisma = {
      shoppingList: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(ownedList),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      shoppingItem: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      calendarEntry: { findMany: jest.fn() },
      stock: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      ingredient: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    // Interactive transaction mock: runs the callback with the same mocked
    // client, mirroring how a real Prisma transaction hands the callback a
    // tx client with the same model API.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShoppingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ShoppingService>(ShoppingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // T15: generate() stock insuffisant pour la periode -> items avec qte manquante
  it('generates items for ingredients the stock does not fully cover', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      {
        plannedDate: new Date('2026-07-06'),
        servings: 2,
        recipe: {
          servings: 2,
          recipeIngredients: [
            { ingredientId: 'ingredient-1', quantity: 500, unit: Unit.G },
          ],
        },
      },
    ]);
    prisma.stock.findMany.mockResolvedValue([
      { ingredientId: 'ingredient-1', quantity: 100, unit: Unit.G },
    ]);
    prisma.ingredient.findMany.mockResolvedValue([
      { id: 'ingredient-1', defaultUnit: Unit.G },
    ]);
    prisma.shoppingList.create.mockImplementation(
      (args: { data: { items?: { create: unknown[] } } }) =>
        Promise.resolve({ ...ownedList, items: args.data.items?.create ?? [] }),
    );

    const result = await service.generate('user-1', {
      periodStart: new Date('2026-07-06'),
      periodEnd: new Date('2026-07-06'),
    });

    expect(result[0].items).toEqual([
      {
        ingredientId: 'ingredient-1',
        quantityNeeded: 500,
        quantityInStock: 100,
        unit: Unit.G,
      },
    ]);
  });

  // T16: generate() stock couvre tous les besoins -> items vide
  it('produces no items when the stock covers every need', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      {
        plannedDate: new Date('2026-07-06'),
        servings: 2,
        recipe: {
          servings: 2,
          recipeIngredients: [
            { ingredientId: 'ingredient-1', quantity: 500, unit: Unit.G },
          ],
        },
      },
    ]);
    prisma.stock.findMany.mockResolvedValue([
      { ingredientId: 'ingredient-1', quantity: 1000, unit: Unit.G },
    ]);
    prisma.ingredient.findMany.mockResolvedValue([
      { id: 'ingredient-1', defaultUnit: Unit.G },
    ]);
    prisma.shoppingList.create.mockImplementation(
      (args: { data: { items?: { create: unknown[] } } }) =>
        Promise.resolve({ ...ownedList, items: args.data.items?.create ?? [] }),
    );

    const result = await service.generate('user-1', {
      periodStart: new Date('2026-07-06'),
      periodEnd: new Date('2026-07-06'),
    });

    expect(result[0].items).toEqual([]);
  });

  // Les portions choisies pour un repas peuvent différer des portions de
  // base de la recette : les quantités nécessaires doivent suivre le ratio.
  it('scales ingredient quantities by the servings chosen for each meal', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      {
        plannedDate: new Date('2026-07-06'),
        servings: 4, // recette prévue pour 2, mais 4 portions demandées
        recipe: {
          servings: 2,
          recipeIngredients: [
            { ingredientId: 'ingredient-1', quantity: 500, unit: Unit.G },
          ],
        },
      },
    ]);
    prisma.stock.findMany.mockResolvedValue([]);
    prisma.ingredient.findMany.mockResolvedValue([
      { id: 'ingredient-1', defaultUnit: Unit.G },
    ]);
    prisma.shoppingList.create.mockImplementation(
      (args: { data: { items?: { create: unknown[] } } }) =>
        Promise.resolve({ ...ownedList, items: args.data.items?.create ?? [] }),
    );

    const result = await service.generate('user-1', {
      periodStart: new Date('2026-07-06'),
      periodEnd: new Date('2026-07-06'),
    });

    // ratio 4/2 = 2 -> 500 devient 1000
    expect(result[0].items).toEqual([
      {
        ingredientId: 'ingredient-1',
        quantityNeeded: 1000,
        quantityInStock: 0,
        unit: Unit.G,
      },
    ]);
  });

  it('throws BadRequestException when periodEnd is before periodStart', async () => {
    await expect(
      service.generate('user-1', {
        periodStart: new Date('2026-07-10'),
        periodEnd: new Date('2026-07-06'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.calendarEntry.findMany).not.toHaveBeenCalled();
  });

  // Demande explicite : vérifier que chaque jour de la plage a une recette
  // programmee, sinon erreur nommant le jour manquant.
  it('throws BadRequestException naming the day with no planned recipe', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      {
        plannedDate: new Date('2026-08-08'),
        servings: 2,
        recipe: { servings: 2, recipeIngredients: [] },
      },
      // 9 août absent : aucune entrée pour ce jour
      {
        plannedDate: new Date('2026-08-10'),
        servings: 2,
        recipe: { servings: 2, recipeIngredients: [] },
      },
    ]);

    await expect(
      service.generate('user-1', {
        periodStart: new Date('2026-08-08'),
        periodEnd: new Date('2026-08-10'),
      }),
    ).rejects.toThrow("Le 9 août 2026 n'a pas de recette programmée");
  });

  // generate() replaces the existing (unvalidated) list for the exact same
  // period instead of creating a second one.
  it('replaces the items of an existing unvalidated list for the same exact period', async () => {
    prisma.shoppingList.findFirst
      .mockResolvedValueOnce({ ...ownedList, validated: false }) // exact match
      .mockResolvedValueOnce(null); // no other overlap
    prisma.calendarEntry.findMany.mockResolvedValue([
      {
        plannedDate: new Date('2026-07-06'),
        servings: 2,
        recipe: {
          servings: 2,
          recipeIngredients: [
            { ingredientId: 'ingredient-1', quantity: 500, unit: Unit.G },
          ],
        },
      },
    ]);
    prisma.stock.findMany.mockResolvedValue([]);
    prisma.ingredient.findMany.mockResolvedValue([
      { id: 'ingredient-1', defaultUnit: Unit.G },
    ]);
    prisma.shoppingItem.deleteMany.mockResolvedValue({ count: 0 });
    prisma.shoppingList.update.mockImplementation(
      (args: { data: { items?: { create: unknown[] } } }) =>
        Promise.resolve({ ...ownedList, items: args.data.items?.create ?? [] }),
    );

    await service.generate('user-1', {
      periodStart: new Date('2026-07-06'),
      periodEnd: new Date('2026-07-06'),
    });

    expect(prisma.shoppingItem.deleteMany).toHaveBeenCalledWith({
      where: { listId: 'list-1' },
    });
    expect(prisma.shoppingList.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'list-1' } }),
    );
    expect(prisma.shoppingList.create).not.toHaveBeenCalled();
  });

  it('throws ConflictException when regenerating an already validated list', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      {
        plannedDate: new Date('2026-07-06'),
        servings: 2,
        recipe: { servings: 2, recipeIngredients: [] },
      },
    ]);
    prisma.shoppingList.findFirst.mockResolvedValueOnce({
      ...ownedList,
      validated: true,
    });

    await expect(
      service.generate('user-1', {
        periodStart: new Date('2026-07-06'),
        periodEnd: new Date('2026-07-06'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.shoppingList.create).not.toHaveBeenCalled();
  });

  // Demande explicite : deux listes ne doivent jamais pouvoir couvrir un
  // même jour (double comptage du stock si les deux sont validées).
  it('throws ConflictException when the period overlaps an existing list', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      {
        plannedDate: new Date('2026-08-10'),
        servings: 2,
        recipe: { servings: 2, recipeIngredients: [] },
      },
    ]);
    prisma.shoppingList.findFirst
      .mockResolvedValueOnce(null) // pas de correspondance exacte
      .mockResolvedValueOnce({
        id: 'list-2',
        periodStart: new Date('2026-08-08'),
        periodEnd: new Date('2026-08-15'),
      }); // chevauchement

    await expect(
      service.generate('user-1', {
        periodStart: new Date('2026-08-10'),
        periodEnd: new Date('2026-08-10'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.shoppingList.create).not.toHaveBeenCalled();
  });

  // Unités : l'unité de l'ingrédient est la référence, besoins et stock y sont
  // convertis avant d'être comparés.
  describe('generate() avec des unités différentes', () => {
    const period = {
      periodStart: new Date('2026-07-06'),
      periodEnd: new Date('2026-07-06'),
    };

    function mockWeek(
      stock: { quantity: number; unit: Unit }[],
      ingredientUnit: Unit = Unit.G,
    ) {
      prisma.stock.findMany.mockResolvedValue(
        stock.map((entry) => ({ ingredientId: 'ingredient-1', ...entry })),
      );
      prisma.ingredient.findMany.mockResolvedValue([
        { id: 'ingredient-1', name: 'Farine', defaultUnit: ingredientUnit },
      ]);
      prisma.shoppingList.create.mockImplementation(
        (args: { data: { items?: { create: unknown[] } } }) =>
          Promise.resolve({
            ...ownedList,
            items: args.data.items?.create ?? [],
          }),
      );
    }

    it('compares a stock in kg with a need in g', async () => {
      prisma.calendarEntry.findMany.mockResolvedValue([
        {
          plannedDate: new Date('2026-07-06'),
          servings: 2,
          recipe: {
            servings: 2,
            title: 'Gâteau',
            recipeIngredients: [
              { ingredientId: 'ingredient-1', quantity: 1500, unit: Unit.G },
            ],
          },
        },
      ]);
      mockWeek([{ quantity: 1, unit: Unit.KG }]);

      const result = await service.generate('user-1', period);

      expect(result[0].items).toEqual([
        {
          ingredientId: 'ingredient-1',
          quantityNeeded: 1500,
          quantityInStock: 1000,
          unit: Unit.G,
        },
      ]);
    });

    it('lists nothing when a stock in kg covers a need in g', async () => {
      prisma.calendarEntry.findMany.mockResolvedValue([
        {
          plannedDate: new Date('2026-07-06'),
          servings: 2,
          recipe: {
            servings: 2,
            title: 'Gâteau',
            recipeIngredients: [
              { ingredientId: 'ingredient-1', quantity: 500, unit: Unit.G },
            ],
          },
        },
      ]);
      mockWeek([{ quantity: 1, unit: Unit.KG }]);

      const result = await service.generate('user-1', period);

      expect(result[0].items).toEqual([]);
    });

    it('expresses the need in the ingredient unit when the recipe uses another one', async () => {
      prisma.calendarEntry.findMany.mockResolvedValue([
        {
          plannedDate: new Date('2026-07-06'),
          servings: 2,
          recipe: {
            servings: 2,
            title: 'Gâteau',
            recipeIngredients: [
              {
                ingredientId: 'ingredient-1',
                quantity: 2,
                unit: Unit.CUILLERE_A_SOUPE,
              },
            ],
          },
        },
      ]);
      mockWeek([], Unit.ML);

      const result = await service.generate('user-1', period);

      expect(result[0].items).toEqual([
        {
          ingredientId: 'ingredient-1',
          quantityNeeded: 30,
          quantityInStock: 0,
          unit: Unit.ML,
        },
      ]);
    });

    it('adds the same ingredient used in two units across the period', async () => {
      prisma.calendarEntry.findMany.mockResolvedValue([
        {
          plannedDate: new Date('2026-07-06'),
          servings: 2,
          recipe: {
            servings: 2,
            title: 'Gâteau',
            recipeIngredients: [
              { ingredientId: 'ingredient-1', quantity: 500, unit: Unit.G },
              { ingredientId: 'ingredient-1', quantity: 0.5, unit: Unit.KG },
            ],
          },
        },
      ]);
      mockWeek([]);

      const result = await service.generate('user-1', period);

      expect(result[0].items).toEqual([
        {
          ingredientId: 'ingredient-1',
          quantityNeeded: 1000,
          quantityInStock: 0,
          unit: Unit.G,
        },
      ]);
    });

    it('refuses to add quantities whose units have no equivalent and names the recipe', async () => {
      prisma.calendarEntry.findMany.mockResolvedValue([
        {
          plannedDate: new Date('2026-07-06'),
          servings: 2,
          recipe: {
            servings: 2,
            title: 'Crêpes',
            recipeIngredients: [
              { ingredientId: 'ingredient-1', quantity: 2, unit: Unit.PIECE },
            ],
          },
        },
      ]);
      mockWeek([]);

      await expect(service.generate('user-1', period)).rejects.toThrow(
        '« Farine » est en pièce dans « Crêpes » alors que son unité est g',
      );
      expect(prisma.shoppingList.create).not.toHaveBeenCalled();
    });

    it('refuses a stock whose unit has no equivalent in the ingredient unit', async () => {
      prisma.calendarEntry.findMany.mockResolvedValue([
        {
          plannedDate: new Date('2026-07-06'),
          servings: 2,
          recipe: {
            servings: 2,
            title: 'Gâteau',
            recipeIngredients: [
              { ingredientId: 'ingredient-1', quantity: 500, unit: Unit.G },
            ],
          },
        },
      ]);
      mockWeek([{ quantity: 3, unit: Unit.CL }]);

      await expect(service.generate('user-1', period)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.shoppingList.create).not.toHaveBeenCalled();
    });
  });

  // Une ligne de stock dans une autre unité compatible (donnée ancienne) est
  // convertie puis normalisée dans l'unité de l'ingrédient.
  it('normalizes an existing stock in another unit when validating a list', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 1 });
    prisma.shoppingItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        listId: 'list-1',
        ingredientId: 'ingredient-1',
        quantityNeeded: 1500,
        quantityInStock: 1000,
        unit: Unit.G,
        checked: true,
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      quantity: 1,
      unit: Unit.KG,
    });
    prisma.stock.update.mockResolvedValue({});
    prisma.shoppingItem.update.mockResolvedValue({});

    await service.validate('user-1', 'list-1');

    expect(prisma.stock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { quantity: 1500, unit: Unit.G },
    });
    expect(prisma.stock.upsert).not.toHaveBeenCalled();
  });

  it('refuses to validate when the existing stock unit has no equivalent', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 1 });
    prisma.shoppingItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        listId: 'list-1',
        ingredientId: 'ingredient-1',
        quantityNeeded: 500,
        quantityInStock: 0,
        unit: Unit.G,
        checked: true,
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      quantity: 3,
      unit: Unit.PIECE,
    });

    await expect(service.validate('user-1', 'list-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.stock.update).not.toHaveBeenCalled();
  });

  it('removes the purchased quantity from a stock stored in another compatible unit', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 1 });
    prisma.shoppingItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        listId: 'list-1',
        ingredientId: 'ingredient-1',
        purchasedQuantity: 500,
        unit: Unit.G,
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      quantity: 1.5,
      unit: Unit.KG,
    });
    prisma.stock.update.mockResolvedValue({});
    prisma.shoppingItem.update.mockResolvedValue({});

    await service.unvalidate('user-1', 'list-1');

    expect(prisma.stock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { quantity: 1000, unit: Unit.G },
    });
  });

  // T17: validate() items coches -> $transaction + stock mis a jour
  it('validates checked items through a transaction and updates the stock', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 1 });
    prisma.shoppingItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        listId: 'list-1',
        ingredientId: 'ingredient-1',
        quantityNeeded: 500,
        quantityInStock: 100,
        unit: Unit.G,
        checked: true,
      },
    ]);
    prisma.stock.upsert.mockResolvedValue({});
    prisma.shoppingItem.update.mockResolvedValue({});

    await service.validate('user-1', 'list-1');

    expect(prisma.stock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_ingredientId: {
            userId: 'user-1',
            ingredientId: 'ingredient-1',
          },
        },
        update: { quantity: { increment: 400 } },
      }),
    );
    expect(prisma.shoppingItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { purchasedQuantity: 400 },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.shoppingList.updateMany).toHaveBeenCalledWith({
      where: { id: 'list-1', validated: false },
      data: { validated: true },
    });
  });

  it('throws ConflictException when the atomic claim finds the list already validated', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.validate('user-1', 'list-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.shoppingItem.findMany).not.toHaveBeenCalled();
    expect(prisma.stock.upsert).not.toHaveBeenCalled();
  });

  // unvalidate() reverses exactly the stock that was added at validation time
  it('reverses the purchased quantity when unvalidating a list', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 1 });
    prisma.shoppingItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        listId: 'list-1',
        ingredientId: 'ingredient-1',
        purchasedQuantity: 400,
        unit: Unit.G,
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      userId: 'user-1',
      ingredientId: 'ingredient-1',
      quantity: 400,
      unit: Unit.G,
    });
    prisma.stock.update.mockResolvedValue({});
    prisma.shoppingItem.update.mockResolvedValue({});

    await service.unvalidate('user-1', 'list-1');

    expect(prisma.stock.delete).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
    });
    expect(prisma.stock.update).not.toHaveBeenCalled();
    expect(prisma.shoppingItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { purchasedQuantity: 0 },
    });
    expect(prisma.shoppingList.updateMany).toHaveBeenCalledWith({
      where: { id: 'list-1', validated: true },
      data: { validated: false },
    });
  });

  it('keeps the remaining stock when unvalidating only removes part of it', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 1 });
    prisma.shoppingItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        listId: 'list-1',
        ingredientId: 'ingredient-1',
        purchasedQuantity: 400,
        unit: Unit.G,
      },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      userId: 'user-1',
      ingredientId: 'ingredient-1',
      quantity: 700,
      unit: Unit.G,
    });
    prisma.stock.update.mockResolvedValue({});
    prisma.shoppingItem.update.mockResolvedValue({});

    await service.unvalidate('user-1', 'list-1');

    expect(prisma.stock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { quantity: 300, unit: Unit.G },
    });
    expect(prisma.stock.delete).not.toHaveBeenCalled();
  });

  it('throws ConflictException when the atomic claim finds the list not validated', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.unvalidate('user-1', 'list-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.shoppingItem.findMany).not.toHaveBeenCalled();
    expect(prisma.stock.update).not.toHaveBeenCalled();
  });
  // Équivalence de l'ingrédient : les cuillères se comptent en grammes.
  describe('generate() avec une équivalence poids/volume', () => {
    const period = {
      periodStart: new Date('2026-07-06'),
      periodEnd: new Date('2026-07-06'),
    };

    function mockWeek(
      lines: { quantity: number; unit: Unit }[],
      stock: { quantity: number; unit: Unit }[],
      gramsPerTablespoon: number | null,
    ) {
      prisma.calendarEntry.findMany.mockResolvedValue([
        {
          plannedDate: new Date('2026-07-06'),
          servings: 2,
          recipe: {
            servings: 2,
            title: 'Gâteau',
            recipeIngredients: lines.map((line) => ({
              ingredientId: 'ingredient-1',
              ...line,
            })),
          },
        },
      ]);
      prisma.stock.findMany.mockResolvedValue(
        stock.map((entry) => ({ ingredientId: 'ingredient-1', ...entry })),
      );
      prisma.ingredient.findMany.mockResolvedValue([
        {
          id: 'ingredient-1',
          name: 'Farine',
          defaultUnit: Unit.G,
          gramsPerTablespoon,
        },
      ]);
      prisma.shoppingList.create.mockImplementation(
        (args: { data: { items?: { create: unknown[] } } }) =>
          Promise.resolve({
            ...ownedList,
            items: args.data.items?.create ?? [],
          }),
      );
    }

    it('lists nothing when 500 g in stock cover one spoon of the recipe', async () => {
      mockWeek(
        [{ quantity: 1, unit: Unit.CUILLERE_A_SOUPE }],
        [{ quantity: 500, unit: Unit.G }],
        10,
      );

      const result = await service.generate('user-1', period);

      expect(result[0].items).toEqual([]);
    });

    it('adds spoons to the grams of the recipe and compares with the stock', async () => {
      mockWeek(
        [
          { quantity: 600, unit: Unit.G },
          { quantity: 3, unit: Unit.CUILLERE_A_SOUPE },
        ],
        [{ quantity: 500, unit: Unit.G }],
        10,
      );

      const result = await service.generate('user-1', period);

      expect(result[0].items).toEqual([
        {
          ingredientId: 'ingredient-1',
          quantityNeeded: 630,
          quantityInStock: 500,
          unit: Unit.G,
        },
      ]);
    });

    it('counts spoons with the universal fallback (15 g) when the ingredient has no equivalence', async () => {
      mockWeek([{ quantity: 2, unit: Unit.CUILLERE_A_SOUPE }], [], null);

      const result = await service.generate('user-1', period);

      expect(result[0].items).toEqual([
        {
          ingredientId: 'ingredient-1',
          quantityNeeded: 30,
          quantityInStock: 0,
          unit: Unit.G,
        },
      ]);
    });

    it('tells how to link weight and volume when the ingredient has no equivalence', async () => {
      mockWeek([{ quantity: 1, unit: Unit.CL }], [], null);

      await expect(service.generate('user-1', period)).rejects.toThrow(
        "renseigne l'équivalence de l'ingrédient dans le catalogue",
      );
    });
  });

  it('uses the ingredient equivalence to normalize a stock stored in ml when validating', async () => {
    prisma.shoppingList.updateMany.mockResolvedValue({ count: 1 });
    prisma.shoppingItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        listId: 'list-1',
        ingredientId: 'ingredient-1',
        quantityNeeded: 500,
        quantityInStock: 0,
        unit: Unit.G,
        checked: true,
      },
    ]);
    prisma.ingredient.findMany.mockResolvedValue([
      { id: 'ingredient-1', gramsPerTablespoon: 10 },
    ]);
    prisma.stock.findUnique.mockResolvedValue({
      id: 'stock-1',
      quantity: 15,
      unit: Unit.ML,
    });
    prisma.stock.update.mockResolvedValue({});
    prisma.shoppingItem.update.mockResolvedValue({});

    await service.validate('user-1', 'list-1');

    expect(prisma.stock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { quantity: 510, unit: Unit.G },
    });
  });
  // Une période de plusieurs semaines donne une liste par semaine.
  describe('generate() sur plusieurs semaines', () => {
    const start = new Date('2026-07-06');
    const end = new Date('2026-07-19');

    function mockTwoWeeks(stockQuantity: number | null) {
      prisma.calendarEntry.findMany.mockResolvedValue(
        Array.from({ length: 14 }, (_, day) => ({
          plannedDate: new Date(start.getTime() + day * 24 * 60 * 60 * 1000),
          servings: 2,
          recipe: {
            servings: 2,
            title: 'Gâteau',
            recipeIngredients: [
              { ingredientId: 'ingredient-1', quantity: 100, unit: Unit.G },
            ],
          },
        })),
      );
      prisma.stock.findMany.mockResolvedValue(
        stockQuantity === null
          ? []
          : [
              {
                ingredientId: 'ingredient-1',
                quantity: stockQuantity,
                unit: Unit.G,
              },
            ],
      );
      prisma.ingredient.findMany.mockResolvedValue([
        { id: 'ingredient-1', name: 'Farine', defaultUnit: Unit.G },
      ]);
      prisma.shoppingList.create.mockImplementation(
        (args: {
          data: {
            periodStart: Date;
            periodEnd: Date;
            items?: { create: unknown[] };
          };
        }) =>
          Promise.resolve({
            ...ownedList,
            periodStart: args.data.periodStart,
            periodEnd: args.data.periodEnd,
            items: args.data.items?.create ?? [],
          }),
      );
    }

    it('creates one list per week for a period over two weeks', async () => {
      mockTwoWeeks(null);

      const result = await service.generate('user-1', {
        periodStart: start,
        periodEnd: end,
      });

      expect(result).toHaveLength(2);
      expect(
        result.map((list) => [
          list.periodStart.toISOString().slice(0, 10),
          list.periodEnd.toISOString().slice(0, 10),
        ]),
      ).toEqual([
        ['2026-07-06', '2026-07-12'],
        ['2026-07-13', '2026-07-19'],
      ]);
      expect(result[0].items).toEqual([
        {
          ingredientId: 'ingredient-1',
          quantityNeeded: 700,
          quantityInStock: 0,
          unit: Unit.G,
        },
      ]);
      expect(result[1].items).toHaveLength(1);
    });

    it('uses the stock for the first week before the next ones', async () => {
      mockTwoWeeks(1000);

      const result = await service.generate('user-1', {
        periodStart: start,
        periodEnd: end,
      });

      // semaine 1 : 700 g couverts par 1000 g ; il reste 300 g pour la semaine 2
      expect(result[0].items).toEqual([]);
      expect(result[1].items).toEqual([
        {
          ingredientId: 'ingredient-1',
          quantityNeeded: 700,
          quantityInStock: 300,
          unit: Unit.G,
        },
      ]);
    });

    it('replaces a not validated list that covers the whole period', async () => {
      mockTwoWeeks(null);
      prisma.shoppingList.findFirst.mockImplementation(
        (args: { where: { periodStart?: unknown; periodEnd?: unknown } }) => {
          const { periodStart, periodEnd } = args.where;
          const isWholePeriod =
            periodStart instanceof Date &&
            periodEnd instanceof Date &&
            periodStart.getTime() === start.getTime() &&
            periodEnd.getTime() === end.getTime();
          return Promise.resolve(
            isWholePeriod ? { ...ownedList, id: 'legacy-list' } : null,
          );
        },
      );
      prisma.shoppingItem.deleteMany.mockResolvedValue({ count: 0 });
      prisma.shoppingList.delete.mockResolvedValue({});

      const result = await service.generate('user-1', {
        periodStart: start,
        periodEnd: end,
      });

      expect(prisma.shoppingList.delete).toHaveBeenCalledWith({
        where: { id: 'legacy-list' },
      });
      expect(result).toHaveLength(2);
    });

    it('refuses to regenerate when a week is already validated and creates nothing', async () => {
      mockTwoWeeks(null);
      prisma.shoppingList.findFirst.mockImplementation(
        (args: { where: { periodStart?: unknown } }) =>
          Promise.resolve(
            args.where.periodStart instanceof Date &&
              args.where.periodStart.getTime() ===
                new Date('2026-07-13').getTime()
              ? { ...ownedList, id: 'list-w2', validated: true }
              : null,
          ),
      );

      await expect(
        service.generate('user-1', { periodStart: start, periodEnd: end }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.shoppingList.create).not.toHaveBeenCalled();
    });
  });
});
