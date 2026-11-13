// Lot 8 — données de démonstration et calculs du bilan (prototype, pas du code produit).
export const CLAN = {'Banu Haqim':'n','Brujah':'o','Caitiff':'I','Gangrel':'p','Giovanni':'O','Lasombra':'w','Malkavian':'q','Ministry':'r','Nosferatu':'s','Ravnos':'b','Salubri':'c','Toreador':'t','Tremere':'u','Tzimisce':'k','Ventrue':'v'};
export const CLANS = Object.keys(CLAN).map(name => ({ name, glyph: CLAN[name] }));
export const ARCH = ['Bleed', 'Vote', 'Wall', 'Toolbox', 'Rush', 'Combo'];
export const DECKS = {
  banu: { key: 'banu', name: 'Banu Princes', tag: '#1234', clan: 'Banu Haqim', arch: 'Toolbox', versions: { 1: 'v1', 2: 'v2' }, vnote: { 1: 'septembre', 2: 'depuis le 10 octobre' } },
  tor: { key: 'tor', name: 'Toreador Mass Vote', tag: '#1187', clan: 'Toreador', arch: 'Vote', versions: { 1: 'v1' }, vnote: { 1: 'depuis le 5 septembre' } },
};
export const VENUES = { bar: 'Bar à Dés', donjon: 'Le Donjon' };
export const VENUE_CITY = { bar: 'Lyon', donjon: 'Villeurbanne' };
const d = (clan, arch) => ({ clan, arch });
const NONE = 'none';
// prey/pred/gprey/gpred : {clan, arch} | null (inconnu) | 'none' (pas de grande position)
export const GAMES = [
  { id: 1, date: '2026-09-05', time: '20:30', deck: 'tor', v: 1, type: 'amicale', venue: 'donjon', players: 4, seat: null, vp: 2, gw: true, opp: ['Marc'] },
  { id: 2, date: '2026-09-19', time: '13:30', deck: 'banu', v: 1, type: 'prelim', tour: 'Coupe du Rhône', round: 1, venue: 'donjon', players: 5, seat: 1, vp: 3, gw: true, prey: d('Ministry', 'Bleed'), pred: d('Brujah', 'Rush'), gprey: d('Gangrel', 'Rush'), gpred: d('Tzimisce', 'Toolbox'), opp: ['Léa'] },
  { id: 3, date: '2026-09-19', time: '15:40', deck: 'banu', v: 1, type: 'prelim', tour: 'Coupe du Rhône', round: 2, venue: 'donjon', players: 5, seat: 3, vp: 1, gw: false, prey: d('Tremere', 'Wall'), pred: d('Ventrue', 'Vote'), gprey: d('Toreador', 'Vote'), gpred: d('Ravnos', 'Combo'), opp: [] },
  { id: 4, date: '2026-09-19', time: '17:50', deck: 'banu', v: 1, type: 'prelim', tour: 'Coupe du Rhône', round: 3, venue: 'donjon', players: 5, seat: 4, vp: 2, gw: true, prey: null, pred: d('Brujah', 'Rush'), gprey: null, gpred: null, opp: ['Léa'] },
  { id: 5, date: '2026-09-19', time: '20:00', deck: 'banu', v: 1, type: 'prelim', tour: 'Coupe du Rhône', round: 4, venue: 'donjon', players: 4, seat: 2, vp: 0.5, gw: false, prey: d('Malkavian', 'Bleed'), pred: null, gprey: null, gpred: null, opp: [] },
  { id: 6, date: '2026-10-03', time: '21:00', deck: 'tor', v: 1, type: 'amicale', venue: 'bar', players: 3, seat: 1, vp: 1, gw: false, prey: null, pred: null, gprey: NONE, gpred: NONE, opp: ['Marc', 'Mikael'] },
  { id: 7, date: '2026-10-15', time: '20:45', deck: 'banu', v: 2, type: 'amicale', venue: 'bar', players: 4, seat: 3, vp: 4, gw: true, prey: d('Ministry', 'Bleed'), pred: d('Nosferatu', 'Toolbox'), gprey: d('Lasombra', 'Bleed'), gpred: d('Lasombra', 'Bleed'), opp: ['Marc'] },
  { id: 8, date: '2026-10-24', time: '14:10', deck: 'tor', v: 1, type: 'prelim', tour: 'Open de Lyon', round: 1, venue: 'bar', players: 5, seat: 4, vp: 1.5, gw: false, prey: null, pred: d('Ventrue', 'Vote'), gprey: null, gpred: null, opp: [] },
  { id: 9, date: '2026-10-24', time: '16:35', deck: 'banu', v: 2, type: 'prelim', tour: 'Open de Lyon', round: 2, venue: 'bar', players: 5, seat: 2, vp: 3, gw: true, prey: d('Ministry', 'Bleed'), pred: d('Brujah', 'Rush'), gprey: d('Gangrel', 'Rush'), gpred: d('Tzimisce', 'Toolbox'), opp: ['Léa', 'Mikael'] },
  { id: 10, date: '2026-10-24', time: '21:42', deck: 'banu', v: 2, type: 'prelim', tour: 'Open de Lyon', round: 3, venue: 'bar', players: 5, seat: 2, vp: 3, gw: true, prey: d('Tremere', 'Wall'), pred: null, gprey: d('Nosferatu', 'Rush'), gpred: d('Ministry', 'Bleed'), opp: ['Léa', 'Mikael', 'Marc'] },
  { id: 11, date: '2026-10-24', time: '23:58', deck: 'banu', v: 2, type: 'finale', tour: 'Open de Lyon', venue: 'bar', players: 5, seat: 2, vp: 2, gw: false, prey: d('Malkavian', 'Bleed'), pred: d('Nosferatu', 'Toolbox'), gprey: d('Toreador', 'Vote'), gpred: null, opp: ['Léa'] },
  { id: 12, date: '2026-10-29', time: '20:30', deck: 'tor', v: 1, type: 'amicale', venue: 'donjon', players: 5, seat: null, vp: 1.5, gw: false, opp: ['Marc'] },
  { id: 13, date: '2026-11-05', time: '20:30', deck: 'banu', v: 2, type: 'amicale', venue: 'donjon', players: 4, seat: 1, vp: 2, gw: false, prey: d('Ministry', 'Bleed'), pred: d('Brujah', 'Rush'), gprey: d('Gangrel', 'Rush'), gpred: d('Gangrel', 'Rush'), opp: ['Marc', 'Mikael'] },
  { id: 14, date: '2026-11-07', time: '21:15', deck: 'tor', v: null, pending: true, type: 'amicale', venue: 'bar', players: 5, seat: 3, vp: 0, gw: false, prey: d('Tremere', 'Wall'), pred: d('Ventrue', 'Vote'), gprey: d('Lasombra', 'Bleed'), gpred: d('Ravnos', 'Combo'), opp: ['Mikael'] },
];
export const TYPES = [['amicale', 'Amicale'], ['prelim', 'Préliminaire'], ['finale', 'Finale']];
export const PERIODS = [['year', 'Cette année'], ['12m', '12 derniers mois'], ['all', 'Tout']];
export const PERIOD_RANGE = { year: ['1er janv. 2026', '8 nov. 2026'], '12m': ['9 nov. 2025', '8 nov. 2026'], all: ['5 sept. 2026', '8 nov. 2026'] };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const num = x => String(x).replace('.', ',');
export const avg1 = (vp, n) => n ? (Math.round(vp / n * 10) / 10).toFixed(1).replace('.', ',') : '—';
export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export function agg(list) {
  const n = list.length, gw = list.filter(g => g.gw).length, vp = list.reduce((s, g) => s + g.vp, 0);
  return {
    n, gw, vp, avg: n ? vp / n : 0,
    nLabel: plural(n, 'partie', 'parties'), gwLabel: `${gw} GW`, vpLabel: `${num(vp)} VP`, avgLabel: avg1(vp, n),
    gwOf: `${gw} GW sur ${plural(n, 'partie', 'parties')}`,
    meta: `${gw} GW sur ${plural(n, 'partie', 'parties')} · ${num(vp)} VP`,
    gwBar: n ? `${Math.round(gw / n * 100)}%` : '0%',
    vpBar: `${Math.min(100, Math.round((n ? vp / n : 0) / 5 * 100))}%`,
  };
}

export function filterGames(f) {
  return GAMES.filter(g => (f.types.length === 0 || f.types.includes(g.type)) && (f.deck === 'all' || g.deck === f.deck));
}

const posKey = (p, by) => p === null ? '__unknown' : (by === 'clan' ? p.clan : p.arch);

export function groupPos(list, pos, by) {
  const withSeat = list.filter(g => g.seat != null);
  const noSeat = list.length - withSeat.length;
  const eligible = withSeat.filter(g => g[pos] !== 'none');
  const noGrand = withSeat.length - eligible.length;
  const m = new Map();
  eligible.forEach(g => { const k = posKey(g[pos], by); if (!m.has(k)) m.set(k, []); m.get(k).push(g); });
  const rows = [...m.entries()].sort((a, b) => a[0] === '__unknown' ? 1 : b[0] === '__unknown' ? -1 : a[0].localeCompare(b[0], 'fr'))
    .map(([k, gs]) => ({ key: k, label: k === '__unknown' ? 'inconnu' : k, unknown: k === '__unknown', glyph: by === 'clan' && k !== '__unknown' ? CLAN[k] : '', ...agg(gs), games: gs }));
  return { rows, noSeat, noGrand, eligible: eligible.length };
}

export function axes(list) {
  const deckRows = Object.values(DECKS).map(dk => {
    const gs = list.filter(g => g.deck === dk.key);
    if (!gs.length) return null;
    const vs = [...new Set(gs.map(g => g.v))].sort((a, b) => (a ?? 99) - (b ?? 99));
    return { key: dk.key, label: dk.name, glyph: CLAN[dk.clan], clan: dk.clan, arch: dk.arch, ...agg(gs), games: gs,
      versions: vs.map(v => ({ key: `${dk.key}-${v}`, label: v == null ? 'liste figée à la synchronisation' : `v${v}`, note: v == null ? 'en attente' : dk.vnote[v], pending: v == null, ...agg(gs.filter(g => g.v === v)) })) };
  }).filter(Boolean);
  const venueRows = Object.keys(VENUES).map(k => { const gs = list.filter(g => g.venue === k); return gs.length ? { key: k, label: VENUES[k], sub: VENUE_CITY[k], ...agg(gs), games: gs } : null; })
    .filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const months = [...new Set(list.map(g => g.date.slice(0, 7)))].sort().reverse();
  const monthRows = months.map(mk => { const gs = list.filter(g => g.date.startsWith(mk)); const mi = +mk.slice(5, 7) - 1; return { key: mk, label: `${MONTHS[mi][0].toUpperCase()}${MONTHS[mi].slice(1)} ${mk.slice(0, 4)}`, ...agg(gs), games: gs }; });
  const names = [...new Set(list.flatMap(g => g.opp))].sort((a, b) => a.localeCompare(b, 'fr'));
  const oppRows = names.map(nm => { const gs = list.filter(g => g.opp.includes(nm)); return { key: nm, label: nm, ...agg(gs), games: gs }; });
  return { deckRows, venueRows, monthRows, oppRows };
}

export function summary(list) {
  const a = agg(list);
  const tours = [...new Set(list.filter(g => g.tour).map(g => g.tour))].length;
  const finals = list.filter(g => g.type === 'finale').length;
  return { ...a, tours, finals, toursLabel: plural(tours, 'tournoi joué', 'tournois joués'), finalsLabel: plural(finals, 'finale atteinte', 'finales atteintes') };
}

export const gameLabel = g => {
  const dd = g.date.slice(8, 10) + '/' + g.date.slice(5, 7);
  const ctx = g.type === 'amicale' ? 'Amicale' : g.type === 'finale' ? `${g.tour} · finale` : `${g.tour} · ronde ${g.round}`;
  return { date: dd, time: g.time, ctx, deck: DECKS[g.deck].name, venue: VENUES[g.venue], result: `${num(g.vp)} VP`, gw: g.gw, pending: !!g.pending, version: g.v ? `v${g.v}` : 'à la synchro' };
};

// Listes de versions (carte × quantité seulement)
const C = (name, cap, disc, clan, group, n) => ({ name, cap, disc, clan, group, n });
const L = (type, name, n, o = {}) => ({ type, name, n, ...o });
const CRYPT_V2 = [C('Tegyrius, Vizier', 10, ['CEL', 'OBF', 'QUI', 'aus', 'pre'], 'Banu Haqim', 4, 2), C('Al-Muntathir', 10, ['CEL', 'OBF', 'QUI', 'aus'], 'Banu Haqim', 5, 2), C('Kassiym Malikhair', 9, ['CEL', 'OBF', 'QUI', 'dom'], 'Banu Haqim', 4, 2), C('Fatima al-Faqadi', 8, ['CEL', 'OBF', 'QUI', 'aus'], 'Banu Haqim', 4, 2), C('Enam', 7, ['CEL', 'QUI', 'obf'], 'Banu Haqim', 4, 2), C('Hasani', 6, ['QUI', 'cel', 'obf'], 'Banu Haqim', 5, 2)];
const CRYPT_V1 = [C('Tegyrius, Vizier', 10, ['CEL', 'OBF', 'QUI', 'aus', 'pre'], 'Banu Haqim', 4, 2), C('Al-Muntathir', 10, ['CEL', 'OBF', 'QUI', 'aus'], 'Banu Haqim', 5, 2), C('Kassiym Malikhair', 9, ['CEL', 'OBF', 'QUI', 'dom'], 'Banu Haqim', 4, 2), C('Jamal', 7, ['CEL', 'QUI', 'obf'], 'Banu Haqim', 4, 2), C('Enam', 7, ['CEL', 'QUI', 'obf'], 'Banu Haqim', 4, 2), C('Hasani', 6, ['QUI', 'cel', 'obf'], 'Banu Haqim', 5, 2)];
const LIB_V2 = [L('Master', 'Blood Doll', 3), L('Master', 'Vessel', 4), L('Master', 'Information Highway', 1, { cost: 1, ct: 'pool' }), L('Master', 'Path of Blood, The', 2, { cost: 1, ct: 'pool', clan: 'Banu Haqim' }),
  L('Political Action', 'Kine Resources Contested', 4), L('Political Action', 'Parity Shift', 3), L('Political Action', 'Consanguineous Boon', 2),
  L('Action Modifier', 'Swallowed by the Night', 6, { d: ['obf'] }), L('Combat', 'Blur', 4, { d: ['cel'] }), L('Combat', 'Taste of Vitae', 5),
  L('Reaction', 'Eyes of Argus', 6, { d: ['aus'] }), L('Reaction', 'Forced Awakening', 4), L('Reaction', 'On the Qui Vive', 4)];
const LIB_V1 = [L('Master', 'Blood Doll', 3), L('Master', 'Vessel', 4), L('Master', 'Information Highway', 1, { cost: 1, ct: 'pool' }), L('Master', 'Path of Blood, The', 2, { cost: 1, ct: 'pool', clan: 'Banu Haqim' }),
  L('Political Action', 'Kine Resources Contested', 4), L('Political Action', 'Parity Shift', 5),
  L('Action Modifier', 'Swallowed by the Night', 6, { d: ['obf'] }), L('Combat', 'Blur', 4, { d: ['cel'] }), L('Combat', 'Taste of Vitae', 5),
  L('Reaction', 'Eyes of Argus', 4, { d: ['aus'] }), L('Reaction', 'Forced Awakening', 4), L('Reaction', 'On the Qui Vive', 4)];
export const VERSIONS = { 'banu-2': { crypt: CRYPT_V2, lib: LIB_V2 }, 'banu-1': { crypt: CRYPT_V1, lib: LIB_V1 } };

const DISC = { abo: 'w', ani: 'i', aus: 'a', cel: 'c', chi: 'k', dai: 'y', dem: 'e', dom: 'd', for: 'f', mel: 'm', myt: 'x', nec: 'n', obe: 'b', obf: 'o', pot: 'p', pre: 'r', pro: 'j', qui: 'q', san: 'g', ser: 's', spi: 'z', tha: 't', thn: 'h', val: 'l', vic: 'v', vis: 'u' };
const TYPE_G = { 'Action': '0', 'Action Modifier': '1', 'Political Action': '2', 'Ally': '3', 'Combat': '4', 'Equipment': '5', 'Reflex': '6', 'Reaction': '7', 'Retainer': '8', 'Event': '[' };
const POOL_G = { 1: '"', 2: ':', 3: '/', 4: '\\', 5: ']', 6: '`' };
const TYPE_ORDER = ['Master', 'Action', 'Action Modifier', 'Political Action', 'Ally', 'Equipment', 'Retainer', 'Combat', 'Reaction', 'Event'];
const glyph = x => { const lo = x.toLowerCase(); return { glyph: x === x.toUpperCase() ? DISC[lo].toUpperCase() : DISC[lo], label: x }; };
const sum = a => a.reduce((s, c) => s + c.n, 0);
const zebra = i => i % 2 ? 'color-mix(in oklab, var(--color-neutral-800) 45%, transparent)' : 'transparent';

export function tables(vkey) {
  const v = VERSIONS[vkey];
  const cc = sum(v.crypt), gs = [...new Set(v.crypt.map(c => c.group))].sort();
  let pool = 0;
  const groups = TYPE_ORDER.map(t => {
    const cards = v.lib.filter(c => c.type === t);
    if (!cards.length) return null;
    cards.forEach(c => { if (c.ct === 'pool') pool += c.cost * c.n; });
    return { type: t, glyph: TYPE_G[t] || '', count: sum(cards), note: '', cards: cards.map((c, i) => ({ name: c.name, n: c.n, bg: zebra(i), discs: (c.d || []).map(glyph), clan: c.clan || '', clanGlyph: c.clan ? CLAN[c.clan] : '', cost: c.cost ? POOL_G[c.cost] : '', costLabel: c.cost ? `${c.cost} réserve` : '', proxy: '' })) };
  }).filter(Boolean);
  return { editable: false, readOnly: true, qtyCol: '26px', showProxies: false,
    crypt: [...v.crypt].sort((a, b) => b.cap - a.cap).map((c, i) => ({ ...c, bg: zebra(i), clanGlyph: CLAN[c.clan], discs: c.disc.map(glyph) })),
    cryptCount: cc, cryptAvg: (v.crypt.reduce((s, c) => s + c.cap * c.n, 0) / cc).toFixed(1), cryptGroups: `G${gs.join('–')}`,
    groups, libCount: sum(v.lib), libBlood: 0, libPool: pool };
}

export function diff(fromKey, toKey) {
  const a = VERSIONS[fromKey], b = VERSIONS[toKey];
  const all = x => new Map([...x.crypt, ...x.lib].map(c => [c.name, c.n]));
  const ma = all(a), mb = all(b), inn = [], out = [], chg = [];
  mb.forEach((n, k) => { if (!ma.has(k)) inn.push({ name: k, q: `+${n}` }); else if (ma.get(k) !== n) chg.push({ name: k, q: `${ma.get(k)} → ${n}` }); });
  ma.forEach((n, k) => { if (!mb.has(k)) out.push({ name: k, q: `−${n}` }); });
  return { inn, out, chg };
}
