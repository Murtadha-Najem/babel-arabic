/*
  Real texts found in the library, listed on /examples.

  Each example is a text file in src/examples plus an entry in index.json.
  Its location is not stored: it is searched for at startup, the same way
  the search page does in "empty book" mode, so it can never go stale.

  A text longer than one book is cut into volumes at line boundaries, and
  each volume is searched as a book of its own. The volumes land in
  unrelated rooms: the library has no notion that they belong together.
*/

import fs from "fs";
import path from "path";
import { GMPFunctions, mpz_ptr } from "gmp-wasm";
import { PAGE_LENGTH, PAGES, LINES, CHARS } from "./constants";
import { lookupContent } from "./babel";
import { getEmptyBookContent, sanitiseContent } from "./search";

const DIR = "./src/examples";
const BOOK_ROWS = PAGES * LINES;

type ExampleEntry = {
  slug: string;
  title: string;
  file: string;
  description: string;
  source: string;
  sourceUrl?: string;
};

export type Volume = {
  room: string;
  wall: string;
  shelf: string;
  book: string;
  lastPage: number;
  lastLine: number;
};

export type Example = ExampleEntry & {
  volumes: Volume[];
  characters: number;
};

// Splits lines into books, never breaking a line; a line takes one row per 80 characters
function splitIntoVolumes(lines: string[]): string[][] {
  const volumes: string[][] = [[]];
  let rows = 0;
  for (const line of lines) {
    const lineRows = Math.max(1, Math.ceil(line.length / CHARS));
    if (rows + lineRows > BOOK_ROWS) {
      volumes.push([]);
      rows = 0;
    }
    // a volume never opens on the blank line that separates chapters
    if (rows === 0 && line === "" && volumes.length > 1) continue;
    volumes[volumes.length - 1].push(line);
    rows += lineRows;
  }
  return volumes;
}

async function locate(
  binding: GMPFunctions,
  I: mpz_ptr,
  N: mpz_ptr,
  lines: string[]
): Promise<Volume> {
  const book = getEmptyBookContent(lines.join("\n"));
  const identifier = await lookupContent(binding, book, I, N, 1);
  const [room, wall, shelf, bookNumber] = identifier.split(".");

  const end = book.replace(/ +$/, "").length;
  const lastPage = Math.ceil(end / PAGE_LENGTH);

  return {
    room,
    wall,
    shelf,
    book: bookNumber,
    lastPage,
    lastLine: Math.ceil((end - (lastPage - 1) * PAGE_LENGTH) / CHARS),
  };
}

export async function loadExamples(
  binding: GMPFunctions,
  I: mpz_ptr,
  N: mpz_ptr
): Promise<Example[]> {
  const entries: ExampleEntry[] = JSON.parse(
    fs.readFileSync(path.join(DIR, "index.json"), "utf8")
  );

  const examples: Example[] = [];

  for (const entry of entries) {
    const text = sanitiseContent(
      fs.readFileSync(path.join(DIR, entry.file), "utf8")
    ).replace(/\r/g, "");

    const volumes: Volume[] = [];
    for (const lines of splitIntoVolumes(text.split("\n"))) {
      volumes.push(await locate(binding, I, N, lines));
    }

    examples.push({
      ...entry,
      volumes,
      characters: text.replace(/\n/g, "").length,
    });
  }

  return examples;
}
