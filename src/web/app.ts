/*
  The library in the visitor's browser.

  GitHub Pages serves files and runs nothing, so every book is computed here:
  gmp-wasm does the arithmetic, the constants come from data/numbers.txt,
  and each page names its role in <body data-page="...">.

  A page of the library is addressed in the URL fragment of page.html:
    #1.2.3.4.5                  a room short enough to write out
    #@<key>.2.3.4.5             a room kept in this browser's IndexedDB
    #x-<slug>-<v>.2.3.4.5       volume <v> of an example (data/rooms/)
    #random                     a random page
  followed optionally by ~<startLine:startCol:endLine:endCol> to highlight
  the searched text, and !pdf to download the whole book.

  Rooms run to 1.4 million characters, too long for a link, so a room a
  visitor reaches by search or at random lives on their device only. To
  share a page they download its bookmark or its full address.
*/

import { init as gmpInit, GMPFunctions, mpz_ptr } from "gmp-wasm";
import { CHARS, LINES, PAGES } from "../constants";
import { initialiseNumbers, generateContent, lookupContent, getRandomIdentifier } from "../babel";
import {
  sanitiseContent,
  setPopularWords,
  getEmptyBookContent,
  getEmptyPageBookContent,
  getRandomCharsBookContent,
  getRandomWordsBookContent,
} from "../search";

const MAX_CHARS = PAGES * LINES * CHARS;
const SHORT_ROOM = 64;

/* ---------- the engine, loaded once per tab ---------- */

type Engine = { binding: GMPFunctions; N: mpz_ptr; C: mpz_ptr; I: mpz_ptr };
let engine: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  engine ??= (async () => {
    const [{ binding }, numbers] = await Promise.all([
      gmpInit(),
      fetch("data/numbers.txt").then((r) => r.text()),
    ]);
    const { N, C, I } = await initialiseNumbers(binding, numbers);
    return { binding, N, C, I };
  })();
  return engine;
}

/* ---------- rooms kept on this device ---------- */

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("babel", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("rooms");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction("rooms", mode).objectStore("rooms");
  return new Promise((resolve, reject) => {
    const req = run(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function keyOf(room: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(room));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

const exampleRooms = new Map<string, Promise<string>>();

// The token that stands for a room in a link
async function tokenFor(room: string): Promise<string> {
  room = room.replace(/^0+(?=.)/, "");
  if (room.length <= SHORT_ROOM) return room;
  const key = await keyOf(room);
  await idb("readwrite", (s) => s.put(room, key));
  return "@" + key;
}

async function roomFor(token: string): Promise<string> {
  if (token.startsWith("@")) {
    const room = await idb<string | undefined>("readonly", (s) => s.get(token.slice(1)));
    if (!room) throw new Error("هذا الرابط محفوظ في متصفح آخر. افتح الصفحة من ملف علامتها، أو من عنوانها الكامل.");
    return room;
  }
  if (token.startsWith("x-")) {
    if (!exampleRooms.has(token)) {
      exampleRooms.set(token, fetch(`data/rooms/${token.slice(2)}.txt`).then((r) => {
        if (!r.ok) throw new Error("لا يوجد مثال بهذا الاسم.");
        return r.text().then((t) => t.trim());
      }));
    }
    return exampleRooms.get(token) as Promise<string>;
  }
  if (!/^[0-9a-v]+$/.test(token)) throw new Error("رقم الغرفة يُكتب بالأرقام من 0 إلى 9 والحروف اللاتينية من a إلى v.");
  return token;
}

/* ---------- bookmark files: | page | page | book | shelf | wall | room bytes ... | ---------- */

const B32 = "0123456789abcdefghijklmnopqrstuv";

function roomToBytes(room: string): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = room.length - 1; i >= 0; i--) {
    acc |= B32.indexOf(room[i]) << bits;
    bits += 5;
    while (bits >= 8) {
      bytes.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  }
  if (bits > 0 && acc) bytes.push(acc);
  while (bytes.length > 1 && bytes[bytes.length - 1] === 0) bytes.pop();
  return Uint8Array.from(bytes.reverse());
}

function bytesToRoom(bytes: Uint8Array): string {
  const digits: string[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = bytes.length - 1; i >= 0; i--) {
    acc |= bytes[i] << bits;
    bits += 8;
    while (bits >= 5) {
      digits.push(B32[acc & 31]);
      acc >>>= 5;
      bits -= 5;
    }
  }
  if (bits > 0) digits.push(B32[acc & 31]);
  return digits.reverse().join("").replace(/^0+(?=.)/, "");
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const pageHref = (token: string, rest: (string | number)[], extra = "") =>
  `page.html#${[token, ...rest].join(".")}${extra}`;

/* ---------- page.html: one page of one book ---------- */

function initPage() {
  const info = document.querySelector(".PageInfo p") as HTMLElement;
  const pre = document.querySelector(".PageContent pre") as HTMLElement;
  const prev = document.querySelector(".PageNavigation .Prev") as HTMLAnchorElement;
  const next = document.querySelector(".PageNavigation .Next") as HTMLAnchorElement;
  const select = document.querySelector(".PageNavigation select") as HTMLSelectElement;
  const status = document.querySelector(".PageStatus") as HTMLElement;
  let current: { token: string; room: string; wall: string; shelf: string; book: string; page: string } | null = null;

  const show = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("Error", error);
    status.hidden = !message;
  };

  async function render() {
    let hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) hash = "1.1.1.1.1";
    const { binding, C, N } = await loadEngine().catch(() => {
      throw new Error("تعذر تحميل المكتبة. تأكد من اتصالك وأعد تحميل الصفحة.");
    });

    if (hash === "random") {
      const identifier = await getRandomIdentifier(binding);
      const [room, ...rest] = identifier.split(".");
      location.replace(pageHref(await tokenFor(room), rest));
      return;
    }

    const wantPdf = hash.endsWith("!pdf");
    hash = hash.replace(/!pdf$/, "");
    const [ref, highlight] = hash.split("~");
    const [token, wall, shelf, book, page] = ref.split(".");
    const room = await roomFor(token);

    const result = await generateContent(binding, [room, wall, shelf, book, page].join("."), C, N, false);
    current = { token, room, wall, shelf, book, page: result.page };

    const lines = result.content.match(new RegExp(`.{${CHARS}}`, "g")) as string[];
    pre.textContent = lines.join("\n");
    delete pre.dataset.text;
    if (highlight) markSearch(pre, highlight);

    info.textContent = `الغرفة ${result.roomShort} / الجدار ${wall} / الرف ${shelf} / الكتاب ${book} / الصفحة ${result.page}`;
    document.title = `${info.textContent} | مكتبة بابل`;
    select.value = result.page;

    const link = async (identifier: string) => {
      const [r, ...rest] = identifier.split(".");
      return pageHref(r === room ? token : await tokenFor(r), rest);
    };
    prev.href = await link(result.prevIdentifier);
    next.href = await link(result.nextIdentifier);

    if (wantPdf) {
      history.replaceState(null, "", "#" + hash);
      await makePdf();
    }
  }

  async function makePdf() {
    if (!current) return;
    const { token, room, wall, shelf, book } = current;
    show("لحظة، المكتبة تكتب هذا الكتاب في ملف PDF...");
    const { binding, C, N } = await loadEngine();
    const [{ generatePdf }, font, whole] = await Promise.all([
      import("../pdf"),
      fetch("font/Amiri-Regular.ttf").then((r) => r.arrayBuffer()),
      generateContent(binding, [room, wall, shelf, book].join("."), C, N, true),
    ]);
    const pdf = await generatePdf(new Uint8Array(font), whole.content, whole.roomShort, token, wall, shelf, book);
    download(`babel-${whole.roomShort.replace(/\W/g, "")}-${wall}-${shelf}-${book}.pdf`, pdf, "application/pdf");
    show("");
  }

  async function go() {
    show("لحظة، المكتبة تحسب هذه الصفحة...");
    pre.classList.add("Loading");
    try {
      await render();
      show("");
    } catch (e) {
      show((e as Error).message || "حدث خطأ غير متوقع.", true);
    }
    pre.classList.remove("Loading");
  }

  select.onchange = () => {
    if (!current) return;
    const { token, wall, shelf, book } = current;
    location.hash = [token, wall, shelf, book, select.value].join(".");
  };

  document.querySelector(".FullAddress")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!current) return;
    const { room, wall, shelf, book, page } = current;
    download(`babel-address-${wall}-${shelf}-${book}-${page}.txt`, [room, wall, shelf, book, page].join("."), "text/plain");
  });

  document.querySelector(".DownloadBookmark")?.addEventListener("click", () => {
    if (!current) return;
    const { room, wall, shelf, book, page } = current;
    const p = Number(page);
    const head = [Math.min(255, p), Math.max(0, p - 255), Number(book), Number(shelf), Number(wall)];
    download(`babel-${wall}-${shelf}-${book}-${page}.babel`, new Uint8Array([...head, ...roomToBytes(room)]), "application/octet-stream");
  });

  document.querySelector(".DownloadPdf")?.addEventListener("click", () => {
    makePdf().catch((e) => show((e as Error).message, true));
  });

  document.querySelector(".HighlightWords")?.addEventListener("click", () => highlightWords(pre));

  window.addEventListener("hashchange", go);
  go();
}

// the searched text, from its start and end positions on the page
function markSearch(pre: HTMLElement, spec: string) {
  const [startLine, startCol, endLine, endCol] = spec.split(":").map(Number);
  const lines = (pre.textContent || "").split("\n");
  if (!lines[startLine] || !lines[endLine]) return;
  const html = lines.map((line, i) => {
    if (i < startLine || i > endLine) return line;
    const from = i === startLine ? startCol : 0;
    const to = i === endLine ? endCol : line.length;
    return `${line.slice(0, from)}<strong>${line.slice(from, to)}</strong>${line.slice(to)}`;
  });
  // page text holds only the library's 42 symbols, so it needs no escaping
  pre.innerHTML = html.join("\n");
}

// Arabic glyphs have no fixed width, so matches are wrapped in <mark>
async function highlightWords(pre: HTMLElement) {
  const words = (await (await fetch("words.txt")).text())
    .split("\n")
    .map((w) => w.trim())
    .filter((w) => w.length > 1)
    .sort((a, b) => b.length - a.length);
  if (!pre.dataset.text) pre.dataset.text = pre.textContent || "";
  const pattern = new RegExp(words.map((w) => (w.length > 3 ? w : `(?<=^| )${w}(?= |$)`)).join("|"), "g");
  pre.innerHTML = pre.dataset.text
    .split("\n")
    .map((line) => line.replace(pattern, (m) => `<mark>${m}</mark>`))
    .join("\n");
}

/* ---------- search.html ---------- */

function initSearch() {
  const form = document.querySelector("form.SearchForm") as HTMLFormElement;
  const button = form.querySelector("button") as HTMLButtonElement;
  const input = form.querySelector("textarea") as HTMLTextAreaElement;
  const status = form.querySelector(".Status") as HTMLElement;

  const count = (value: string) => {
    const n = value.replace(/[\r\n]/g, "").length;
    status.classList.toggle("Error", n > MAX_CHARS);
    status.textContent = `${n.toLocaleString("en")} من ${MAX_CHARS.toLocaleString("en")} حرف`;
  };

  input.oninput = () => {
    const { value, selectionEnd } = input;
    const clean = sanitiseContent(value);
    input.value = clean;
    const delta = value.length - clean.length;
    if (delta) input.selectionStart = input.selectionEnd = Math.max(0, Math.min(clean.length, selectionEnd - delta));
    count(clean);
  };
  count(input.value);
  loadEngine(); // start fetching while the visitor types

  form.onsubmit = async (e) => {
    e.preventDefault();
    const content = sanitiseContent(input.value);
    const mode = new FormData(form).get("mode");
    if (content.replace(/[\r\n]/g, "").length > MAX_CHARS) return;

    button.disabled = true;
    button.textContent = "لحظة...";
    try {
      if (mode === "words") setPopularWords(await (await fetch("words.txt")).text());
      const { binding, I, N } = await loadEngine();

      let book = "";
      let page = 1;
      let highlight = "";
      if (mode === "emptybook") book = getEmptyBookContent(content);
      else if (mode === "chars" || mode === "words") {
        const made = mode === "chars" ? getRandomCharsBookContent(content) : getRandomWordsBookContent(content);
        book = made.book;
        const { startLine, startCol, endLine, endCol } = made.highlight;
        page = Math.floor(startLine / LINES) + 1;
        highlight = [startLine - (page - 1) * LINES, startCol, endLine - (page - 1) * LINES, endCol].join(":");
      } else ({ book, page } = getEmptyPageBookContent(content));

      const identifier = await lookupContent(binding, book, I, N, page);
      const [room, ...rest] = identifier.split(".");
      location.href = pageHref(await tokenFor(room), rest, highlight ? `~${highlight}` : "");
    } catch (err) {
      status.textContent = (err as Error).message || "تعذر البحث، حاول مرة أخرى.";
      status.classList.add("Error");
      button.disabled = false;
      button.textContent = "ابحث";
    }
  };
}

/* ---------- browse.html ---------- */

function initBrowse() {
  const form = document.querySelector("form#browse") as HTMLFormElement;
  const room = form.querySelector('[name="room"]') as HTMLTextAreaElement;
  room.oninput = () => {
    room.value = room.value.toLowerCase().replace(/[^0-9a-v]/g, "");
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const token = await tokenFor(String(f.get("room")));
    location.href = pageHref(token, ["wall", "shelf", "book", "page"].map((k) => String(f.get(k))));
  };

  const bookmark = document.querySelector("form#bookmark") as HTMLFormElement;
  bookmark.onsubmit = async (e) => {
    e.preventDefault();
    const file = (bookmark.querySelector('input[type="file"]') as HTMLInputElement).files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const [page1, page2, book, shelf, wall] = bytes;
    const token = await tokenFor(bytesToRoom(bytes.slice(5)));
    location.href = pageHref(token, [wall, shelf, book, page1 + page2]);
  };
}

/* ---------- examples.html ---------- */

function initExamples() {
  document.querySelectorAll<HTMLButtonElement>("[data-addresses]").forEach((button) => {
    button.onclick = async () => {
      const { addresses, slug } = button.dataset;
      const volumes = JSON.parse(addresses as string) as { file: string; place: string }[];
      button.disabled = true;
      const rooms = await Promise.all(volumes.map((v) => fetch(`data/rooms/${v.file}.txt`).then((r) => r.text())));
      download(`${slug}-address.txt`, rooms.map((r, i) => `${r.trim()}.${volumes[i].place}.1`).join("\n"), "text/plain");
      button.disabled = false;
    };
  });
}

const pages: Record<string, () => void> = {
  page: initPage,
  search: initSearch,
  browse: initBrowse,
  examples: initExamples,
};
pages[document.body.dataset.page || ""]?.();
