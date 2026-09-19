// 28 letters, 8 hamza/taa marbuta/alif maqsura forms, 5 punctuation marks, space: 42 symbols
export const ALPHA = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي" + "ءآأإؤئةى" + "،.؟!- ";
export const WALLS = 4;
export const SHELVES = 5;
export const BOOKS = 32;
export const PAGES = 410;
export const LINES = 40;
export const CHARS = 80;
export const PAGE_LENGTH = LINES * CHARS;
export const BOOK_LENGTH = PAGE_LENGTH * PAGES;

// GMP writes numbers in bases 37-62 with the digits 0-9, A-Z, a-z, in that order
export const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".slice(
  0,
  ALPHA.length
);
export const DIGITS_LAST = DIGITS[DIGITS.length - 1];

// Folds text a reader might type onto the 42 symbols above. Anything left
// outside ALPHA after this is dropped by the caller.
export function normaliseArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟـ]/g, "") // tashkeel, dagger alif, tatweel
    .replace(/ٱ/g, "ا") // alif wasla
    .replace(/ی/g, "ي") // Persian yeh
    .replace(/ک/g, "ك") // Persian kaf
    .replace(/ہ/g, "ه")
    .replace(/,/g, "،")
    .replace(/\?/g, "؟")
    .replace(/؛/g, "،") // Arabic semicolon
    .replace(/[–—_]/g, "-");
}
