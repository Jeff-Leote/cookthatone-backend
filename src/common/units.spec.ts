import { Unit } from '@prisma/client';
import {
  areUnitsCompatible,
  convertQuantity,
  incompatibleUnitMessage,
  isMassVolumePair,
  roundQuantity,
  unitLabel,
} from './units';

describe('units', () => {
  describe('convertQuantity', () => {
    it('converts between mass units', () => {
      expect(convertQuantity(1.5, Unit.KG, Unit.G)).toBe(1500);
      expect(convertQuantity(250, Unit.G, Unit.KG)).toBe(0.25);
    });

    it('converts between volume units including spoons and cups', () => {
      expect(convertQuantity(2, Unit.L, Unit.ML)).toBe(2000);
      expect(
        convertQuantity(3, Unit.CUILLERE_A_CAFE, Unit.CUILLERE_A_SOUPE),
      ).toBe(1);
      expect(convertQuantity(1, Unit.CUILLERE_A_SOUPE, Unit.ML)).toBe(15);
      expect(convertQuantity(0.5, Unit.TASSE, Unit.ML)).toBe(120);
    });

    it('returns the same quantity for the same unit', () => {
      expect(convertQuantity(7, Unit.PIECE, Unit.PIECE)).toBe(7);
    });

    it('returns null when the units have no equivalent', () => {
      expect(convertQuantity(100, Unit.G, Unit.ML)).toBeNull();
      expect(convertQuantity(2, Unit.CL, Unit.G)).toBeNull();
      expect(convertQuantity(1, Unit.PIECE, Unit.G)).toBeNull();
      expect(convertQuantity(1, Unit.PINCEE, Unit.CUILLERE_A_CAFE)).toBeNull();
    });

    it('rounds away floating-point leftovers', () => {
      expect(convertQuantity(0.1 + 0.2, Unit.G, Unit.G)).toBe(0.3);
    });
  });

  describe('areUnitsCompatible', () => {
    it('groups units by family', () => {
      expect(areUnitsCompatible(Unit.G, Unit.KG)).toBe(true);
      expect(areUnitsCompatible(Unit.ML, Unit.TASSE)).toBe(true);
      expect(areUnitsCompatible(Unit.G, Unit.ML)).toBe(false);
      expect(areUnitsCompatible(Unit.PIECE, Unit.PINCEE)).toBe(false);
    });
  });

  it('labels units in French', () => {
    expect(unitLabel(Unit.CUILLERE_A_SOUPE)).toBe('c. à soupe');
    expect(unitLabel(Unit.KG)).toBe('kg');
  });

  it('roundQuantity keeps three decimals', () => {
    expect(roundQuantity(1.23456)).toBe(1.235);
  });
  describe('cl', () => {
    it('is worth 10 ml', () => {
      expect(convertQuantity(25, Unit.CL, Unit.ML)).toBe(250);
      expect(convertQuantity(100, Unit.CL, Unit.L)).toBe(1);
      expect(unitLabel(Unit.CL)).toBe('cl');
    });
  });

  // Équivalence de l'ingrédient : poids d'une cuillère à soupe (15 ml).
  describe('weight and volume through the ingredient equivalence', () => {
    const flour = 10; // 1 c. à soupe de farine ≈ 10 g

    it('converts spoons to grams and back', () => {
      expect(convertQuantity(1, Unit.CUILLERE_A_SOUPE, Unit.G, flour)).toBe(10);
      expect(convertQuantity(3, Unit.CUILLERE_A_CAFE, Unit.G, flour)).toBe(10);
      expect(convertQuantity(30, Unit.G, Unit.CUILLERE_A_SOUPE, flour)).toBe(3);
      expect(convertQuantity(1, Unit.KG, Unit.CUILLERE_A_SOUPE, flour)).toBe(
        100,
      );
    });

    it('converts millilitres and cl to grams', () => {
      expect(convertQuantity(15, Unit.ML, Unit.G, flour)).toBe(10);
      expect(convertQuantity(3, Unit.CL, Unit.G, flour)).toBe(20);
      expect(convertQuantity(150, Unit.G, Unit.ML, flour)).toBe(225);
    });

    it('refuses weight and volume (except spoons) without equivalence', () => {
      expect(convertQuantity(1, Unit.CL, Unit.G)).toBeNull();
      expect(convertQuantity(1, Unit.TASSE, Unit.G, null)).toBeNull();
      expect(areUnitsCompatible(Unit.G, Unit.ML)).toBe(false);
      expect(areUnitsCompatible(Unit.G, Unit.ML, flour)).toBe(true);
    });

    it('never links pieces or pinches to weight, even with an equivalence', () => {
      expect(convertQuantity(1, Unit.PIECE, Unit.G, flour)).toBeNull();
      expect(convertQuantity(1, Unit.PINCEE, Unit.ML, flour)).toBeNull();
    });

    it('detects a mass/volume pair', () => {
      expect(isMassVolumePair(Unit.G, Unit.CUILLERE_A_CAFE)).toBe(true);
      expect(isMassVolumePair(Unit.G, Unit.KG)).toBe(false);
      expect(isMassVolumePair(Unit.PIECE, Unit.G)).toBe(false);
    });
  });

  describe('grammes et litres en cuillères', () => {
    it('convertit les litres en cuillères sans équivalence (volume universel)', () => {
      expect(convertQuantity(0.15, Unit.L, Unit.CUILLERE_A_SOUPE)).toBe(10);
      expect(convertQuantity(0.25, Unit.L, Unit.CUILLERE_A_CAFE)).toBe(50);
      expect(convertQuantity(2, Unit.CUILLERE_A_SOUPE, Unit.L)).toBe(0.03);
    });

    it('convertit les grammes en cuillères à soupe et à café avec le poids de l’ingrédient', () => {
      expect(convertQuantity(30, Unit.G, Unit.CUILLERE_A_SOUPE, 10)).toBe(3);
      expect(convertQuantity(10, Unit.G, Unit.CUILLERE_A_CAFE, 10)).toBe(3);
    });
  });

  describe('incompatibleUnitMessage', () => {
    it('explains how to unlock spoons for a weight ingredient', () => {
      expect(
        incompatibleUnitMessage(Unit.CUILLERE_A_SOUPE, 'Farine', Unit.G),
      ).toBe(
        "L'unité c. à soupe n'est pas compatible avec « Farine » (g) : renseigne d'abord son équivalence (poids d'une cuillère à soupe) dans le catalogue d'ingrédients",
      );
    });

    it('stays plain when no equivalence could help', () => {
      expect(incompatibleUnitMessage(Unit.PIECE, 'Farine', Unit.G)).toBe(
        "L'unité pièce n'est pas compatible avec « Farine » (g)",
      );
    });
  });
  describe('repli universel des cuillères (1 g = 1 ml)', () => {
    it('compte une cuillère à soupe pour 15 g et une cuillère à café pour 5 g', () => {
      expect(convertQuantity(2, Unit.CUILLERE_A_SOUPE, Unit.G)).toBe(30);
      expect(convertQuantity(3, Unit.CUILLERE_A_CAFE, Unit.G, null)).toBe(15);
      expect(convertQuantity(30, Unit.G, Unit.CUILLERE_A_SOUPE)).toBe(2);
      expect(convertQuantity(1, Unit.KG, Unit.CUILLERE_A_CAFE)).toBe(200);
    });

    it('laisse le poids propre à l’ingrédient passer avant le repli', () => {
      expect(convertQuantity(1, Unit.CUILLERE_A_SOUPE, Unit.G, 10)).toBe(10);
    });

    it('ne couvre pas les autres volumes ni les pincées', () => {
      expect(areUnitsCompatible(Unit.CUILLERE_A_SOUPE, Unit.G)).toBe(true);
      expect(areUnitsCompatible(Unit.TASSE, Unit.G)).toBe(false);
      expect(areUnitsCompatible(Unit.PINCEE, Unit.CUILLERE_A_CAFE)).toBe(false);
    });
  });
});
