import { Test, TestingModule } from '@nestjs/testing';
import { ShoppingController } from './shopping.controller';
import { ShoppingService } from '../services/shopping.service';

describe('ShoppingController', () => {
  let controller: ShoppingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShoppingController],
      providers: [
        {
          provide: ShoppingService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            generate: jest.fn(),
            updateItemChecked: jest.fn(),
            validate: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ShoppingController>(ShoppingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
