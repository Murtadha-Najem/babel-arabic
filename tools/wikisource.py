"""
Builds library examples from Arabic Wikisource.

    python tools/wikisource.py            build every book in tools/books.json
    python tools/wikisource.py slug ...   build only these

Each book in tools/books.json names a Wikisource page. The script fetches it
(and, when asked, the pages it links to, in the order they are listed),
keeps headings, paragraphs and verses, folds the text onto the library's 42
symbols, wraps it at 80 characters on whole words, writes
src/examples/<slug>.txt and adds or updates the book in
src/examples/index.json. It prints one line per book.

Layout: a heading starts a new line with a blank line before it; a
paragraph starts a new line; a verse is one line, its two halves separated
by three spaces. Set "blankLines": false to drop the blank lines.

Pages are cached in tools/.cache, so a second run makes no requests.
"""

import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOKS = os.path.join(ROOT, "tools", "books.json")
CACHE = os.path.join(ROOT, "tools", ".cache")
EXAMPLES = os.path.join(ROOT, "src", "examples")
INDEX = os.path.join(EXAMPLES, "index.json")

ALPHA = set("ابتثجحخدذرزسشصضطظعغفقكلمنهويءآأإؤئةى،.؟!- ")
WIDTH, BOOK_ROWS = 80, 410 * 40
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BLOCKS = {"p", "div", "dd", "dt", "dl", "blockquote", "center", "section", "poem", "pre"}
SKIP = ["style", "script", "sup.reference", "ol.references", "div.reflist", ".mw-references-wrap",
        ".ws-header", "#ws-data", ".mw-editsection", "table", "ul", "ol", ".noprint", "#toc", ".toc"]
os.makedirs(CACHE, exist_ok=True)


def api(**params):
    params.update(format="json", formatversion=2)
    url = "https://ar.wikisource.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "babel-arabic-examples/1.0"})
    for attempt in range(8):
        try:
            data = json.load(urllib.request.urlopen(req, timeout=90))
            time.sleep(2)  # Wikimedia answers 429 to anything faster
            return data
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(15 * (attempt + 1))
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(20 * (attempt + 1))  # the network dropped; wait for it
    raise RuntimeError("Wikisource kept refusing: " + url)


def fetch(kind, page):
    """kind is 'wikitext' or 'text' (rendered HTML); None if the page does not exist."""
    name = kind + "_" + re.sub(r'[\\/:*?"<>|]', "_", page)[:150] + ".json"
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    data = api(action="parse", page=page, prop=kind, redirects=1)
    if "parse" not in data:
        return None
    value = {"title": data["parse"]["title"], kind: data["parse"][kind]}
    json.dump(value, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return value


def links(page, mode, section=None):
    """Main-namespace links on a page, in reading order. mode: 'subpages' or 'all'."""
    data = fetch("wikitext", page)
    text = data["wikitext"]
    if section:
        start = text.find(section)
        text = text[start:] if start >= 0 else text
    base = data["title"]
    found = []
    for m in re.finditer(r"\[\[([^|\]#]+)(?:\|([^\]]+))?\]\]", text):
        target, label = m.group(1).strip(), (m.group(2) or "").strip()
        if target.startswith("/"):
            target = base + target
        if ":" in target.split("/")[0]:
            continue  # categories, authors, other namespaces
        if mode == "subpages" and not target.startswith(base + "/"):
            continue
        label = label or target.split("/")[-1]
        if target not in [t for t, _ in found]:
            found.append((target, label))
    return found


def clean(text):
    text = re.sub("[ً-ٰٟـ​-‏­]", "", text)
    text = text.replace("ٱ", "ا").replace("ی", "ي").replace("ک", "ك").replace("ە", "ه")
    for a, b in ((":", "،"), ("؛", "،"), (";", "،"), (",", "،"), ("?", "؟")):
        text = text.replace(a, b)
    text = "".join(c if c in ALPHA else " " for c in text)
    text = re.sub(r"\s+([،.؟!])", r"\1", text)
    text = re.sub(r"([،.؟!])(?=[^\s،.؟!])", r"\1 ", text)
    return re.sub(" +", " ", text).strip()


def blocks(html):
    """Headings, paragraphs and verses of a rendered page, in order."""
    soup = BeautifulSoup(html, "html.parser")
    for selector in SKIP:
        for el in soup.select(selector):
            el.decompose()
    root = soup.select_one(".mw-parser-output") or soup
    out, buf = [], []

    def flush():
        text = clean("".join(buf))
        buf.clear()
        if text:
            out.append(("p", text))

    def verses(wrapper):
        halves = []
        for cell in wrapper.find_all("div", recursive=False):
            classes = cell.get("class", [])
            text = clean(cell.get_text(" "))
            if "abyat-sdr" in classes:
                halves = [text]
            elif "abyat-ajz" in classes:
                out.append(("v", "   ".join([*halves, text]).strip()))
                halves = []
            elif text:
                out.append(("v", text))

    def walk(node):
        for child in node.children:
            if isinstance(child, NavigableString):
                buf.append(str(child))
            elif not isinstance(child, Tag):
                continue
            elif child.name == "br":
                flush()
            elif child.name in HEADINGS:
                flush()
                text = clean(child.get_text(" "))
                if text:
                    out.append(("h", text))
            elif "abyat-wrapper" in child.get("class", []):
                flush()
                verses(child)
            elif child.name in BLOCKS:
                flush()
                walk(child)
                flush()
            else:
                walk(child)

    walk(root)
    flush()
    return out


def openiti(url):
    """Headings, paragraphs and verses of an OpenITI mARkdown file (github.com/OpenITI)."""
    name = "openiti_" + re.sub(r"[^\w.-]", "_", url.rsplit("/", 1)[-1])[:150] + ".txt"
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "babel-arabic-examples/1.0"})
        for attempt in range(6):
            try:
                data = urllib.request.urlopen(req, timeout=300).read()
                break
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                time.sleep(20 * (attempt + 1))
        else:
            raise RuntimeError("could not download " + url)
        open(path, "wb").write(data)
    text = open(path, encoding="utf-8").read()
    text = text.split("#META#Header#End#", 1)[-1]
    text = re.sub(r"PageV\w+P\w+|\bms\d+\b", " ", text)

    out, para = [], []

    def flush():
        joined = " ".join(para)
        para.clear()
        if "%~%" in joined:
            for verse in joined.split("# "):
                halves = [clean(h) for h in verse.split("%~%")]
                if any(halves):
                    out.append(("v", "   ".join(h for h in halves if h)))
        elif clean(joined):
            out.append(("p", clean(joined)))

    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("###"):
            flush()
            # numbering like "١ -" becomes a stray "، -" once digits are dropped
            heading = re.sub(r"^[\s،.؟!-]+", "", clean(re.sub(r"^###\s*[|$]*", "", line)))
            if heading:
                out.append(("h", heading))
        elif line.startswith("# "):
            flush()
            para.append(line[2:])
        elif line.startswith("~~"):
            para.append(line[2:])
        elif line and not line.startswith("#"):
            para.append(line)
    flush()
    return out


def wrap(text):
    lines, line = [], ""
    for word in text.split(" "):
        if line and len(line) + 1 + len(word) > WIDTH:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}" if line else word
    if line:
        lines.append(line)
    return lines


def pages_of(book):
    """(page, heading) pairs to read, in order."""
    if book.get("openiti") and "pages" not in book:
        return []
    if book.get("pages"):
        return [(p, p) for p in book["pages"]]
    follow = book.get("follow")
    if not follow:
        return [(book["page"], None)]
    result = []
    for target, label in links(book["page"], follow, book.get("section")):
        if any(re.search(p, target) for p in book.get("skip", [])):
            continue
        if book.get("depth", 1) > 1 and fetch("wikitext", target) and links(target, "subpages"):
            result.append((None, label))
            result += [(t, l) for t, l in links(target, "subpages")]
        else:
            result.append((target, label))
    return result


def build(book):
    out, missing = [], 0
    for page, heading in pages_of(book):
        if heading and (not out or out[-1] != ("h", heading)):
            out.append(("h", clean(heading)))
        if page is None:
            continue
        data = fetch("text", page)
        if not data:
            missing += 1
            continue
        dropping = False
        for kind, text in blocks(data["text"]):
            if kind == "h":
                # "dropSections": headings whose sections are not the book's own text
                dropping = text in book.get("dropSections", [])
            if dropping:
                continue
            if kind == "h" and out and out[-1] == ("h", text):
                continue  # a page repeating the title it was listed under
            out.append((kind, text))

    # "openiti": raw file URLs read after any Wikisource pages
    for url in book.get("openiti", []):
        out += openiti(url)

    blank = book.get("blankLines", True)
    lines = []
    for kind, text in out:
        if kind == "h" and lines and blank:
            lines.append("")
        lines += wrap(text)

    open(os.path.join(EXAMPLES, book["slug"] + ".txt"), "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    chars = sum(len(t) for _, t in out)
    volumes = -(-len(lines) // BOOK_ROWS)
    note = f", {missing} pages missing" if missing else ""
    print(f"{book['slug']}: {chars:,} characters, {len(lines):,} lines, "
          f"{-(-len(lines) // 40)} pages, {volumes} volume(s){note}", flush=True)


def register(book):
    index = json.load(open(INDEX, encoding="utf-8"))
    entry = {k: book[k] for k in ("slug", "title", "category", "description") if k in book}
    entry["file"] = book["slug"] + ".txt"
    entry["source"] = book.get("source", "ويكي مصدر")
    entry["sourceUrl"] = book.get("sourceUrl", "https://ar.wikisource.org/wiki/" + book["page"].replace(" ", "_"))
    for i, existing in enumerate(index):
        if existing["slug"] == book["slug"]:
            index[i] = {**existing, **entry}
            break
    else:
        index.append(entry)
    open(INDEX, "w", encoding="utf-8", newline="\n").write(json.dumps(index, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    books = json.load(open(BOOKS, encoding="utf-8"))
    wanted = set(sys.argv[1:])
    for book in books:
        if wanted and book["slug"] not in wanted:
            continue
        try:
            build(book)
            register(book)
        except Exception as e:
            print(f"{book['slug']}: FAILED, {e}", flush=True)
