"""Captures des maquettes du compte-rendu (écran). Usage : python3 cap.py <site> <pkgs> <sortie>"""
from urllib.parse import quote
import re, sys, json, pathlib, subprocess, time
from playwright.sync_api import sync_playwright

site, pkgs, out = map(pathlib.Path, sys.argv[1:4])
(out / "desktop").mkdir(parents=True, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8766", "-d", str(site)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
inter = pkgs / "inter/package/files"
FONT_CSS = "".join(
    f"@font-face{{font-family:'Inter';font-style:normal;font-weight:{w};src:url(https://fonts.gstatic.com/local/inter-{w}.woff2) format('woff2')}}"
    for w in (400, 500))

def route_unpkg(r):
    m = re.search(r"unpkg\.com/(@?[^@]+)@([^/]+)/([^?]*)", r.request.url)
    if not m:
        return r.abort()
    fp = pkgs / (m[1] + "@" + m[2]).replace("/", "_") / "package" / m[3]
    return r.fulfill(path=str(fp)) if fp.exists() else r.abort()

def route_gstatic(r):
    w = re.search(r"inter-(\d+)", r.request.url)[1]
    r.fulfill(path=str(inter / f"inter-latin-{w}-normal.woff2"))

SHOTS = [
    # (fichier, largeur, échelle, sortie, clic sur le texte d'un bouton)
    ("Gurchon Hall Compte-rendu Bureau.dc.html", 1440, 1, "desktop/d50-compte-rendu-apercu.png", None),
    ("Gurchon Hall Compte-rendu Bureau.dc.html", 1440, 1, "desktop/d51-compte-rendu-version.png", "v2 · [date]"),
    ("Gurchon Hall Compte-rendu Avant.dc.html", 1440, 1, "desktop/d52-compte-rendu-avant.png", None),
    ("Gurchon Hall Compte-rendu.dc.html", 390, 2, "1b-79-compte-rendu-apercu.png", None),
    ("Gurchon Hall Compte-rendu.dc.html", 390, 2, "1b-80-compte-rendu-version.png", "v2 · [date]"),
    ("Gurchon Hall Compte-rendu Reglages.dc.html", 390, 2, "1b-81-compte-rendu-reglages.png", None),
]
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for file, w, scale, name, click in SHOTS:
        ctx = b.new_context(viewport={"width": w, "height": 900}, device_scale_factor=scale)
        ctx.route(re.compile(r"unpkg\.com/"), route_unpkg)
        ctx.route(re.compile(r"fonts\.googleapis\.com/"), lambda r: r.fulfill(body=FONT_CSS, content_type="text/css"))
        ctx.route(re.compile(r"fonts\.gstatic\.com/"), route_gstatic)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto(f"http://127.0.0.1:8766/{quote(file)}", wait_until="networkidle")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(800)
        if click:
            pg.get_by_role("button", name=click).click()
            pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / name), full_page=True)
        ctx.close()
    b.close()
srv.terminate()
print(json.dumps({"errs": errs}))
