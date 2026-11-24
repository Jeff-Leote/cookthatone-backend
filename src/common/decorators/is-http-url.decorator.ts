import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';

export const HTTP_URL_MAX_LENGTH = 2048;

// `subject` permet de nommer le champ (« L'adresse de la source ») sans changer la règle.
export function httpUrlMessage(subject = "L'adresse"): string {
  return `${subject} doit être une URL http ou https valide, sans identifiants (${HTTP_URL_MAX_LENGTH} caractères au plus)`;
}

export const HTTP_URL_MESSAGE = httpUrlMessage();

// Le début doit être littéralement « http:// » ou « https:// » suivi d'un hôte :
// `new URL()` accepte des formes plus souples (« https:exemple.fr »,
// « https:///x ») qui, stockées telles quelles, ne seraient pas lues comme une
// adresse absolue dans un lien.
const HTTP_PREFIX = /^https?:\/\/[^/?#]/i;
// Espaces, antislash, « < », « > » et « " » : `new URL()` les tolère ou les
// réécrit, alors que la chaîne est enregistrée telle que saisie.
const FORBIDDEN_CHARS = /[\s\\<>"]/;
// Identifiants (« user:pass@ ») dans la partie autorité, avant le premier « / », « ? » ou « # ».
const CREDENTIALS = /^https?:\/\/[^/?#]*@/i;

// Caractères de contrôle (C0, DEL, C1), espaces de largeur nulle et contrôles de
// direction du texte : invisibles ou trompeurs à l'affichage. Testés par code
// plutôt que par expression régulière (la règle no-control-regex l'interdit).
function isInvisibleOrControl(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200d) ||
    (code >= 0x202a && code <= 0x202e) ||
    code === 0x2060 ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function hasInvisibleOrControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (isInvisibleOrControl(value.charCodeAt(i))) return true;
  }
  return false;
}

function isHttpUrl(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > HTTP_URL_MAX_LENGTH ||
    !HTTP_PREFIX.test(value) ||
    FORBIDDEN_CHARS.test(value) ||
    hasInvisibleOrControlChar(value) ||
    CREDENTIALS.test(value)
  ) {
    return false;
  }
  try {
    const { protocol, username, password } = new URL(value);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      username === '' &&
      password === ''
    );
  } catch {
    return false;
  }
}

// Retire les espaces de début et de fin, puis n'accepte qu'une adresse
// http(s) absolue, sans identifiants, de 2048 caractères au plus. La valeur
// n'est jamais réécrite (pas de `URL.href`). `null` est refusé : un champ
// effaçable le laisse passer avec `@IsOptional()`.
export function IsHttpUrl(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  const trim = Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );
  const validate: PropertyDecorator = (target, propertyName) => {
    registerDecorator({
      name: 'isHttpUrl',
      target: target.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isHttpUrl(value),
        defaultMessage: () => HTTP_URL_MESSAGE,
      },
    });
  };
  return applyDecorators(trim, validate);
}
