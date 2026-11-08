import { Unit } from '@prisma/client';

type UnitFamily = 'MASS' | 'VOLUME' | 'PIECE' | 'PINCH';

interface UnitDefinition {
  family: UnitFamily;
  // Facteur vers l'unité de base de la famille (g pour la masse, ml pour le
  // volume) ; la pièce et la pincée n'ont pas d'équivalent dans une autre unité.
  factor: number;
  label: string;
}

// Volumes standard : 1 c. à soupe = 15 ml, 1 c. à café = 5 ml, 1 cl = 10 ml.
// La tasse varie selon les pays (240 ml au Québec et aux États-Unis, 250 ml
// en France) : 240 ml est un choix documenté dans le ticket des unités.
const UNIT_DEFINITIONS: Record<Unit, UnitDefinition> = {
  G: { family: 'MASS', factor: 1, label: 'g' },
  KG: { family: 'MASS', factor: 1000, label: 'kg' },
  ML: { family: 'VOLUME', factor: 1, label: 'ml' },
  CL: { family: 'VOLUME', factor: 10, label: 'cl' },
  L: { family: 'VOLUME', factor: 1000, label: 'l' },
  CUILLERE_A_SOUPE: { family: 'VOLUME', factor: 15, label: 'c. à soupe' },
  CUILLERE_A_CAFE: { family: 'VOLUME', factor: 5, label: 'c. à café' },
  TASSE: { family: 'VOLUME', factor: 240, label: 'tasse' },
  PIECE: { family: 'PIECE', factor: 1, label: 'pièce' },
  PINCEE: { family: 'PINCH', factor: 1, label: 'pincée' },
};

const ML_PER_TABLESPOON = 15;

export function unitLabel(unit: Unit): string {
  return UNIT_DEFINITIONS[unit].label;
}

// Repli universel quand l'ingrédient n'a pas son propre poids de cuillère :
// 1 g = 1 ml (l'eau), donc 15 g la cuillère à soupe. Il ne vaut que pour les
// cuillères ; g et ml, cl, l ou tasse restent liés par l'équivalence seule.
export const DEFAULT_GRAMS_PER_TABLESPOON = 15;

function hasEquivalence(gramsPerTablespoon?: number | null): boolean {
  return gramsPerTablespoon != null && gramsPerTablespoon > 0;
}

function isSpoon(unit: Unit): boolean {
  return unit === Unit.CUILLERE_A_SOUPE || unit === Unit.CUILLERE_A_CAFE;
}

// Poids d'une cuillère à soupe à appliquer entre deux unités de familles
// différentes : celui de l'ingrédient, sinon le repli pour les cuillères, sinon
// aucun (la conversion est alors impossible).
function effectiveEquivalence(
  a: Unit,
  b: Unit,
  gramsPerTablespoon?: number | null,
): number | null {
  if (hasEquivalence(gramsPerTablespoon)) return gramsPerTablespoon as number;
  return isSpoon(a) || isSpoon(b) ? DEFAULT_GRAMS_PER_TABLESPOON : null;
}

// Poids et volume sont liés par l'équivalence propre à l'ingrédient (poids d'une
// cuillère à soupe) ; sans elle, seules les cuillères se comptent en grammes.
export function isMassVolumePair(a: Unit, b: Unit): boolean {
  const families = [UNIT_DEFINITIONS[a].family, UNIT_DEFINITIONS[b].family];
  return families.includes('MASS') && families.includes('VOLUME');
}

export function areUnitsCompatible(
  a: Unit,
  b: Unit,
  gramsPerTablespoon?: number | null,
): boolean {
  if (UNIT_DEFINITIONS[a].family === UNIT_DEFINITIONS[b].family) return true;
  return (
    isMassVolumePair(a, b) &&
    effectiveEquivalence(a, b, gramsPerTablespoon) !== null
  );
}

// Évite les restes de calcul flottant (0,1 + 0,2) dans les totaux affichés.
export function roundQuantity(quantity: number): number {
  return Math.round(quantity * 1000) / 1000;
}

// Retourne null quand les deux unités n'ont aucun équivalent (grammes et ml
// sans équivalence d'ingrédient, pièces et grammes) : l'appelant
// décide de refuser ou de signaler, jamais d'additionner des quantités sans
// rapport.
export function convertQuantity(
  quantity: number,
  from: Unit,
  to: Unit,
  gramsPerTablespoon?: number | null,
): number | null {
  if (!areUnitsCompatible(from, to, gramsPerTablespoon)) return null;
  const source = UNIT_DEFINITIONS[from];
  const target = UNIT_DEFINITIONS[to];
  let base = quantity * source.factor;
  if (source.family !== target.family) {
    const gramsPerMl =
      (effectiveEquivalence(from, to, gramsPerTablespoon) as number) /
      ML_PER_TABLESPOON;
    base = source.family === 'MASS' ? base / gramsPerMl : base * gramsPerMl;
  }
  return roundQuantity(base / target.factor);
}

// Message commun aux refus d'unité : explique l'équivalence quand c'est elle
// qui manque.
export function incompatibleUnitMessage(
  unit: Unit,
  ingredientName: string,
  ingredientUnit: Unit,
): string {
  const base = `L'unité ${unitLabel(unit)} n'est pas compatible avec « ${ingredientName} » (${unitLabel(ingredientUnit)})`;
  return isMassVolumePair(unit, ingredientUnit)
    ? `${base} : renseigne d'abord son équivalence (poids d'une cuillère à soupe) dans le catalogue d'ingrédients`
    : base;
}
