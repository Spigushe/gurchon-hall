"""Génère « Gurchon Hall Compte.dc.html » : Lot 12, mobile 390 × 844, direction 1b."""
import sys

from common import EXPORT_FILE, EXPORT_TEXT, HEAD, RULES, SESSION_NOTE, SESSIONS, TAIL, ph, rules

OUT = sys.argv[1]


def phone(code, slug, label, body, tab="none", time="10:12", offline=False):
    icons = ph("wifi-slash") if offline else ph("wifi-high")
    tabbar = (
        f'<dc-import name="TabBar" active="{tab}" style="position:absolute;left:0;right:0;bottom:0" '
        f'hint-size="100%,82px"></dc-import>'
        if tab is not None
        else ""
    )
    return f"""
      <div style="display:flex;flex-direction:column;gap:12px">
        <span class="cap"><b>{code}</b>{label}</span>
        <div id="shot-{code}-{slug}" data-screen-label="{code} {label}" class="phone">
          <div class="sbar"><span>{time}</span><span style="display:flex;gap:6px">{icons}{ph("battery-high")}</span></div>
          {body}
          {tabbar}
        </div>
      </div>"""


def shell(offline=False, on=False):
    status = f'<span class="off">{ph("wifi-slash", 13)}Hors ligne</span>' if offline else "<span>En ligne</span>"
    return f"""<div class="shell"><span class="brand">Gurchon Hall</span>
            <span class="acct{' on' if on else ''}">{ph("user-circle", 16)}lea-v</span>{status}</div>"""


def page(inner, offset=0):
    return f"""<div class="viewport"><div class="mpage" style="margin-top:{-offset}px">{inner}</div></div>"""


# ——— Compte ———
def header():
    return """<div><p class="kicker">Compte</p><h1 class="h1">lea-v</h1><p class="meta">lea@example.org</p></div>"""


def password_section(state="online"):
    if state == "offline":
        return f"""<section class="sec"><p class="kicker">Mot de passe</p>
          <div class="row first dis"><div><div class="rn">Changer le mot de passe</div><div class="rm">Ferme vos autres sessions</div></div>{ph("caret-right", 18, "color:var(--color-neutral-500)")}</div>
          <p class="hint">Indisponible hors ligne.</p></section>"""
    extra = ""
    if state == "changed":
        extra = f'<p class="ok">{ph("check-circle", 15, "margin-top:2px")}Mot de passe changé. Vos autres appareils devront se reconnecter.</p>'
    return f"""<section class="sec"><p class="kicker">Mot de passe</p>
          <div class="row first"><div><div class="rn">Changer le mot de passe</div><div class="rm">Ferme vos autres sessions</div></div>{ph("caret-right", 18, "color:var(--color-accent)")}</div>{extra}</section>"""


def session_row(i, first=False, current=False):
    dev, conn, used, exp = SESSIONS[i]
    right = '<span class="tag u">Cet appareil</span>' if current else '<span class="ca n">Fermer</span>'
    return f"""<div class="row{' first' if first else ''}"><div style="min-width:0"><div class="rn">{dev}</div>
            <div class="rm">{conn}</div><div class="rm" style="margin-top:0">{used[0].upper() + used[1:]}</div><div class="rm" style="margin-top:0">{exp}</div></div>{right}</div>"""


def sessions_section(variant="all"):
    if variant == "offline":
        return f"""<section class="sec" style="gap:8px"><div class="sec-head"><p class="kicker">Sessions ouvertes</p></div>
          <div class="alert" style="border-left-color:var(--color-divider)"><span class="t" style="color:var(--color-text)">Liste indisponible hors ligne</span>
          <span class="hint">Les sessions se lisent sur le serveur. Elles s'afficheront au retour du réseau.</span></div></section>"""
    idx = {"all": [0, 1, 2, 3], "closed": [0, 2, 3], "confirm": [0, 1, 2, 3], "one": [0]}[variant]
    rows = "".join(session_row(i, first=(k == 0), current=(i == 0)) for k, i in enumerate(idx))
    count = len(idx)
    feedback = ""
    if variant == "closed":
        feedback = f'<p class="ok" style="margin-bottom:6px">{ph("check-circle", 15, "margin-top:2px")}Session fermée : Firefox sur Windows.</p>'
    if variant == "one":
        foot = '<p class="hint" style="padding-top:12px;border-top:1px solid var(--color-divider)">Aucune autre session ouverte.</p>'
    elif variant == "confirm":
        foot = """<div style="padding-top:14px;border-top:1px solid var(--color-divider);display:flex;flex-direction:column;gap:10px">
            <p class="hint" style="color:var(--color-text)">3 appareils seront déconnectés. Leurs saisies en attente partiront après reconnexion.</p>
            <div class="confirm"><span class="ca a">Fermer les 3 sessions</span><span class="ca n">Annuler</span></div></div>"""
    else:
        foot = f"""<div style="border-top:1px solid var(--color-divider)"><span class="bt">Fermer toutes les autres sessions</span></div>
            <p class="small" style="text-wrap:pretty">{SESSION_NOTE}</p>"""
    return f"""<section class="sec"><div class="sec-head"><p class="kicker">Sessions ouvertes</p><span class="small">{count}</span></div>
          {feedback}{rows}{foot}</section>"""


def data_section(state="idle"):
    if state == "offline":
        btn = f'<span class="btn s dis">{ph("download-simple", 16)}Exporter mes données</span><p class="hint">Indisponible hors ligne.</p>'
    elif state == "busy":
        btn = f"""<p class="hint" style="color:var(--color-accent-200)">3 saisies pas encore synchronisées n'y seront pas.</p>
            <span class="btn s dis"><span class="spin"></span>Préparation du fichier…</span>"""
    elif state == "done":
        btn = f"""<span class="btn s">{ph("download-simple", 16)}Exporter mes données</span>
            <p class="ok">{ph("check-circle", 15, "margin-top:2px")}Fichier téléchargé : {EXPORT_FILE}</p>"""
    else:
        btn = f'<span class="btn s">{ph("download-simple", 16)}Exporter mes données</span>'
    return f"""<section class="sec" style="gap:12px"><p class="kicker" style="margin:0">Mes données</p>
          <p class="hint">{EXPORT_TEXT}</p>{btn}</section>"""


def logout_section(offline=False):
    if offline:
        return """<section class="sec" style="gap:10px"><p class="kicker" style="margin:0">Déconnexion</p>
          <span class="btn s dis">Se déconnecter</span><p class="hint">Déconnexion indisponible hors ligne.</p></section>"""
    return """<section class="sec" style="gap:10px"><p class="kicker" style="margin:0">Déconnexion</p>
          <p class="hint">Vide les données de cet appareil. Elles se rechargent à la prochaine connexion.</p>
          <span class="btn s">Se déconnecter</span></section>"""


def versions(app="1.1.0", srv="1.1.0"):
    return f'<p class="small" style="font-variant-numeric:tabular-nums">Application {app} · Serveur {srv}</p>'


def compte(offset=0, pw="online", sess="all", data="idle", offline=False, app="1.1.0"):
    inner = (
        header()
        + password_section(pw)
        + sessions_section(sess)
        + data_section(data)
        + logout_section(offline)
        + versions(app)
    )
    return shell(offline=offline, on=True) + page(inner, offset)


# ——— feuille du mot de passe ———
def pw_sheet(cur="", new="", conf="", focus=None, met=(), err=None, block=None, enabled=False):
    def fld(label, val, key, bad=False):
        cls = "uf" + (" focus" if focus == key else "") + (" bad" if bad else "")
        caret = '<span class="caret"></span>' if focus == key else ""
        return f'<div class="field"><label>{label}</label><div class="{cls}">{val}{caret}</div></div>'

    e_cur = err == "cur"
    errs = {
        "cur": '<p class="err">Mot de passe actuel incorrect.</p>',
        "conf": '<p class="err">Les deux saisies ne correspondent pas.</p>',
    }
    body = f"""<div class="viewport"><div class="mpage" style="gap:22px;padding-bottom:40px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div><p class="kicker">Compte</p><h2 class="h2">Changer le mot de passe</h2></div>
          <span style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;color:var(--color-neutral-400)">{ph("x", 20)}</span></div>
        {fld("Mot de passe actuel", cur, "cur", e_cur)}{errs["cur"] if e_cur else ""}
        <div class="field"><label>Nouveau mot de passe</label><div class="uf{' focus' if focus == 'new' else ''}">{new}{'<span class="caret"></span>' if focus == 'new' else ''}</div>{rules(met)}</div>
        {fld("Confirmation", conf, "conf", err == "conf")}{errs["conf"] if err == "conf" else ""}
        {block or ""}
      </div></div>
      <div style="position:absolute;left:26px;right:26px;bottom:34px;display:flex;flex-direction:column;gap:10px">
        <div class="pill{'' if enabled else ' dis'}">Enregistrer</div>
        <p class="small" style="text-align:center">Vos autres appareils devront se reconnecter.</p></div>"""
    return body


DOTS = lambda n: "•" * n  # noqa: E731


# ——— Atelier et bandeaux ———
def atelier(banners, offline=False):
    inner = f"""{banners}
        <div><p class="kicker">Gurchon Hall</p><h1 class="h1">Atelier</h1><p class="meta">Mercredi 18 novembre · tout est local</p></div>
        <section class="sec"><p class="kicker">En cours</p>
          <div class="row first"><div><div class="rn">Banu Princes</div><div class="rm">#0007 · actif · 12 crypte · 80 bibliothèque</div></div>{ph("arrow-up-right", 18, "color:var(--color-accent)")}</div>
          <div class="row"><div><div class="rn">Toreador Mass Vote</div><div class="rm">#0003 · actif · 12 crypte · 76 bibliothèque</div></div>{ph("arrow-up-right", 18, "color:var(--color-accent)")}</div></section>"""
    status = f'<span class="off">{ph("wifi-slash", 13)}Hors ligne</span>' if offline else "<span>En ligne</span>"
    sh = f"""<div class="shell"><span class="acct" style="margin-left:auto">{ph("user-circle", 16)}lea-v</span>{status}</div>"""
    return sh + page(inner)


def banner(state, offline=False):
    if state == "ready":
        return """<div class="alert" role="status"><span class="t">Une nouvelle version est disponible.</span>
          <div class="acts"><span>Mettre à jour</span><span>Plus tard</span></div></div>"""
    if state == "waiting":
        net = (
            '<span class="hint">Hors ligne : l\'envoi reprendra au retour du réseau.</span>' if offline else ""
        )
        return f"""<div class="alert" role="status"><span class="t">Nouvelle version prête. Elle s'installera une fois vos 3 saisies synchronisées.</span>{net}
          <div class="acts"><span>Synchronisation →</span><span>Plus tard</span></div></div>"""
    if state == "rejected":
        return """<div class="alert" role="status"><span class="t">Une nouvelle version est disponible.</span>
          <span class="hint">2 saisies refusées restent à régler ; elles seront conservées.</span>
          <div class="acts"><span>Mettre à jour</span><span>Plus tard</span></div></div>"""
    if state == "reconnect":
        return """<div class="alert" role="alert"><span class="t">Reconnexion nécessaire pour reprendre l'envoi</span>
          <div class="acts"><span>Se reconnecter →</span></div></div>"""
    raise ValueError(state)


# ——— Decks, catalogue en cours de chargement ———
def decks_list():
    loading = f'<span class="loading"><span class="spin"></span>Catalogue en cours de chargement</span>'
    rows = ""
    for k, (n, m) in enumerate([("Banu Princes", "#0007 · actif · Bleed"), ("Toreador Mass Vote", "#0003 · actif · Vote")]):
        rows += f"""<div class="row{' first' if k == 0 else ''}" style="align-items:flex-start"><div><div class="rn">{n}</div><div class="rm">{m}</div>
              <div style="margin-top:6px">{loading}</div></div></div>"""
    inner = f"""<div><h1 class="h1">Decks</h1><p class="meta">2 decks · lecture locale</p></div>
        <div class="tabs"><span class="on">En cours</span><span>Archivés</span><span>Tous</span></div>
        <section class="sec">{rows}</section>"""
    return shell() + page(inner)


def deck_detail():
    skel_rows = "".join(
        f"""<div style="display:flex;align-items:center;gap:14px;height:40px;border-bottom:1px solid var(--color-divider)">
              <span class="skel" style="height:12px;width:{w}%"></span><span class="skel" style="height:12px;width:12%;margin-left:auto"></span></div>"""
        for w in (52, 40, 58, 34)
    )
    inner = f"""<div style="display:flex;align-items:center;gap:6px;color:var(--color-neutral-400);font-size:14px;min-height:44px;margin-bottom:-18px">{ph("arrow-left", 16)}Decks</div>
        <div><p class="kicker">Deck actif · #0007</p><h1 class="h1">Banu Princes</h1><p class="meta">Bleed · proxies autorisés</p></div>
        <section class="sec" style="gap:12px" aria-busy="true">
          <div class="sec-head"><span style="font-family:var(--font-heading);font-size:16px">Composition</span></div>
          <div>{skel_rows}</div>
          <span class="loading"><span class="spin"></span>Catalogue en cours de chargement</span>
          <p class="hint">Les cartes s'enregistrent sur cet appareil. La composition s'affichera d'elle-même dans quelques secondes.</p></section>"""
    return shell() + page(inner)


# ——— assemblage ———
def group(gid, title, sub, frames):
    return f"""
  <div id="{gid}" style="display:flex;flex-direction:column;gap:20px">
    <div style="display:flex;align-items:center;gap:12px">
      <span style="font-family:var(--font-heading);font-size:13px;padding:3px 10px;border-radius:999px;border:1px solid var(--color-accent);color:var(--color-accent)">1b · Lot 12</span>
      <span style="font-family:var(--font-heading);font-size:19px">{title}</span>
      <span style="font-size:13px;color:var(--color-neutral-500)">{sub}</span>
    </div>
    <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start">{''.join(frames)}
    </div>
  </div>"""


compte_frames = [
    phone("1b-59", "compte", "Compte, haut", compte()),
    phone("1b-60", "compte-bas", "Compte, bas", compte(offset=600)),
    phone("1b-61", "compte-hors-ligne", "Compte hors ligne", compte(pw="offline", sess="offline", data="offline", offline=True), offline=True),
    phone("1b-62", "session-fermee", "Session fermée", compte(sess="closed")),
    phone("1b-63", "fermer-autres", "Fermer les autres, confirmation", compte(offset=240, sess="confirm")),
    phone("1b-64", "une-session", "Une seule session", compte(sess="one")),
]
pw_frames = [
    phone("1b-65", "mdp-vide", "Mot de passe, vide", pw_sheet(focus="cur"), tab=None),
    phone("1b-66", "mdp-saisie", "En cours de saisie", pw_sheet(cur=DOTS(14), new="Nuit-de-Lyon7", focus="new", met={0, 1, 2, 3, 4}), tab=None),
    phone("1b-67", "mdp-actuel-incorrect", "Actuel incorrect", pw_sheet(cur=DOTS(14), new=DOTS(13), conf=DOTS(13), met={0, 1, 2, 3, 4}, err="cur", enabled=True), tab=None),
    phone(
        "1b-68", "mdp-trop-essais", "Trop d'essais",
        pw_sheet(cur=DOTS(14), new=DOTS(13), conf=DOTS(13), met={0, 1, 2, 3, 4},
                 block='<div class="alert"><span class="t">Trop d\'essais.</span><span class="hint">Réessayez dans 42 secondes.</span></div>'),
        tab=None,
    ),
    phone("1b-69", "mdp-change", "Mot de passe changé", compte(pw="changed", sess="one")),
]
data_frames = [
    phone("1b-70", "export-en-cours", "Export en cours, saisies en attente", compte(offset=470, sess="one", data="busy")),
    phone("1b-71", "export-fait", "Export fait · écart de versions", compte(offset=470, sess="one", data="done", app="1.0.0")),
]
banner_frames = [
    phone("1b-72", "maj-disponible", "Nouvelle version, file vide", atelier(banner("ready")), tab="atelier"),
    phone("1b-73", "maj-en-attente", "Saisies en attente", atelier(banner("waiting")), tab="atelier"),
    phone("1b-74", "maj-hors-ligne", "En attente, hors ligne", atelier(banner("waiting", offline=True), offline=True), tab="atelier", offline=True),
    phone("1b-75", "maj-refusees", "Saisies refusées seulement", atelier(banner("rejected")), tab="atelier"),
    phone("1b-76", "maj-sous-reconnexion", "Sous le bandeau de reconnexion", atelier(banner("reconnect") + banner("waiting")), tab="atelier"),
]
cat_frames = [
    phone("1b-77", "catalogue-decks", "Liste des decks", decks_list(), tab="decks"),
    phone("1b-78", "catalogue-deck", "Détail d'un deck", deck_detail(), tab="decks"),
]

html = HEAD + f"""
<section class="lot12" style="padding:56px 64px 96px;display:flex;flex-direction:column;gap:56px;font-family:var(--font-body);color:var(--color-text)">
  <div style="display:flex;flex-direction:column;gap:6px;max-width:760px">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-neutral-500)">Gurchon Hall · Lot 12 · mobile 390 · direction 1b</div>
    <h2 style="font-size:30px;margin:0">Consolidation — le compte, la mise à jour, le catalogue</h2>
    <p style="margin:0;color:var(--color-neutral-400);font-size:15px;max-width:66ch;text-wrap:pretty">Écran Compte ouvert depuis le nom dans la barre haute, sans sixième onglet. Feuille du mot de passe. Bandeau « nouvelle version » sur le patron du bandeau de reconnexion. État « Catalogue en cours de chargement » à la place des comptes et des tableaux. Aucun token nouveau.</p>
  </div>
  {group("lot12-compte", "Compte — écrans 59 à 64", "lea-v · 4 sessions au 18 novembre", compte_frames)}
  {group("lot12-mdp", "Mot de passe — écrans 65 à 69", "feuille plein écran", pw_frames)}
  {group("lot12-donnees", "Mes données — écrans 70 et 71", "export JSON", data_frames)}
  {group("lot12-bandeau", "Nouvelle version — écrans 72 à 76", "bandeau dans la coquille", banner_frames)}
  {group("lot12-catalogue", "Catalogue en cours de chargement — écrans 77 et 78", "juste après la première connexion", cat_frames)}
</section>
""" + TAIL

open(OUT, "w").write(html)
print("ok", len(html))
