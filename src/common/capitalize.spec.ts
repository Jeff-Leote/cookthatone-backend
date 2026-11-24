import { capitalizeFirst } from './capitalize';

describe('capitalizeFirst', () => {
  it.each([
    ['crêpes maison', 'Crêpes maison'],
    ['Ail', 'Ail'],
    ['éclair', 'Éclair'],
    ['œufs', 'Œufs'],
    ['ÿ', 'Ÿ'],
  ])('met la première lettre de %j en majuscule : %j', (input, expected) => {
    expect(capitalizeFirst(input)).toBe(expected);
  });

  it('laisse le reste du texte tel quel', () => {
    expect(capitalizeFirst('pâte à CRÊPES')).toBe('Pâte à CRÊPES');
    expect(capitalizeFirst('sauce BBQ')).toBe('Sauce BBQ');
  });

  it.each(['3 chocolats', '« Tarte »', '-x', '(sans sucre)'])(
    'ne change rien quand le texte commence par un chiffre ou un signe : %j',
    (input) => {
      expect(capitalizeFirst(input)).toBe(input);
    },
  );

  it('retire les espaces de début et de fin et réduit les espaces internes', () => {
    expect(capitalizeFirst('  crêpes   maison \t')).toBe('Crêpes maison');
    expect(capitalizeFirst('pâte\n\nà  crêpes')).toBe('Pâte à crêpes');
  });

  it('renvoie une chaîne vide pour une chaîne vide ou faite d’espaces', () => {
    expect(capitalizeFirst('')).toBe('');
    expect(capitalizeFirst('   \t ')).toBe('');
  });

  it('traite le premier point de code, pas la première unité UTF-16', () => {
    // Lettre déséret (U+10428) : deux unités UTF-16, majuscule U+10400.
    expect(capitalizeFirst('\u{10428}bc')).toBe('\u{10400}bc');
    // Emoji en première position : aucun changement, aucun plantage.
    expect(capitalizeFirst('😀 salade')).toBe('😀 salade');
    // Unité de substitution isolée : aucun plantage.
    expect(capitalizeFirst('\uD83Dx')).toBe('\uD83Dx');
  });

  it('n’élargit pas « ß » ni « ﬁ » (« SS » et « FI » en majuscule)', () => {
    expect(capitalizeFirst('ßa')).toBe('ßa');
    expect(capitalizeFirst('ﬁnale')).toBe('ﬁnale');
  });

  it('est idempotente', () => {
    const once = capitalizeFirst('  œufs   durs ');
    expect(capitalizeFirst(once)).toBe(once);
  });
});
