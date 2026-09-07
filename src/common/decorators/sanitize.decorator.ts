import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

// Retire tout balisage HTML des champs texte libres (titre, description,
// instruction...) avant que la valeur n'atteigne la validation puis la base :
// aucune fonctionnalité du projet n'a besoin de stocker du HTML, donc on ne
// laisse jamais passer <script>, onerror=, etc. plutôt que de les échapper
// seulement à l'affichage.
export function Sanitize(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string'
      ? sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()
      : value,
  );
}
