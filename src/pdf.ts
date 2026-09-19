import { PDFDocument, PDFFont, PDFPage, PageSizes, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PAGES, LINES, CHARS, PAGE_LENGTH } from "./constants";
import { shapeArabic } from "./shape";

const [WIDTH, HEIGHT] = PageSizes.A4;
const MARGIN = 48;
const RIGHT = WIDTH - MARGIN;
const FONT_SIZE = 10;
const META_SIZE = 8;
const LEADING = 16;
const NUMBER_GUTTER = 20;
const GREY = rgb(0.45, 0.45, 0.45);

// Text reaching the font is already shaped and in visual order, so layout is
// a plain code point to glyph lookup instead of fontkit's OpenType pass.
const plainFontkit = {
  create(buffer: Uint8Array) {
    const font = fontkit.create(buffer);
    // pdf-lib reads only `glyphs` from the run
    font.layout = (text: string) =>
      ({
        glyphs: Array.from(text, (c) => font.glyphForCodePoint(c.codePointAt(0) as number)),
      } as unknown as ReturnType<typeof font.layout>);
    return font;
  },
};

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

type Run = { text: string; font: PDFFont; colour?: ReturnType<typeof rgb> };

// A line mixing Arabic words with Latin identifiers and digits is drawn run by
// run, from the right edge leftwards; each run is laid out left to right.
function drawRtl(page: PDFPage, runs: Run[], y: number, size: number) {
  let x = RIGHT;
  for (const run of runs) {
    const { font, colour } = run;
    const text = font.name.startsWith("Courier") ? run.text : shapeArabic(run.text);
    const width = font.widthOfTextAtSize(text, size);
    x -= width;
    page.drawText(text, { x, y, size, font, color: colour ?? rgb(0, 0, 0) });
  }
}

// font: Amiri (SIL OFL), which has every Presentation Forms-B glyph shapeArabic emits
export async function generatePdf(
  font: Uint8Array,
  content: string,
  roomShort: string,
  hash: string,
  wall: string,
  shelf: string,
  book: string
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  document.registerFontkit(plainFontkit as any);
  const arabic = await document.embedFont(font);
  const mono = await document.embedFont(StandardFonts.Courier);

  document.setTitle(`مكتبة بابل: الغرفة ${roomShort}، الجدار ${wall}، الرف ${shelf}، الكتاب ${book}`);
  document.setLanguage("ar");
  document.setAuthor("مرتضى نجم");
  document.setCreator("مكتبة بابل، النسخة العربية من إعداد مرتضى نجم");

  for (let p = 0; p < PAGES; p++) {
    const page = document.addPage(PageSizes.A4);
    let top = HEIGHT - MARGIN;

    drawRtl(page, [{ text: "مكتبة بابل", font: arabic }], top, FONT_SIZE + 2);

    top -= LEADING;
    drawRtl(
      page,
      // digits get their own runs: inside an Arabic run fontkit would reverse them
      [
        ["الغرفة ", roomShort],
        ["، الجدار ", wall],
        ["، الرف ", shelf],
        ["، الكتاب ", book],
        ["، الصفحة ", `${p + 1}`],
      ].flatMap(([label, value]) => [
        { text: label, font: arabic, colour: GREY },
        { text: value, font: mono, colour: GREY },
      ]),
      top,
      META_SIZE
    );

    top -= LEADING * 0.8;
    drawRtl(
      page,
      [
        { text: "علامة الصفحة ", font: arabic, colour: GREY },
        { text: hash, font: mono, colour: GREY },
      ],
      top,
      META_SIZE - 1.5
    );

    top -= LEADING * 1.6;

    const chunk = content.substring(p * PAGE_LENGTH, (p + 1) * PAGE_LENGTH);

    for (let l = 0; l < LINES; l++) {
      const line = chunk.substring(l * CHARS, (l + 1) * CHARS);

      page.drawText(pad(l + 1), {
        x: RIGHT - mono.widthOfTextAtSize("00", META_SIZE),
        y: top,
        size: META_SIZE,
        font: mono,
        color: GREY,
      });

      // book text holds no digits or Latin, so the whole line is one run
      if (line.trim()) {
        const shaped = shapeArabic(line);
        page.drawText(shaped, {
          x: RIGHT - NUMBER_GUTTER - arabic.widthOfTextAtSize(shaped, FONT_SIZE),
          y: top,
          size: FONT_SIZE,
          font: arabic,
        });
      }

      top -= LEADING;
    }

    drawRtl(
      page,
      [{ text: "النسخة العربية من إعداد مرتضى نجم", font: arabic, colour: GREY }],
      MARGIN / 2,
      META_SIZE - 1
    );

    page.drawText(`${p + 1}`, {
      x: WIDTH / 2 - mono.widthOfTextAtSize(`${p + 1}`, META_SIZE) / 2,
      y: MARGIN / 2,
      size: META_SIZE,
      font: mono,
      color: GREY,
    });
  }

  return document.save();
}
