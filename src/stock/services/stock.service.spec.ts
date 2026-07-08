import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { StockService } from './stock.service';

describe('StockService', () => {
  let service: StockService;
  let prisma: {
    stock: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const ownedStock = {
    id: 'stock-1',
    userId: 'user-1',
    ingredientId: 'ingredient-1',
    quantity: 500,
    unit: Unit.G,
    expiresAt: null,
  };

  beforeEach(async () => {
    prisma = {
      stock: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StockService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<StockService>(StockService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('lists the stock of the given user', async () => {
    prisma.stock.findMany.mockResolvedValue([ownedStock]);

    const result = await service.findAll('user-1', {});

    expect(result).toEqual([ownedStock]);
    expect(prisma.stock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('filters to items expiring soon', async () => {
    let capturedWhere: { expiresAt?: { not: null; lte: Date } } | undefined;
    prisma.stock.findMany.mockImplementation(
      (args: { where: { expiresAt?: { not: null; lte: Date } } }) => {
        capturedWhere = args.where;
        return Promise.resolve([ownedStock]);
      },
    );

    await service.findAll('user-1', { expiringSoon: true });

    expect(capturedWhere?.expiresAt?.not).toBeNull();
    expect(capturedWhere?.expiresAt?.lte).toBeInstanceOf(Date);
  });

  it('creates a new stock entry', async () => {
    prisma.stock.create.mockResolvedValue(ownedStock);

    const result = await service.create('user-1', {
      ingredientId: 'ingredient-1',
      quantity: 500,
      unit: Unit.G,
    });

    expect(result).toEqual(ownedStock);
  });

  it('throws ConflictException when the ingredient is already in stock', async () => {
    prisma.stock.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );

    await expect(
      service.create('user-1', {
        ingredientId: 'ingredient-1',
        quantity: 500,
        unit: Unit.G,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates an owned stock entry', async () => {
    prisma.stock.findUnique.mockResolvedValue(ownedStock);
    prisma.stock.update.mockResolvedValue({ ...ownedStock, quantity: 250 });

    const result = await service.update('user-1', 'stock-1', { quantity: 250 });

    expect(result.quantity).toBe(250);
  });

  it('throws ForbiddenException when updating a stock entry owned by another user', async () => {
    prisma.stock.findUnique.mockResolvedValue({
      ...ownedStock,
      userId: 'someone-else',
    });

    await expect(
      service.update('user-1', 'stock-1', { quantity: 250 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.stock.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when removing a missing stock entry', async () => {
    prisma.stock.findUnique.mockResolvedValue(null);

    await expect(service.remove('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('removes an owned stock entry', async () => {
    prisma.stock.findUnique.mockResolvedValue(ownedStock);
    prisma.stock.delete.mockResolvedValue(ownedStock);

    await service.remove('user-1', 'stock-1');

    expect(prisma.stock.delete).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
    });
  });
});
