"""
Serves ./site the way GitHub Pages will: under /babel-arabic/, with 404.html
for missing paths.

    python tools/serve.py [port]      then open http://localhost:<port>/babel-arabic/
"""

import http.server, os, sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
BASE = "/babel-arabic"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        if path == BASE:
            path = BASE + "/"
        if not path.startswith(BASE + "/"):
            return os.path.join(ROOT, "__missing__")
        return super().translate_path(path[len(BASE):])

    def send_error(self, code, message=None, explain=None):
        page = os.path.join(ROOT, "404.html")
        if code != 404 or not os.path.exists(page):
            return super().send_error(code, message, explain)
        body = open(page, "rb").read()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3107
    print(f"serving {ROOT} at http://localhost:{port}{BASE}/")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
