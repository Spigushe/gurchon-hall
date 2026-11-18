"""Briques communes aux deux prototypes du Lot 12 (mobile 1b, bureau 3a)."""

HEAD = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<meta name="design_doc_mode" content="canvas">
<link rel="stylesheet" href="nocturne/styles.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css">
<style>
  body { margin: 0; background: #0d0e16; }
  i[class^="ph"] { display: block; }
  .lot12 * { box-sizing: border-box; }
  .cap { display:flex; align-items:center; gap:10px; font-size:13px; color:var(--color-neutral-400); }
  .cap b { font-weight:400; font-family:var(--font-heading); font-size:12px; padding:2px 8px; border-radius:999px; border:1px solid var(--color-accent); color:var(--color-accent); }
  .phone { width:390px; height:844px; border-radius:38px; background:var(--color-bg); box-shadow:var(--shadow-md); overflow:hidden; position:relative; display:flex; flex-direction:column; color:var(--color-text); font-family:var(--font-body); font-size:15px; line-height:1.5; }
  .desk { width:1440px; height:900px; border-radius:12px; background:var(--color-bg); box-shadow:var(--shadow-md); overflow:hidden; position:relative; display:flex; flex-direction:column; color:var(--color-text); font-family:var(--font-body); font-size:15px; line-height:1.5; }
  .sbar { display:flex; justify-content:space-between; align-items:center; padding:16px 26px 0; font-size:12px; color:var(--color-neutral-500); flex:none; }
  .shell { display:flex; align-items:center; gap:12px; padding:14px 26px 0; font-size:11px; color:var(--color-neutral-500); flex:none; }
  .shell .brand { letter-spacing:.16em; text-transform:uppercase; margin-right:auto; }
  .acct { display:flex; align-items:center; gap:5px; font-family:var(--font-heading); font-size:12px; color:var(--color-text); }
  .acct.on { color:var(--color-accent); }
  .off { color:var(--color-accent-300); display:flex; align-items:center; gap:5px; }
  .mpage { display:flex; flex-direction:column; gap:26px; padding:22px 26px 120px; }
  .viewport { flex:1; overflow:hidden; position:relative; }
  .h1 { font-family:var(--font-heading); font-weight:500; font-size:30px; line-height:1.15; letter-spacing:-.02em; margin:0; }
  .h2 { font-family:var(--font-heading); font-weight:500; font-size:26px; line-height:1.15; letter-spacing:-.02em; margin:0; }
  .meta { font-size:13px; color:var(--color-neutral-400); margin-top:4px; }
  .kicker { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--color-neutral-500); margin:0 0 6px; }
  .sec { display:flex; flex-direction:column; }
  .sec-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
  .row { padding:16px 0; border-top:1px solid var(--color-divider); display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .row.first { border-top:none; }
  .rn { font-family:var(--font-heading); font-size:17px; line-height:1.2; }
  .rm { font-size:12px; color:var(--color-neutral-500); margin-top:3px; }
  .arrow { color:var(--color-accent); font-size:18px; }
  .hint { font-size:13px; color:var(--color-neutral-400); text-wrap:pretty; }
  .small { font-size:12px; color:var(--color-neutral-500); }
  .err { font-size:13px; color:var(--color-accent-200); }
  .ok { font-size:13px; color:var(--color-accent-200); display:flex; gap:6px; align-items:flex-start; }
  .bt { font-size:13px; color:var(--color-accent-300); display:inline-flex; align-items:center; gap:4px; min-height:44px; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:8px 16px; border-radius:var(--radius-md); border:1px solid transparent; font-family:var(--font-heading); font-size:14px; color:var(--color-text); align-self:flex-start; }
  .btn.p { color:var(--color-accent); border-color:var(--color-accent); }
  .btn.s { border-color:var(--color-divider); }
  .dis { opacity:.45; }
  .ca { display:inline-flex; align-items:center; justify-content:center; min-height:40px; padding:0 16px; border-radius:999px; font-size:13px; flex:none; white-space:nowrap; }
  .ca.a { border:1px solid var(--color-accent); color:var(--color-accent); }
  .ca.n { border:1px solid var(--color-divider); color:var(--color-text); }
  .tag { display:inline-flex; align-items:center; padding:2px 8px; border-radius:var(--radius-sm); font-size:12px; line-height:1.5; flex:none; white-space:nowrap; }
  .tag.u { border:1px solid var(--color-divider); color:var(--color-neutral-400); }
  .tag.l { background:var(--color-accent-800); color:var(--color-accent-100); }
  .alert { border-left:2px solid var(--color-accent); padding:2px 0 2px 14px; display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
  .alert .t { font-family:var(--font-heading); font-size:15px; line-height:1.4; color:var(--color-accent-200); }
  .alert .acts { display:flex; gap:18px; flex-wrap:wrap; }
  .alert .acts span { font-size:13px; color:var(--color-accent-300); min-height:32px; display:flex; align-items:center; gap:4px; }
  .kbd { display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border:1px solid var(--color-divider); border-radius:var(--radius-sm); font-size:11px; line-height:17px; color:var(--color-neutral-400); white-space:nowrap; }
  .field { display:flex; flex-direction:column; gap:6px; }
  .field label { font-size:12px; color:var(--color-neutral-400); }
  .uf { min-height:44px; border-bottom:1px solid var(--color-divider); padding:0 2px 10px; display:flex; align-items:flex-end; font-size:15px; letter-spacing:.1em; }
  .uf.focus { border-bottom-color:var(--color-accent); }
  .uf.bad { border-bottom-color:var(--color-accent-300); }
  .caret { width:1px; height:18px; background:var(--color-accent); margin-left:2px; display:inline-block; }
  .rules { list-style:none; margin:4px 0 0; padding:0; display:flex; flex-direction:column; gap:4px; }
  .rules li { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--color-neutral-400); }
  .rules li.met { color:var(--color-accent-300); }
  .rules li i { font-size:15px; }
  .pill { min-height:50px; border-radius:999px; border:1px solid var(--color-accent); background:var(--color-bg); box-shadow:var(--shadow-md); display:flex; align-items:center; justify-content:center; gap:8px; font-family:var(--font-heading); font-size:16px; color:var(--color-accent); }
  .confirm { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
  .skel { display:block; border-radius:var(--radius-sm); background:var(--color-neutral-900); }
  .loading { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--color-neutral-500); }
  .spin { width:13px; height:13px; border-radius:50%; border:1.5px solid var(--color-neutral-700); border-top-color:var(--color-accent-300); flex:none; }
  .tabs { display:flex; gap:18px; border-bottom:1px solid var(--color-divider); font-size:13px; }
  .tabs span { padding-bottom:9px; color:var(--color-neutral-500); }
  .tabs span.on { color:var(--color-text); font-family:var(--font-heading); box-shadow:inset 0 -2px 0 var(--color-accent); }
  /* bureau */
  .top { height:56px; flex:none; border-bottom:1px solid var(--color-divider); display:flex; justify-content:center; }
  .top-in { flex:1; max-width:1200px; display:flex; align-items:center; gap:40px; }
  .tabsd { display:flex; gap:28px; align-self:stretch; }
  .tabsd span { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--color-neutral-400); }
  .tabsd span.on { color:var(--color-text); box-shadow:inset 0 -2px 0 var(--color-accent); }
  .search { width:280px; height:34px; display:flex; align-items:center; gap:10px; padding:0 10px; border-radius:var(--radius-md); border:1px solid var(--color-divider); background:var(--color-surface); font-size:13px; color:var(--color-neutral-500); }
  .dpage { flex:1; display:flex; justify-content:center; overflow:hidden; position:relative; }
  .dcol { flex:1; max-width:1200px; padding:28px 0; display:flex; flex-direction:column; gap:24px; }
  .panel { position:absolute; top:56px; right:0; bottom:0; width:460px; background:var(--color-surface); box-shadow:var(--shadow-lg); padding:28px 32px; display:flex; flex-direction:column; gap:24px; }
  .dim { opacity:.35; }
  .card { background:var(--color-surface); border-radius:var(--radius-md); padding:20px 22px; display:flex; flex-direction:column; gap:12px; }
  .th { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--color-neutral-500); }
  .grid { display:grid; align-items:center; gap:16px; }
  .krow { display:flex; justify-content:space-between; align-items:center; gap:16px; min-height:40px; border-top:1px solid var(--color-divider); font-size:14px; }
  .krow:first-of-type { border-top:none; }
  .keys { display:flex; gap:4px; align-items:center; }
  .menu { position:absolute; top:52px; width:240px; background:var(--color-surface); border-radius:var(--radius-md); box-shadow:var(--shadow-md); padding:6px; display:flex; flex-direction:column; z-index:5; }
  .menu span { display:flex; align-items:center; gap:10px; min-height:40px; padding:0 10px; border-radius:var(--radius-sm); font-size:14px; }
</style>
</helmet>
"""

TAIL = """</x-dc>
<script type="text/x-dc" data-dc-script>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
"""


def ph(name, size=None, extra=""):
    st = f' style="font-size:{size}px{";" + extra if extra else ""}"' if size else (f' style="{extra}"' if extra else "")
    cls = "ph-fill ph-" + name[5:] if name.startswith("fill:") else "ph ph-" + name
    return f'<i class="{cls}"{st}></i>'


# ——— données de démonstration (brief du Lot 12) ———
SESSIONS = [
    # (appareil, connecté, utilisé, expire)
    ("Chrome sur Android", "Connecté le 2 novembre", "utilisé aujourd'hui", "Expire le 2 décembre"),
    ("Firefox sur Windows", "Connecté le 20 septembre", "utilisé il y a 3 jours", "Expire le 29 novembre"),
    ("Safari sur iPhone", "Connecté le 28 octobre", "utilisé il y a 12 jours", "Expire le 20 novembre"),
    ("Appareil inconnu", "Connecté le 10 novembre", "jamais revu depuis", "Expire le 24 novembre"),
]

RULES = ["De 12 à 128 caractères", "Une minuscule", "Une majuscule", "Un chiffre", "Un symbole"]


def rules(met):
    lis = "".join(
        f'<li class="{"met" if i in met else ""}">{ph("check-circle" if i in met else "circle")}{r}</li>'
        for i, r in enumerate(RULES)
    )
    return f'<ul class="rules" aria-label="Règles du mot de passe">{lis}</ul>'


EXPORT_TEXT = (
    "Un fichier JSON avec votre collection, vos decks (supprimés compris), leurs versions "
    "jouées, vos parties, tournois, joueurs et lieux."
)
EXPORT_FILE = "gurchon-hall-lea-v-2026-11-18.json"
SESSION_NOTE = (
    "Un appareil dont la session est fermée est déconnecté à sa prochaine requête. "
    "Ses saisies en attente ne sont pas perdues : elles partiront après reconnexion."
)
