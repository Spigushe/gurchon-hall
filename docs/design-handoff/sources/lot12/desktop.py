"""Génère « Gurchon Hall Compte Bureau.dc.html » : Lot 12, bureau 1440 × 900, direction 3a."""
import sys

from common import EXPORT_FILE, EXPORT_TEXT, HEAD, SESSION_NOTE, TAIL, ph, rules

OUT = sys.argv[1]

# Au bureau, « cet appareil » est l'ordinateur : Firefox sur Windows (scénario « j'ai perdu
# mon téléphone »). Mêmes quatre sessions que le brief, l'ordre suit la dernière utilisation.
D_SESSIONS = [
    ("Firefox sur Windows", "20 septembre", "Aujourd'hui", "2 décembre", True),
    ("Chrome sur Android", "2 novembre", "Il y a 3 jours", "29 novembre", False),
    ("Safari sur iPhone", "28 octobre", "Il y a 12 jours", "20 novembre", False),
    ("Appareil inconnu", "10 novembre", "Jamais revu depuis", "24 novembre", False),
]
COLS = "grid-template-columns:minmax(0,1fr) 130px 140px 120px 96px"

TABS = [("atelier", "Atelier", "G A"), ("collection", "Collection", "G C"), ("decks", "Decks", "G D"),
        ("parties", "Parties", "G P"), ("sync", "Synchronisation", "G S")]


def topbar(active="", acct_on=False, offline=False, menu=False):
    tabs = "".join(
        f'<span class="{"on" if k == active else ""}">{label}<span class="kbd">{key}</span></span>' for k, label, key in TABS
    )
    status = (
        f'<span class="off" style="font-size:12px">{ph("wifi-slash", 13)}Hors ligne</span>'
        if offline else '<span style="font-size:12px;color:var(--color-neutral-500)">En ligne</span>'
    )
    acct_style = "color:var(--color-accent);box-shadow:inset 0 -2px 0 var(--color-accent)" if acct_on else ""
    menu_html = ""
    if menu:
        menu_html = f"""<div class="menu" style="right:0">
            <span style="color:var(--color-text)">{ph("user-circle", 18, "color:var(--color-neutral-400)")}Compte</span>
            <span>{ph("keyboard", 18, "color:var(--color-neutral-400)")}Raccourcis<span class="kbd" style="margin-left:auto">?</span></span>
            <span style="border-top:1px solid var(--color-divider);border-radius:0;color:var(--color-accent-300)">{ph("sign-out", 18)}Se déconnecter</span></div>"""
    return f"""<div class="top"><div class="top-in">
        <div style="display:flex;flex-direction:column;line-height:1.2;flex:none"><span style="font-family:var(--font-heading);font-size:16px">Gurchon Hall</span>
          <span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-neutral-500)">VtES</span></div>
        <nav class="tabsd">{tabs}</nav>
        <div style="margin-left:auto;display:flex;align-items:center;gap:18px;align-self:stretch;position:relative;white-space:nowrap;flex:none">
          <div class="search" style="width:250px">{ph("magnifying-glass", 16)}<span style="flex:1;overflow:hidden;text-overflow:ellipsis">Chercher une carte (catalogue)</span><span class="kbd">/</span></div>
          {status}
          <span style="display:flex;align-items:center;gap:6px;align-self:stretch;font-family:var(--font-heading);font-size:14px;{acct_style}">{ph("user-circle", 18)}lea-v{ph("caret-down", 12, "color:var(--color-neutral-500)")}</span>
          {menu_html}
        </div></div></div>"""


def desk(code, slug, label, body):
    return f"""
      <div style="display:flex;flex-direction:column;gap:12px">
        <span class="cap"><b>{code}</b>{label}</span>
        <div id="shot-{code}-{slug}" data-screen-label="3a-{code[1:]} {label}" class="desk">{body}</div>
      </div>"""


# ——— Compte ———
def sessions_card(variant="all", offline=False):
    if offline:
        return f"""<div class="card"><div class="sec-head"><span style="font-family:var(--font-heading);font-size:16px">Sessions ouvertes</span></div>
          <div class="alert" style="border-left-color:var(--color-divider)"><span class="t" style="color:var(--color-text)">Liste indisponible hors ligne</span>
          <span class="hint">Les sessions se lisent sur le serveur. Elles s'afficheront au retour du réseau.</span></div></div>"""
    rows = D_SESSIONS if variant != "closed" else [s for s in D_SESSIONS if s[0] != "Chrome sur Android"]
    if variant == "one":
        rows = D_SESSIONS[:1]
    head = f"""<div class="grid th" style="{COLS};height:30px;border-bottom:1px solid var(--color-divider)"><span>Appareil</span><span>Connecté le</span><span>Utilisé</span><span>Expire le</span><span></span></div>"""
    body = ""
    for dev, conn, used, exp, cur in rows:
        right = '<span class="tag u" style="justify-self:end">Cet appareil</span>' if cur else '<span class="ca n" style="justify-self:end;min-height:32px;padding:0 14px">Fermer</span>'
        body += f"""<div class="grid" style="{COLS};min-height:52px;border-bottom:1px solid var(--color-divider);font-size:14px">
            <span style="font-family:var(--font-heading)">{dev}</span><span style="color:var(--color-neutral-400)">{conn}</span>
            <span style="color:var(--color-neutral-400)">{used}</span><span style="color:var(--color-neutral-400)">{exp}</span>{right}</div>"""
    feedback = ""
    if variant == "closed":
        feedback = f'<p class="ok">{ph("check-circle", 15, "margin-top:2px")}Session fermée : Chrome sur Android. Le téléphone sera déconnecté à sa prochaine requête.</p>'
    if variant == "confirm":
        foot = """<div class="confirm"><span class="hint" style="color:var(--color-text)">3 appareils seront déconnectés.</span>
            <span class="ca a">Fermer les 3 sessions</span><span class="ca n">Annuler</span></div>"""
    elif variant == "one":
        foot = '<p class="hint">Aucune autre session ouverte.</p>'
    else:
        n = len(rows) - 1
        foot = f'<span class="bt" style="min-height:32px">Fermer toutes les autres sessions ({n})</span>'
    return f"""<div class="card" style="gap:14px">
          <div class="sec-head"><span style="font-family:var(--font-heading);font-size:16px">Sessions ouvertes</span><span class="small">{len(rows)}</span></div>
          {feedback}<div>{head}{body}</div>{foot}
          <p class="small" style="max-width:62ch">{SESSION_NOTE}</p></div>"""


def compte_page(variant="all", offline=False, pw_note=""):
    pw_btn = (
        '<span class="btn s dis">Changer le mot de passe</span><p class="hint">Indisponible hors ligne.</p>'
        if offline else '<span class="btn s">Changer le mot de passe</span>'
    )
    export = (
        f'<span class="btn s dis">{ph("download-simple", 16)}Exporter mes données</span><p class="hint">Indisponible hors ligne.</p>'
        if offline else f'<span class="btn s">{ph("download-simple", 16)}Exporter mes données</span>'
    )
    logout = (
        '<span class="btn s dis">Se déconnecter</span><p class="hint">Déconnexion indisponible hors ligne.</p>'
        if offline else '<span class="btn s">Se déconnecter</span>'
    )
    left = f"""<div style="width:400px;flex:none;display:flex;flex-direction:column;gap:28px">
        <div><p class="kicker">Compte</p><h1 class="h1">lea-v</h1><p class="meta">lea@example.org</p></div>
        <section class="sec" style="gap:10px"><p class="kicker" style="margin:0">Mot de passe</p>
          <p class="hint">Le changer ferme vos autres sessions et garde celle-ci.</p>{pw_btn}{pw_note}</section>
        <section class="sec" style="gap:10px"><p class="kicker" style="margin:0">Mes données</p><p class="hint">{EXPORT_TEXT}</p>{export}</section>
        <section class="sec" style="gap:10px"><p class="kicker" style="margin:0">Déconnexion</p>
          <p class="hint">Vide les données de cet appareil. Elles se rechargent à la prochaine connexion.</p>{logout}</section>
        <p class="small">Application 1.1.0 · Serveur 1.1.0</p></div>"""
    right = f'<div style="flex:1;min-width:0">{sessions_card(variant, offline)}</div>'
    return f'<div class="dpage"><div class="dcol" style="flex-direction:row;gap:56px">{left}{right}</div></div>'


def compte(variant="all", offline=False, panel="", pw_note=""):
    dim = " dim" if panel else ""
    return (
        f'<div class="{dim.strip()}">{topbar(acct_on=True, offline=offline)}</div>'
        + f'<div class="{dim.strip()}" style="flex:1;display:flex">{compte_page(variant, offline, pw_note)}</div>'
        + panel
    )


def pw_panel(met=(), err=None, block=None, enabled=False, focus="new", new="Nuit-de-Lyon7"):
    def fld(label, val, key, bad=False):
        cls = "uf" + (" focus" if focus == key else "") + (" bad" if bad else "")
        style = "min-height:40px;border:1px solid var(--color-divider);border-radius:var(--radius-md);background:var(--color-bg);padding:0 12px;align-items:center"
        if focus == key:
            style += ";border-color:var(--color-accent)"
        if bad:
            style += ";border-color:var(--color-accent-300)"
        caret = '<span class="caret"></span>' if focus == key else ""
        return f'<div class="field"><label>{label}</label><div class="{cls}" style="{style}">{val}{caret}</div></div>'

    e = '<p class="err">Mot de passe actuel incorrect.</p>' if err == "cur" else ""
    return f"""<div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div><p class="kicker">Compte</p><h2 class="h2" style="font-size:24px">Changer le mot de passe</h2></div>
          <div style="display:flex;align-items:center;gap:10px"><span class="kbd">Échap</span><span style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;color:var(--color-neutral-400)">{ph("x", 20)}</span></div></div>
        {fld("Mot de passe actuel", "•" * 14, "cur", err == "cur")}{e}
        <div class="field" style="gap:8px"><label>Nouveau mot de passe</label>
          <div class="uf{' focus' if focus == 'new' else ''}" style="min-height:40px;border:1px solid {'var(--color-accent)' if focus == 'new' else 'var(--color-divider)'};border-radius:var(--radius-md);background:var(--color-bg);padding:0 12px;align-items:center">{new}{'<span class="caret"></span>' if focus == 'new' else ''}</div>{rules(met)}</div>
        {fld("Confirmation", "•" * 13 if focus != "new" else "", "conf")}
        {block or ""}
        <div style="margin-top:auto;display:flex;flex-direction:column;gap:12px">
          <p class="small">Vos autres appareils devront se reconnecter.</p>
          <div style="display:flex;justify-content:flex-end;gap:12px"><span class="btn s">Annuler</span>
          <span class="btn p{'' if enabled else ' dis'}">Enregistrer<span class="kbd">⌘↵</span></span></div></div></div>"""


# ——— Raccourcis ———
GLOBAL = [("Atelier", ["G A"]), ("Collection", ["G C"]), ("Decks", ["G D"]), ("Parties", ["G P"]),
          ("Synchronisation", ["G S"]), ("Rechercher (champ de la barre haute, ou de l'écran)", ["/"]), ("Cette légende", ["?"])]
SHEETS = [("Fermer", ["Échap"]), ("Valider", ["⌘↵"])]


def kgroup(title, items, note=""):
    rows = "".join(
        f'<div class="krow"><span>{d}</span><span class="keys">{"".join(f"<span class=kbd>{k}</span>" for k in ks)}</span></div>'
        for d, ks in items
    )
    n = f'<p class="small" style="margin-top:-4px">{note}</p>' if note else ""
    return f'<section class="sec" style="gap:6px"><p class="kicker" style="margin:0 0 4px">{title}</p>{n}<div>{rows}</div></section>'


def legend(screen_title, screen_items, screen_note=""):
    first = kgroup(screen_title, screen_items) if screen_items else (
        f'<section class="sec"><p class="kicker" style="margin:0 0 6px">{screen_title}</p><p class="hint">{screen_note}</p></section>'
    )
    return f"""<div class="panel" style="gap:22px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div><p class="kicker">Clavier</p><h2 class="h2" style="font-size:24px">Raccourcis</h2></div>
          <div style="display:flex;align-items:center;gap:10px"><span class="kbd">Échap</span><span style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;color:var(--color-neutral-400)">{ph("x", 20)}</span></div></div>
        {first}
        {kgroup("Partout", GLOBAL)}
        {kgroup("Dans une feuille", SHEETS, "Sur Mac, ⌘ ; ailleurs, Ctrl.")}
      </div>"""


def decks_bg():
    rows = ""
    for k, (n, m) in enumerate([("Banu Princes", "#0007 · actif · Bleed · 12 / 80"), ("Toreador Mass Vote", "#0003 · actif · Vote · 12 / 76")]):
        sel = "background:color-mix(in srgb,var(--color-text) 4%,transparent);" if k == 0 else ""
        rows += f'<div style="{sel}padding:12px 14px;border-top:1px solid var(--color-divider)"><div class="rn" style="font-size:15px">{n}</div><div class="rm">{m}</div></div>'
    return f"""<div class="dpage"><div class="dcol" style="flex-direction:row;gap:40px">
        <div style="width:380px;flex:none;display:flex;flex-direction:column;gap:16px"><div><h1 class="h1">Decks</h1><p class="meta">2 decks · lecture locale</p></div>
          <div class="tabs"><span class="on">En cours</span><span>Archivés</span><span>Tous</span></div><div>{rows}</div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:14px"><p class="kicker" style="margin:0">Aperçu</p><h2 class="h2">Banu Princes</h2>
          <div class="card" style="height:420px"></div></div></div></div>"""


def chercher_bg():
    rows = "".join(
        f'<div style="padding:12px 0;border-top:1px solid var(--color-divider)"><div class="rn" style="font-size:15px">{n}</div><div class="rm">{m}</div></div>'
        for n, m in [("Deflection", "Réaction · Auspex"), ("Conditioning", "Action · Dominate"), ("Govern the Unaligned", "Action · Dominate"), ("Forced Awakening", "Action modifier")]
    )
    return f"""<div class="dpage"><div class="dcol"><div><h1 class="h1">Chercher</h1><p class="meta">4 212 cartes · catalogue local</p></div>
        <div class="search" style="width:560px;height:40px">{ph("magnifying-glass", 16)}<span>Nom ou texte</span></div><div style="max-width:560px">{rows}</div></div></div>"""


def with_panel(active, bg, panel):
    return f'<div class="dim">{topbar(active=active)}</div><div class="dim" style="flex:1;display:flex">{bg}</div>{panel}'


# ——— Atelier, bandeaux ———
def banner(state):
    if state == "ready":
        return """<div class="alert"><span class="t">Une nouvelle version est disponible.</span>
          <div class="acts"><span>Mettre à jour</span><span>Plus tard</span></div></div>"""
    if state == "waiting":
        return """<div class="alert"><span class="t">Nouvelle version prête. Elle s'installera une fois vos 3 saisies synchronisées.</span>
          <div class="acts"><span>Synchronisation →</span><span>Plus tard</span></div></div>"""
    if state == "reconnect":
        return """<div class="alert"><span class="t">Reconnexion nécessaire pour reprendre l'envoi</span>
          <div class="acts"><span>Se reconnecter →</span></div></div>"""
    raise ValueError(state)


def atelier(banners, menu=False):
    return topbar(active="atelier", menu=menu) + f"""<div class="dpage"><div class="dcol" style="padding-top:28px">
        {banners}
        <div style="padding-top:20px"><h1 class="h1" style="font-size:40px">Atelier</h1><p class="meta">Mercredi 18 novembre · tout est local</p></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div class="card"><p class="kicker" style="margin:0">En cours</p>
            <div class="row first"><div><div class="rn">Banu Princes</div><div class="rm">#0007 · actif · 12 crypte · 80 bibliothèque</div></div>{ph("arrow-up-right", 18, "color:var(--color-accent)")}</div>
            <div class="row"><div><div class="rn">Toreador Mass Vote</div><div class="rm">#0003 · actif · 12 crypte · 76 bibliothèque</div></div>{ph("arrow-up-right", 18, "color:var(--color-accent)")}</div></div>
          <div class="card"><p class="kicker" style="margin:0">Raccourcis</p>
            <div class="krow" style="border-top:none"><span>Nouvelle partie</span><span class="kbd">↵</span></div>
            <div class="krow"><span>Collection</span><span class="kbd">G C</span></div></div></div>
      </div></div>"""


# ——— Catalogue en cours de chargement ———
def catalogue():
    loading = '<span class="loading" style="font-size:12px"><span class="spin"></span>Catalogue en cours de chargement</span>'
    rows = ""
    for k, (n, m) in enumerate([("Banu Princes", "#0007 · actif · Bleed"), ("Toreador Mass Vote", "#0003 · actif · Vote")]):
        sel = "background:color-mix(in srgb,var(--color-text) 4%,transparent);box-shadow:inset 2px 0 0 var(--color-accent);" if k == 0 else ""
        rows += f'<div style="{sel}padding:12px 14px;border-top:1px solid var(--color-divider);display:flex;justify-content:space-between;align-items:center;gap:12px"><div><div class="rn" style="font-size:15px">{n}</div><div class="rm">{m}</div></div>{loading}</div>'
    skel = "".join(
        f'<div style="display:flex;align-items:center;gap:16px;height:36px;border-bottom:1px solid var(--color-divider)"><span class="skel" style="height:11px;width:22px"></span><span class="skel" style="height:11px;width:{w}%"></span><span class="skel" style="height:11px;width:14%;margin-left:auto"></span></div>'
        for w in (34, 28, 40, 30, 36)
    )
    return topbar(active="decks") + f"""<div class="dpage"><div class="dcol" style="flex-direction:row;gap:40px">
        <div style="width:420px;flex:none;display:flex;flex-direction:column;gap:16px"><div><h1 class="h1">Decks</h1><p class="meta">2 decks · lecture locale</p></div>
          <div class="tabs"><span class="on">En cours</span><span>Archivés</span><span>Tous</span></div><div>{rows}</div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:16px"><div><p class="kicker">Aperçu</p><h2 class="h2">Banu Princes</h2><p class="meta">#0007 · actif · Bleed · proxies autorisés</p></div>
          <div class="card" aria-busy="true"><div class="sec-head"><span style="font-family:var(--font-heading);font-size:16px">Crypte</span></div><div>{skel}</div></div>
          <div class="card"><div class="sec-head"><span style="font-family:var(--font-heading);font-size:16px">Bibliothèque</span></div><div>{skel[:len(skel) * 3 // 5]}</div></div>
          <div style="display:flex;flex-direction:column;gap:4px">{loading}<p class="hint">Les cartes s'enregistrent sur cet appareil. Les tableaux s'afficheront d'eux-mêmes dans quelques secondes.</p></div>
        </div></div></div>"""


frames = [
    desk("d35", "compte", "Compte", compte()),
    desk("d36", "menu-compte", "Menu du compte ouvert", atelier("", menu=True)),
    desk("d37", "compte-hors-ligne", "Compte hors ligne", compte(offline=True)),
    desk("d38", "mdp-saisie", "Mot de passe, en cours de saisie", compte(panel=pw_panel(met={0, 1, 2, 3, 4}))),
    desk("d39", "mdp-actuel-incorrect", "Actuel incorrect", compte(panel=pw_panel(met={0, 1, 2, 3, 4}, err="cur", enabled=True, focus="cur", new="•" * 13))),
    desk("d40", "mdp-trop-essais", "Trop d'essais", compte(panel=pw_panel(met={0, 1, 2, 3, 4}, focus=None, new="•" * 13,
         block='<div class="alert"><span class="t">Trop d\'essais.</span><span class="hint">Réessayez dans 42 secondes.</span></div>'))),
    desk("d41", "mdp-change", "Mot de passe changé", compte(variant="one", pw_note=f'<p class="ok">{ph("check-circle", 15, "margin-top:2px")}Mot de passe changé. Vos autres appareils devront se reconnecter.</p>')),
    desk("d42", "session-fermee", "Session du téléphone fermée", compte(variant="closed")),
    desk("d43", "fermer-autres", "Fermer les autres, confirmation", compte(variant="confirm")),
    desk("d44", "raccourcis-decks", "Raccourcis sur Decks", with_panel("decks", decks_bg(), legend("Decks", [("Nouveau deck", ["N"]), ("Ouvrir le deck sélectionné", ["↵"]), ("Parcourir la liste", ["↑", "↓"])]))),
    desk("d45", "raccourcis-chercher", "Raccourcis sur Chercher", with_panel("", chercher_bg(), legend("Chercher", [("Filtres", ["F"]), ("Parcourir les résultats", ["↑", "↓"]), ("Ouvrir la fiche", ["↵"]), ("Ajouter la carte", ["N"]), ("Champ de recherche de l'écran", ["/"])]))),
    desk("d46", "raccourcis-globaux", "Raccourcis, écran sans raccourci propre", compte(panel=legend("Compte", [], "Cet écran n'a pas de raccourci propre."))),
    desk("d47", "maj-disponible", "Nouvelle version, file vide", atelier(banner("ready"))),
    desk("d48", "maj-sous-reconnexion", "En attente, sous la reconnexion", atelier(banner("reconnect") + banner("waiting"))),
    desk("d49", "catalogue-decks", "Catalogue en cours de chargement", catalogue()),
]

html = HEAD + f"""
<section class="lot12" style="padding:56px 64px 96px;display:flex;flex-direction:column;gap:40px;font-family:var(--font-body);color:var(--color-text)">
  <div style="display:flex;flex-direction:column;gap:6px;max-width:820px">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-neutral-500)">Gurchon Hall · Lot 12 · bureau 1440 · direction 3a</div>
    <h2 style="font-size:30px;margin:0">Consolidation — « j'ai perdu mon téléphone », depuis l'ordinateur</h2>
    <p style="margin:0;color:var(--color-neutral-400);font-size:15px;max-width:70ch;text-wrap:pretty">Le menu du compte remonte dans la barre haute (Compte, Raccourcis, Se déconnecter). Compte en deux colonnes : le compte, le mot de passe et les données à gauche, les sessions à droite, en tableau. Mot de passe et raccourcis en panneau latéral de 460 px. Ici, « cet appareil » est l'ordinateur (Firefox sur Windows).</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:48px">{''.join(frames)}
  </div>
</section>
""" + TAIL

open(OUT, "w").write(html)
print("ok", len(html))
