/**
 * Spread onto every free-text <input> so browsers and password managers stay out of the way.
 *
 * Chrome ignores autocomplete="off" when its heuristics match a label like "name", "code",
 * "country" or "number", and then offers saved cards/addresses. An unrecognised autocomplete
 * token disables those heuristics for the field. The data-* flags opt out of the common
 * password managers (1Password, LastPass, Bitwarden, Dashlane).
 */
export const NO_AUTOFILL = {
  autoComplete: 'nofill',
  autoCorrect: 'off',
  spellcheck: false,
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;
