#!/usr/bin/env node
/**
 * @file Génération de la page de suivi des changements.
 *
 * Produit `output/rapport/index.html`, une page **entièrement autonome** : les données y sont
 * embarquées dans une balise de script, si bien qu'elle s'ouvre par un double-clic, sans serveur,
 * sans connexion et sans installation. On peut l'envoyer par courriel ou la copier sur une clé.
 *
 * Ce choix est délibéré. Le public visé, des responsables de clubs, n'a ni serveur ni envie d'en
 * administrer un. Un fichier unique qu'on ouvre dans son navigateur est ce qui demande le moins.
 * La même page peut par ailleurs être déposée telle quelle sur un hébergement statique.
 *
 * ## Contenu
 *
 * Trois onglets : les changements sur une période choisie dans un menu, le calendrier courant avec
 * un filtre texte, et l'historique des relevés.
 *
 * ## Utilisation
 *
 * ```
 * node src/rapport.js [--out output]
 * ```
 *
 * Appelée aussi automatiquement en fin de `scrape` et de `reparse`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listerSnapshots, chargerSnapshot, comparer } from "./historique.js";

/**
 * Compare tous les relevés archivés et écrit la page de suivi.
 *
 * Chaque couple de relevés consécutifs devient une « période ». Elles sont présentées de la plus
 * récente à la plus ancienne, l'ordre dans lequel on les consulte.
 *
 * Un fichier `diffs.json` est écrit à côté de la page : il contient les mêmes données, à
 * disposition d'un traitement automatique qui voudrait, par exemple, envoyer un courriel
 * récapitulatif.
 *
 * @param {string} outDir dossier de sortie
 * @param {(msg: string) => void} [log]
 * @returns {Promise<string|null>} chemin de la page écrite, ou `null` si aucun relevé n'est archivé
 */
export async function genererRapport(outDir, log = () => {}) {
  const snapshots = await listerSnapshots(outDir);
  if (!snapshots.length) {
    log("Aucun snapshot dans output/historique : lancez d'abord npm run scrape.");
    return null;
  }
  const charges = [];
  for (const s of snapshots) charges.push({ date: s.date, competitions: await chargerSnapshot(s.fichier) });

  // Une période par couple de relevés consécutifs. Avec un seul relevé, la liste reste vide et la
  // page invite simplement à revenir après le suivant.
  const periodes = [];
  for (let i = 1; i < charges.length; i++) {
    const diff = comparer(charges[i - 1].competitions, charges[i].competitions);
    periodes.push({ de: charges[i - 1].date, a: charges[i].date, ...diff });
  }

  // Le dernier relevé fournit l'onglet « calendrier actuel », réduit aux colonnes affichées :
  // la page embarque ses données, inutile d'y recopier le texte intégral des mandats.
  const dernier = charges[charges.length - 1];
  const etat = dernier.competitions.map((c) => ({
    id: String(c.id),
    titre: c.titre,
    date_debut: c.date_debut,
    dates: c.dates_texte,
    discipline: c.detail?.champs?.discipline || c.discipline,
    organisateur: c.organisateur,
    departement: c.departement?.code || "",
    url: c.url,
    mandat_url: c.mandat_url,
    departs: c.mandat?.infos?.departs?.filter((d) => !d.hors_epreuve).length || 0,
    date_limite: c.mandat?.infos?.date_limite_iso || "",
  }));

  const data = {
    genere_le: new Date().toISOString(),
    snapshots: charges.map((c) => ({ date: c.date, nb: c.competitions.length, mandats: c.competitions.filter((x) => x.mandat).length })),
    periodes: periodes.reverse(), // la plus récente d'abord
    etat: { date: dernier.date, competitions: etat },
  };

  const dir = path.join(outDir, "rapport");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "diffs.json"), JSON.stringify(data, null, 2));
  const html = rendreHtml(data);
  const file = path.join(dir, "index.html");
  await fs.writeFile(file, html);
  log(`Rapport : ${file} (${snapshots.length} snapshot${snapshots.length > 1 ? "s" : ""}, ${periodes.length} période${periodes.length > 1 ? "s" : ""})`);
  return file;
}

/**
 * Compose la page HTML autonome.
 *
 * Tout tient dans un seul fichier : styles, script et données. Aucune bibliothèque externe, aucune
 * police à télécharger, ce qui garantit que la page fonctionne hors ligne et ne vieillit pas.
 *
 * Le thème suit les préférences du système, clair ou sombre, par variables CSS.
 *
 * @param {object} data données préparées par `genererRapport`
 * @returns {string} le document HTML complet
 */
function rendreHtml(data) {
  // Les données sont sérialisées dans une balise script de type `application/json`, que le
  // navigateur n'exécute pas. L'échappement de `<` empêche qu'une valeur contenant `</script>`
  // referme la balise prématurément, ce qui casserait la page.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Concours FFTA – suivi des changements</title>
<style>
  :root { --bg:#f7f7f5; --fg:#1d1d1b; --muted:#6b6b66; --line:#e2e2dd; --card:#fff; --accent:#1f5fa8;
          --ok:#1e7d4e; --ok-bg:#e7f5ec; --warn:#9a5b00; --warn-bg:#fff4e0; --bad:#a8231f; --bad-bg:#fbe9e8; --info:#2b5f8f; --info-bg:#e8f0fa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16171a; --fg:#ececea; --muted:#9a9a95; --line:#2d2f34; --card:#1f2126; --accent:#7fb2ee;
            --ok:#7fd3a2; --ok-bg:#173324; --warn:#f0b866; --warn-bg:#3a2a10; --bad:#f08b86; --bad-bg:#3d1c1a; --info:#8fbcec; --info-bg:#1a2c40; }
  }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
  header { padding:20px 24px 12px; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:16px; align-items:baseline }
  h1 { font-size:20px; margin:0 }
  h2 { font-size:16px; margin:28px 0 10px }
  main { padding:8px 24px 40px; max-width:1200px }
  .muted { color:var(--muted) }
  select, input { font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--card); color:var(--fg) }
  .cards { display:flex; flex-wrap:wrap; gap:10px; margin:14px 0 }
  .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 14px; min-width:130px }
  .card b { display:block; font-size:22px }
  .tag { display:inline-block; padding:1px 7px; border-radius:10px; font-size:12px; white-space:nowrap }
  .ok { color:var(--ok); background:var(--ok-bg) } .warn { color:var(--warn); background:var(--warn-bg) }
  .bad { color:var(--bad); background:var(--bad-bg) } .info { color:var(--info); background:var(--info-bg) }
  table { border-collapse:collapse; width:100%; background:var(--card); border:1px solid var(--line); border-radius:8px; overflow:hidden }
  th, td { text-align:left; padding:7px 10px; border-top:1px solid var(--line); vertical-align:top }
  th { background:transparent; color:var(--muted); font-weight:600; border-top:0; font-size:12px; text-transform:uppercase; letter-spacing:.03em }
  .wrap { overflow-x:auto }
  a { color:var(--accent); text-decoration:none } a:hover { text-decoration:underline }
  .change { display:grid; grid-template-columns: 160px 1fr 1fr; gap:6px 10px; padding:4px 0; border-top:1px dashed var(--line) }
  .change:first-child { border-top:0 }
  .before { color:var(--bad); text-decoration:line-through; opacity:.8 } .after { color:var(--ok) }
  .empty { color:var(--muted); font-style:italic; padding:8px 0 }
  nav.tabs { display:flex; gap:6px; margin:16px 0 4px; flex-wrap:wrap }
  nav.tabs button { font:inherit; padding:6px 12px; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:6px; cursor:pointer }
  nav.tabs button.active { background:var(--accent); color:#fff; border-color:var(--accent) }
  section[hidden] { display:none }
  .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:10px 0 }
</style>
</head>
<body>
<header>
  <h1>Concours FFTA – suivi des changements</h1>
  <span class="muted" id="meta"></span>
</header>
<main>
  <nav class="tabs">
    <button class="active" data-tab="diff">Changements</button>
    <button data-tab="etat">Calendrier actuel</button>
    <button data-tab="hist">Historique</button>
  </nav>

  <section id="tab-diff">
    <div class="toolbar">
      <label>Période <select id="periode"></select></label>
    </div>
    <div id="diff"></div>
  </section>

  <section id="tab-etat" hidden>
    <div class="toolbar">
      <input id="filtre" placeholder="Filtrer (titre, club, discipline, département)…" size="45">
      <span class="muted" id="etat-count"></span>
    </div>
    <div class="wrap"><table id="etat"></table></div>
  </section>

  <section id="tab-hist" hidden>
    <div class="wrap"><table id="hist"></table></div>
  </section>
</main>
<script id="data" type="application/json">${json}</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fr = d => d ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' }) : '';
const lien = c => '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.titre) + '</a>';
const mandatLien = c => c.mandat_url ? ' <a class="tag info" href="' + esc(c.mandat_url) + '" target="_blank" rel="noopener">mandat</a>' : '';

document.getElementById('meta').textContent = 'Généré le ' + new Date(DATA.genere_le).toLocaleString('fr-FR') + ' · ' + DATA.snapshots.length + ' relevé(s)';

// Onglets
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav.tabs button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== 'tab-' + b.dataset.tab);
});

// Période
const sel = document.getElementById('periode');
if (!DATA.periodes.length) {
  sel.innerHTML = '<option>Un seul relevé pour l’instant</option>';
  document.getElementById('diff').innerHTML = '<p class="empty">Les changements apparaîtront à partir du deuxième relevé.</p>';
} else {
  sel.innerHTML = DATA.periodes.map((p, i) => '<option value="' + i + '">du ' + fr(p.de) + ' au ' + fr(p.a) + '</option>').join('');
  sel.onchange = () => rendreDiff(DATA.periodes[sel.value]);
  rendreDiff(DATA.periodes[0]);
}

function rendreDiff(p) {
  const r = p.resume;
  let h = '<div class="cards">'
    + carte(r.apparus, 'Nouveaux concours', 'ok') + carte(r.disparus, 'Concours retirés', 'bad')
    + carte(r.modifies, 'Fiches modifiées', 'warn') + carte(r.mandats_publies, 'Mandats publiés', 'info')
    + carte(r.mandats_modifies, 'Mandats modifiés', 'warn')
    + '<div class="card"><span class="muted">Concours au ' + fr(p.a) + '</span><b>' + r.apres + '</b><span class="muted">' + r.avant + ' au ' + fr(p.de) + '</span></div>'
    + '</div>';

  h += '<h2>Nouveaux concours</h2>' + tableConcours(p.apparus);
  h += '<h2>Concours retirés du calendrier</h2>' + tableConcours(p.disparus);
  h += '<h2>Fiches modifiées</h2>' + tableChangements(p.modifies);
  h += '<h2>Mandats publiés</h2>' + tableMandats(p.mandats_publies);
  h += '<h2>Mandats modifiés</h2>' + tableChangements(p.mandats_modifies);
  document.getElementById('diff').innerHTML = h;
}
function carte(n, label) { return '<div class="card"><span class="muted">' + label + '</span><b class="' + (n ? '' : 'muted') + '">' + n + '</b></div>'; }

function tableConcours(l) {
  if (!l.length) return '<p class="empty">Aucun.</p>';
  return '<div class="wrap"><table><tr><th>Date</th><th>Concours</th><th>Discipline</th><th>Organisateur</th><th>Dép.</th></tr>'
    + l.map(c => '<tr><td>' + esc(c.dates) + '</td><td>' + lien(c) + mandatLien(c) + '</td><td>' + esc(c.discipline) + '</td><td>' + esc(c.organisateur) + '</td><td>' + esc(c.departement) + '</td></tr>').join('')
    + '</table></div>';
}
function tableChangements(l) {
  if (!l.length) return '<p class="empty">Aucune.</p>';
  return '<div class="wrap"><table><tr><th>Date</th><th>Concours</th><th>Changements</th></tr>'
    + l.map(c => '<tr><td>' + esc(c.dates) + '</td><td>' + lien(c) + mandatLien(c) + '<br><span class="muted">' + esc(c.organisateur) + '</span></td><td>'
      + c.changements.map(ch => '<div class="change"><span class="muted">' + esc(ch.libelle) + '</span><span class="before">' + esc(ch.avant ?? '—') + '</span><span class="after">' + esc(ch.apres ?? '—') + '</span></div>').join('')
      + '</td></tr>').join('')
    + '</table></div>';
}
function tableMandats(l) {
  if (!l.length) return '<p class="empty">Aucun.</p>';
  return '<div class="wrap"><table><tr><th>Date</th><th>Concours</th><th>Départs</th><th>Tarifs</th><th>Date limite</th><th>Inscription</th></tr>'
    + l.map(c => {
      const m = c.mandat;
      const dep = m.departs.length ? m.departs.map(d => esc(d.nom) + (d.debut ? ' ' + esc(d.debut.replace('T', ' ')) : '') + (d.places ? ' (' + d.places + ' pl.)' : '')).join('<br>') : '<span class="muted">non lus</span>';
      const tar = m.tarifs.length ? m.tarifs.map(t => t.departs + ' dép. ' + t.public + ' ' + (t.montant_cents / 100).toFixed(2).replace('.', ',') + ' €').join('<br>') : '<span class="muted">non lus</span>';
      const fiab = (ok) => ok ? '' : ' <span class="tag warn">à vérifier</span>';
      return '<tr><td>' + esc(c.dates) + '</td><td>' + lien(c) + mandatLien(c) + '<br><span class="muted">' + esc(c.organisateur) + '</span></td><td>' + dep + fiab(m.fiable.departs) + '</td><td>' + tar + fiab(m.fiable.tarifs) + '</td><td>' + fr(m.date_limite) + '</td><td>' + esc(m.inscription ?? '') + '</td></tr>';
    }).join('')
    + '</table></div>';
}

// Calendrier actuel
const etatTable = document.getElementById('etat');
const filtre = document.getElementById('filtre');
function rendreEtat() {
  const q = filtre.value.trim().toLowerCase();
  const rows = DATA.etat.competitions.filter(c => !q || [c.titre, c.organisateur, c.discipline, c.departement, c.dates].join(' ').toLowerCase().includes(q));
  document.getElementById('etat-count').textContent = rows.length + ' concours au ' + fr(DATA.etat.date);
  etatTable.innerHTML = '<tr><th>Date</th><th>Concours</th><th>Discipline</th><th>Organisateur</th><th>Dép.</th><th>Mandat</th><th>Date limite</th></tr>'
    + rows.map(c => '<tr><td>' + esc(c.dates) + '</td><td>' + lien(c) + '</td><td>' + esc(c.discipline) + '</td><td>' + esc(c.organisateur) + '</td><td>' + esc(c.departement) + '</td><td>'
      + (c.mandat_url ? '<a class="tag info" href="' + esc(c.mandat_url) + '" target="_blank" rel="noopener">PDF</a>' + (c.departs ? ' <span class="muted">' + c.departs + ' départ' + (c.departs > 1 ? 's' : '') + '</span>' : '') : '<span class="muted">—</span>')
      + '</td><td>' + fr(c.date_limite) + '</td></tr>').join('');
}
filtre.oninput = rendreEtat;
rendreEtat();

// Historique
document.getElementById('hist').innerHTML = '<tr><th>Relevé</th><th>Concours</th><th>Mandats</th></tr>'
  + DATA.snapshots.slice().reverse().map(s => '<tr><td>' + fr(s.date) + '</td><td>' + s.nb + '</td><td>' + s.mandats + '</td></tr>').join('');
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- Utilisation en ligne de commande
//
// Ce fichier est à la fois un module, importé par `scrape.js` et `reparse.js`, et un programme
// exécutable. La condition distingue les deux cas : elle n'est vraie que si ce fichier est celui
// que Node a été chargé de lancer.
//
// La conversion en URL est nécessaire sous Windows, où `process.argv[1]` vaut « D:\... » alors que
// `import.meta.url` vaut « file:///D:/... ». Comparer les deux directement échouerait toujours.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--out");
  const outDir = path.resolve(i >= 0 ? args[i + 1] : "output");
  await genererRapport(outDir, (m) => console.error(m));
}
