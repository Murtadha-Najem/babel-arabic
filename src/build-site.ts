/*
  Builds the static site for GitHub Pages into ./site.

    npm run build              (BASE_PATH=/babel-arabic/ by default)

  - renders every template in src/views to an .html page
  - copies src/public (styles, fonts, images, words.txt)
  - copies the constants to data/numbers.txt
  - searches every example once and writes its rooms to data/rooms/
  - bundles src/web/app.ts, the library as it runs in the browser

  BASE_PATH is the path the site is served under. Only 404.html needs it:
  GitHub Pages serves that file for any missing path, so its relative links
  would otherwise resolve against the wrong folder.
*/

import fs from "fs";
import path from "path";
import pug from "pug";
import { build } from "esbuild";
import { init as gmpInit } from "gmp-wasm";
import { initialiseNumbers } from "./babel";
import { loadExamples } from "./examples";

const OUT = "site";
const BASE = process.env.BASE_PATH || "/babel-arabic/";
const PAGES = ["index", "about", "search", "browse", "examples", "story", "page", "404"];

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync("src/public", OUT, {
    recursive: true,
    filter: (src) => !src.includes(path.join("public", "js")),
  });

  const numbers = fs.readFileSync("numbers", "utf8");
  fs.mkdirSync(path.join(OUT, "data", "rooms"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "data", "numbers.txt"), numbers);

  const { binding } = await gmpInit();
  const { N, I } = await initialiseNumbers(binding, numbers);
  const examples = await loadExamples(binding, I, N);
  for (const example of examples) {
    example.volumes.forEach((volume, i) => {
      fs.writeFileSync(path.join(OUT, "data", "rooms", `${example.slug}-${i + 1}.txt`), volume.room);
    });
  }

  const assetVersion = Date.now().toString(36);
  for (const name of PAGES) {
    const html = pug.renderFile(path.join("src", "views", `${name}.pug`), {
      path: name,
      assetVersion,
      examples,
      bookmarkCount: 0,
      base: name === "404" ? BASE : undefined,
    });
    fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  }

  await build({
    entryPoints: ["src/web/app.ts"],
    bundle: true,
    format: "esm",
    splitting: true,
    minify: true,
    target: "es2020",
    outdir: path.join(OUT, "js"),
    logLevel: "warning",
  });

  // GitHub Pages would otherwise run the files through Jekyll
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

  const rooms = examples.reduce((n, e) => n + e.volumes.length, 0);
  console.log(`built ${OUT}/: ${PAGES.length} pages, ${examples.length} examples, ${rooms} rooms`);
})();
