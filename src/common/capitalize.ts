// Règle de casse des titres de recette et des noms d'ingrédient : espaces
// normalisés, première lettre en majuscule, reste du texte inchangé (un nom
// propre ou un sigle n'est jamais mis en minuscule). Utilisée par le décorateur
// `@Capitalize()` ; destinée aussi à l'import de recette par URL.
export function capitalizeFirst(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text === '') {
    return text;
  }
  // Premier point de code, pas premier octet : un caractère hors plan de base
  // occupe deux unités UTF-16.
  const first = String.fromCodePoint(text.codePointAt(0) as number);
  const upper = first.toLocaleUpperCase('fr');
  // « ß » donnerait « SS » et « ﬁ » « FI » : on ne modifie pas le texte saisi
  // quand la majuscule s'écrit avec plusieurs caractères.
  if (Array.from(upper).length !== 1) {
    return text;
  }
  return upper + text.slice(first.length);
}
