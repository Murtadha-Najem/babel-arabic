/*
  babel.ts
  Tom Snelling 2023-2024
  A complete Library of Babel in ~300 LOC
*/

import { GMPFunctions, mpz_ptr } from "gmp-wasm";
import {
  ALPHA,
  WALLS,
  SHELVES,
  BOOKS,
  PAGES,
  BOOK_LENGTH,
  PAGE_LENGTH,
  DIGITS,
} from "./constants";

/*
  Pre-compute content char <-> GMP digit maps. JS toString() stops at base 36,
  so the digits come from GMP's own alphabet instead.
*/
const NUM_MAP = ALPHA.split("").reduce((acc, char, index) => {
  acc[DIGITS[index]] = char;
  return acc;
}, {} as Record<string, string>);

const CHAR_MAP = ALPHA.split("").reduce((acc, char, index) => {
  acc[char] = DIGITS[index];
  return acc;
}, {} as Record<string, string>);

/*
  Get a sequential book index from an identifier in the format `1.1.1.1.1`.
*/
async function getSequentialContentNumberFromIdentifier(
  binding: GMPFunctions,
  identifier: string
): Promise<{ seqNumber: mpz_ptr; page: number }> {
  const [room, wall, shelf, book, page] = identifier.split(".");

  const intRoom = binding.mpz_t();
  binding.mpz_init(intRoom);
  binding.mpz_set_string(intRoom, room, 32);

  if (binding.mpz_cmp_ui(intRoom, 1) < 0) {
    throw new Error("رقم الغرفة لا يمكن أن يكون أصغر من 1.");
  }

  const totalRooms = binding.mpz_t();
  binding.mpz_init(totalRooms);
  binding.mpz_set_ui(totalRooms, ALPHA.length);
  binding.mpz_pow_ui(totalRooms, totalRooms, BOOK_LENGTH);
  binding.mpz_tdiv_q_ui(totalRooms, totalRooms, BOOKS * SHELVES * WALLS);

  if (binding.mpz_cmp(intRoom, totalRooms) > 0) {
    throw new Error("رقم الغرفة أكبر من عدد غرف المكتبة.");
  }

  const parsedWall = Number(wall);
  if (parsedWall < 1 || parsedWall > WALLS) {
    throw new Error("رقم الجدار يجب أن يكون بين 1 و4.");
  }

  const parsedShelf = Number(shelf);
  if (parsedShelf < 1 || parsedShelf > SHELVES) {
    throw new Error("رقم الرف يجب أن يكون بين 1 و5.");
  }

  const parsedBook = Number(book);
  if (parsedBook < 1 || parsedBook > BOOKS) {
    throw new Error("رقم الكتاب يجب أن يكون بين 1 و32.");
  }

  const parsedPage = Number(page);
  if (parsedPage < 1 || parsedPage > PAGES) {
    throw new Error("رقم الصفحة يجب أن يكون بين 1 و410.");
  }

  const pBooks = parsedBook;
  const pShelves = (parsedShelf - 1) * BOOKS;
  const pWalls = (parsedWall - 1) * SHELVES * BOOKS;

  const pRooms = binding.mpz_t();
  binding.mpz_init(pRooms);
  binding.mpz_sub_ui(pRooms, intRoom, 1);
  binding.mpz_mul_ui(pRooms, pRooms, WALLS * SHELVES * BOOKS);

  const seqNumber = binding.mpz_t();
  binding.mpz_init(seqNumber);
  binding.mpz_add_ui(seqNumber, pRooms, pWalls + pShelves + pBooks);

  binding.mpz_clears(intRoom, totalRooms, pRooms);

  return { seqNumber, page: parsedPage };
}

/*
  Get an identifier in the format `1.1.1.1.1` from a sequential book index.
*/
async function getIdentifierFromSequentialContentNumber(
  binding: GMPFunctions,
  seqNumber: mpz_ptr,
  page: number
): Promise<string> {
  binding.mpz_sub_ui(seqNumber, seqNumber, 1);

  if (binding.mpz_sgn(seqNumber) === -1) {
    return "1.1.1.1.1";
  }

  const room = binding.mpz_t();
  binding.mpz_init(room);
  binding.mpz_tdiv_q_ui(room, seqNumber, WALLS * SHELVES * BOOKS);
  binding.mpz_add_ui(room, room, 1);
  binding.mpz_mod_ui(seqNumber, seqNumber, WALLS * SHELVES * BOOKS);

  const wall = binding.mpz_t();
  binding.mpz_init(wall);
  binding.mpz_tdiv_q_ui(wall, seqNumber, SHELVES * BOOKS);
  binding.mpz_add_ui(wall, wall, 1);
  binding.mpz_mod_ui(seqNumber, seqNumber, SHELVES * BOOKS);

  const shelf = binding.mpz_t();
  binding.mpz_init(shelf);
  binding.mpz_tdiv_q_ui(shelf, seqNumber, BOOKS);
  binding.mpz_add_ui(shelf, shelf, 1);
  binding.mpz_mod_ui(seqNumber, seqNumber, BOOKS);

  binding.mpz_add_ui(seqNumber, seqNumber, 1);

  const roomString = binding.mpz_to_string(room, 32);
  const wallString = binding.mpz_to_string(wall, 10);
  const shelfString = binding.mpz_to_string(shelf, 10);
  const bookString = binding.mpz_to_string(seqNumber, 10);

  binding.mpz_clears(room, wall, shelf);

  return [roomString, wallString, shelfString, bookString, page].join(".");
}

/*
  Given a page identifier, determine the book index of that identifier and then
  calculate the resulting book contents via modular multiplication.
*/
type BookResponse = {
  content: string;
  roomShort: string;
  room: string;
  wall: string;
  shelf: string;
  book: string;
};

type PageResponse = BookResponse & {
  page: string;
  nextIdentifier: string;
  prevIdentifier: string;
};

type ContentResponse<T> = T extends true
  ? BookResponse
  : T extends false
  ? PageResponse
  : never;

export async function generateContent<T extends boolean>(
  binding: GMPFunctions,
  identifier: string,
  C: mpz_ptr,
  N: mpz_ptr,
  wholeBook: T
): Promise<ContentResponse<T>> {
  const { seqNumber, page } = await getSequentialContentNumberFromIdentifier(
    binding,
    identifier
  );

  const result = binding.mpz_t();
  binding.mpz_init(result);
  binding.mpz_mul(result, C, seqNumber);
  binding.mpz_mod(result, result, N);

  let hash = binding.mpz_to_string(result, ALPHA.length);

  binding.mpz_clear(result);

  const paddingRequired = BOOK_LENGTH - hash.length;
  if (paddingRequired > 0) {
    const padding = new Array(paddingRequired).fill("0").join("");
    hash = padding + hash;
  }

  const start = wholeBook ? 0 : (page - 1) * PAGE_LENGTH;
  const end = wholeBook ? BOOK_LENGTH : start + PAGE_LENGTH;

  const contentArr = new Array(end - start);

  for (let i = 0; i < contentArr.length; i++) {
    const char = hash[start + i];
    contentArr[i] = NUM_MAP[char];
  }

  const content = contentArr.join("");

  const [room, wall, shelf, book] = identifier.split(".");

  let roomShort;
  if (room.length > 16) {
    const firstEight = room.slice(0, 8);
    const lastEight = room.slice(-8);
    roomShort = `${firstEight}...${lastEight}`;
  } else {
    roomShort = room;
  }

  if (wholeBook) {
    return {
      content,
      roomShort,
      room,
      wall,
      shelf,
      book,
    } as ContentResponse<T>;
  }

  const nextSeqNumber = binding.mpz_t();
  binding.mpz_init(nextSeqNumber);
  binding.mpz_set(nextSeqNumber, seqNumber);
  let nextPage = page;

  if (nextPage === PAGES) {
    binding.mpz_add_ui(nextSeqNumber, nextSeqNumber, 1);
    nextPage = 1;
  } else {
    nextPage++;
  }

  const nextIdentifier = await getIdentifierFromSequentialContentNumber(
    binding,
    nextSeqNumber,
    nextPage
  );

  const prevSeqNumber = binding.mpz_t();
  binding.mpz_init(prevSeqNumber);
  binding.mpz_set(prevSeqNumber, seqNumber);
  let prevPage = page;

  if (prevPage === 1) {
    binding.mpz_sub_ui(prevSeqNumber, prevSeqNumber, 1);
    prevPage = 410;
  } else {
    prevPage--;
  }

  const prevIdentifier = await getIdentifierFromSequentialContentNumber(
    binding,
    prevSeqNumber,
    prevPage
  );

  binding.mpz_clears(seqNumber, nextSeqNumber, prevSeqNumber);

  return {
    content,
    roomShort,
    room,
    wall,
    shelf,
    book,
    page: page.toString(),
    nextIdentifier,
    prevIdentifier,
  } as ContentResponse<T>;
}

/*
  Given some content as a string, pad that string to BOOK_LENGTH, transform it
  into a base-32 'hash', and calculate it's book index via modular
  multiplication.
*/
export async function lookupContent(
  binding: GMPFunctions,
  content: string,
  I: mpz_ptr,
  N: mpz_ptr,
  page: number
): Promise<string> {
  const hash = new Array(BOOK_LENGTH).fill(CHAR_MAP[" "]);

  for (let i = 0; i < content.length; i++) {
    hash[i] = CHAR_MAP[content[i]] ?? CHAR_MAP[" "];
  }

  const seqNumber = binding.mpz_t();
  binding.mpz_init(seqNumber);
  binding.mpz_set_string(seqNumber, hash.join(""), ALPHA.length);
  binding.mpz_mul(seqNumber, seqNumber, I);
  binding.mpz_mod(seqNumber, seqNumber, N);

  const identifier = await getIdentifierFromSequentialContentNumber(
    binding,
    seqNumber,
    page
  );

  binding.mpz_clear(seqNumber);

  return identifier;
}

/*
  Generate and return a random page identifier.
*/
export async function getRandomIdentifier(
  binding: GMPFunctions
): Promise<string> {
  const randState = 0;
  binding.gmp_randinit_default(randState);
  binding.gmp_randseed_ui(randState, Date.now());

  const randomSeqNumber = binding.mpz_t();
  binding.mpz_init(randomSeqNumber);

  const uniqueBooks = binding.mpz_t();
  binding.mpz_init(uniqueBooks);
  binding.mpz_set_ui(uniqueBooks, ALPHA.length);
  binding.mpz_pow_ui(uniqueBooks, uniqueBooks, BOOK_LENGTH);

  binding.mpz_urandomm(randomSeqNumber, randState, uniqueBooks);
  binding.mpz_add_ui(randomSeqNumber, randomSeqNumber, 1);

  const randomPage = Math.floor(Math.random() * PAGES + 1);

  const identifier = await getIdentifierFromSequentialContentNumber(
    binding,
    randomSeqNumber,
    randomPage
  );

  binding.mpz_clears(randomSeqNumber, uniqueBooks);

  return identifier;
}

/*
  Initialise the mpz_t constants from the text of the `numbers` file.
*/
export async function initialiseNumbers(
  binding: GMPFunctions,
  nums: string
): Promise<{
  N: mpz_ptr;
  C: mpz_ptr;
  I: mpz_ptr;
}> {
  const [N_STR, C_STR, I_STR] = nums.split("\n");

  const N = binding.mpz_t();
  binding.mpz_init(N);
  binding.mpz_set_string(N, N_STR, ALPHA.length);

  const C = binding.mpz_t();
  binding.mpz_init(C);
  binding.mpz_set_string(C, C_STR, ALPHA.length);

  const I = binding.mpz_t();
  binding.mpz_init(I);
  binding.mpz_set_string(I, I_STR, ALPHA.length);

  return { N, C, I };
}
