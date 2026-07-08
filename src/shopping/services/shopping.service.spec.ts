import { ConflictException } from '@nestjs/common';
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
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    shoppingItem: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    calendarEntry: { findMany: jest.Mock };
    stock: { findMany: jest.Mock; upsert: jest.Mock };
    ingredient: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const ownedList = {
    id: 'list-1',
    userId: 'user-1',
    weekStart: new Date('2026-07-06'),
    validated: false,
  };

  beforeEach(async () => {
    prisma = {
      shoppingList: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      shoppingItem: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      calendarEntry: { findMany: jest.fn() },
      stock: { findMany: jest.fn(), upsert: jest.fn() },
      ingredient: { findMany: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

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

  // T15: generate() stock insuffisant pour la semaine -> items avec qte manquante
  it('generates items for ingredients the stock does not fully cover', async () => {
    prisma.calendarEntry.findMany.mockResolvedValue([
      {
        recipe: {
          recipeIngredients: [{ ingredientId: 'ingredient-1', quantity: 500 }],
        },
      },
    ]);
    prisma.stock.findMany.mockResolvedValue([
      { ingredientId: 'ingredient-1', quantity: 100 },
    ]);
    prisma.ingredient.findMany.mockResolvedValue([
      { id: 'ingredient-1', defaultUnit: Unit.G },
    ]);
    prisma.shoppingList.create.mockImplementation(
      (args: { data: { items?: { create: unknown[] } } }) =>
        Promise.resolve({ ...ownedList, items: args.data.items?.create ?? [] }),
    );

    const result = await service.generate('user-1', {
      weekStart: new Date('2026-07-06'),
    });

    expect(result.items).toEqual([
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
        recipe: {
          recipeIngredients: [{ ingredientId: 'ingredient-1', quantity: 500 }],
        },
      },
    ]);
    prisma.stock.findMany.mockResolvedValue([
      { ingredientId: 'ingredient-1', quantity: 1000 },
    ]);
    prisma.ingredient.findMany.mockResolvedValue([
      { id: 'ingredient-1', defaultUnit: Unit.G },
    ]);
    prisma.shoppingList.create.mockImplementation(
      (args: { data: { items?: { create: unknown[] } } }) =>
        Promise.resolve({ ...ownedList, items: args.data.items?.create ?? [] }),
    );

    const result = await service.generate('user-1', {
      weekStart: new Date('2026-07-06'),
    });

    expect(result.items).toEqual([]);
  });

  // T17: validate() items coches -> $transaction + stock mis a jour
  it('validates checked items through a transaction and updates the stock', async () => {
    prisma.shoppingList.findUnique.mockResolvedValue({
      ...ownedList,
      items: [],
    });
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
    prisma.shoppingList.update.mockResolvedValue({
      ...ownedList,
      validated: true,
    });

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
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.shoppingList.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validated: true } }),
    );
  });

  it('throws ConflictException when validating an already-validated list', async () => {
    prisma.shoppingList.findUnique.mockResolvedValue({
      ...ownedList,
      validated: true,
    });

    await expect(service.validate('user-1', 'list-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.stock.upsert).not.toHaveBeenCalled();
  });
});
