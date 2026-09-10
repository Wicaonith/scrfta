import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { extractPdfText } from "./pdf.js";
import { parseDateFr, addDays } from "./dates.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/**
 * Télécharge le PDF de mandat (extranet.ffta.fr n'est pas derrière le challenge Cloudflare).
 * Un fichier déjà présent est retéléchargé seulement si le serveur annonce un Last-Modified plus récent.
 * Renvoie { file, modifie_le (ISO ou null), retelecharge }.
 */
export async function downloadMandat(url, destDir) {
  const name = path.basename(new URL(url).pathname);
  const dest = path.join(destDir, name);
  const meta = dest + ".json";
  let existing = null;
  try {
    await fs.access(dest);
    existing = JSON.parse(await fs.readFile(meta, "utf8").catch(() => "{}"));
  } catch {}

  let lastModified = null;
  if (existing) {
    try {
      const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
      lastModified = toIso(head.headers.get("last-modified"));
    } catch {}
    if (!lastModified || lastModified === existing.modifie_le) {
      // Empreinte du contenu : un même PDF est parfois publié sous deux noms pour deux épreuves
      if (!existing.hash) {
        existing.hash = sha1(await fs.readFile(dest));
        await fs.writeFile(meta, JSON.stringify(existing, null, 2));
      }
      return { file: dest, modifie_le: existing.modifie_le || lastModified, retelecharge: false, hash: existing.hash };
    }
  }

  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("pdf")) throw new Error(`Type inattendu (${ct}) pour ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  const modifie_le = toIso(res.headers.get("last-modified"));
  const hash = sha1(buf);
  await fs.writeFile(meta, JSON.stringify({ url, modifie_le, hash, telecharge_le: new Date().toISOString() }, null, 2));
  return { file: dest, modifie_le, retelecharge: !!existing, hash };
}

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function toIso(httpDate) {
  if (!httpDate) return null;
  const d = new Date(httpDate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Extrait le texte du PDF (mise en page conservée, OCR sur les pages scannées)
 * et quelques informations structurées par heuristiques.
 */
export async function parseMandat(file, { ocr = true, contexte = {} } = {}) {
  const { text: raw, pages, ocr: ocrUsed, ocr_pages, ocr_text } = await extractPdfText(file, { ocr });
  const text = normalize(raw);
  const texte_ocr = ocrUsed ? normalize(ocr_text) : "";
  return {
    fichier: path.basename(file),
    pages,
    ocr: ocrUsed,
    ocr_pages,
    infos: extractInfos(text, { ...contexte, texte_ocr }),
    texte: text,
    texte_ocr,
  };
}

/** Recalcule uniquement les informations dépendant du contexte (dates du concours) sur un texte déjà extrait. */
export function reextractInfos(texte, contexte = {}) {
  return extractInfos(texte, contexte);
}

function normalize(t) {
  return t
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const uniq = (arr) => [...new Set(arr)];
const lines = (text) => text.split("\n");

const SHORT_URL_HOSTS =
  /(urlz\.fr|bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|lc\.cx|shorturl\.at|is\.gd|rb\.gy|ow\.ly|tiny\.cc|frama\.link|s\.42l\.fr|u\.nu|v\.gd)/i;
const INSCRIPTION_URL =
  /inscript|inscriptarc|helloasso|forms|docs\.google|framaforms|sportsregions|arc-en-ligne|compet|formulaire|typeform|weezevent|billetweb/i;

function extractInfos(text, contexte = {}) {
  const lower = text.toLowerCase();
  const infos = {};
  const ref = { debut: contexte.date_debut || null, fin: contexte.date_fin || contexte.date_debut || null };

  infos.emails = uniq(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map((e) => e.replace(/[.,;:]+$/, ""));
  infos.telephones = uniq(
    (text.match(/(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}/g) || []).map((t) => t.replace(/[\s.-]/g, ""))
  );
  infos.urls = uniq(text.match(/(?:https?:\/\/|www\.)[^\s|)>\]"']+/g) || []).map((u) => u.replace(/[.,;]+$/, ""));

  // ---- Inscription : mode (mail / url / courrier), destinataires, texte source
  infos.inscription = extractInscription(text, infos);
  infos.inscription_urls = infos.inscription.urls;

  // ---- Tarifs : tableaux (colonnes séparées par " | ") ou lignes contenant un montant
  infos.tarifs = extractTarifs(text);

  // ---- Horaires : lignes avec une heure et un mot-clé de planning
  infos.horaires = uniq(
    lines(text).filter(
      (l) =>
        /\b\d{1,2}\s?[hH:]\s?\d{0,2}\b/.test(l) &&
        /(d[ée]part|greffe|échauffement|echauffement|ouverture|tir|inscription|remise|début|debut|fin|matin|après-midi|apres-midi|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|résultat|resultat)/i.test(
          l
        ) &&
        !/factur|pénalit|penalit/i.test(l)
    )
  );

  // ---- Dates en toutes lettres
  infos.dates = uniq(
    text.match(
      /\b\d{1,2}(?:er)?\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+\d{4})?/gi
    ) || []
  );

  // ---- Arbitres
  const arb = text.match(/arbitres?\s*(?:responsable)?\s*:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i);
  if (arb) infos.arbitres = arb[1].trim();

  // ---- Distances, blasons
  infos.distances = uniq(text.match(/\b\d{1,3}\s?m(?:ètres|etres)?\b/gi) || []).map((d) => d.replace(/\s/g, ""));
  const blasons = text.match(/blasons?[^\n]*/gi);
  if (blasons) infos.blasons = uniq(blasons.map((b) => b.trim()));

  // ---- Date limite d'inscription
  const DATE_RE = /\d{1,2}\/\d{1,2}|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre/i;
  const ls = lines(text);
  const candidats = ls
    .map((l, i) => ({ l: l.trim(), ctx: (ls[i - 1] || "") + " " + l }))
    .filter(
      ({ l }) =>
        /(date limite|clôture|cloture|jusqu'au|jusqu’au|avant le|au plus tard)/i.test(l) &&
        DATE_RE.test(l) &&
        !/factur|pénalit|penalit|désistement|desistement|sandwich|repas|commande|prioritaire/i.test(l)
    );
  // On préfère une ligne qui parle explicitement d'inscription
  const limite = candidats.find(({ ctx }) => /inscri/i.test(ctx)) || candidats[0];
  infos.date_limite_iso = null;
  if (limite) {
    infos.date_limite_inscription = limite.l;
    // On ne garde que la partie après le mot-clé pour ne pas attraper une autre date de la phrase
    const apres = limite.l.split(/date limite|clôture|cloture|jusqu'au|jusqu’au|avant le|au plus tard/i).pop();
    const { date, heure } = parseDateFr(apres, { ...ref, limite: true });
    infos.date_limite_iso = date ? (heure ? `${date}T${heure}` : date) : null;
  }

  // ---- Départs (créneaux) et jauge
  infos.jauge = extractJauge(text);
  infos.departs = extractDeparts(text, ref, infos.jauge);

  // ---- Fiabilité : cohérence des valeurs et absence de bruit OCR à la source
  // Les lignes comparées ont pu être normalisées (séparateurs de colonnes remplacés par des espaces) :
  // on aplatit les deux côtés de la même façon, sinon la comparaison échoue toujours.
  const aplatir = (s) => String(s || "").replace(/\s*\|\s*/g, " ").trim();
  const ocrTxt = aplatir(contexte.texte_ocr);
  const vientDeOcr = (l) => !!ocrTxt && !!l && ocrTxt.includes(aplatir(l));
  infos.tarifs.fiable = fiabiliteTarifs(infos.tarifs, vientDeOcr);
  infos.departs_fiable = fiabiliteDeparts(infos.departs, vientDeOcr, text);

  // ---- Buvette / restauration
  infos.buvette = /buvette|restauration|sandwich|repas/.test(lower);

  // ---- Adresse : première ligne contenant code postal + ville
  const adresse = text.match(/\b\d{5}\s+[A-ZÉÈÀ][A-ZÉÈÀa-zéèàêôûïç' -]+/);
  if (adresse) infos.adresse = adresse[0].trim();

  return infos;
}

// ---------------------------------------------------------------- Fiabilité

/**
 * Grille tarifaire jugée fiable si : non vide, montants plausibles (2 à 60 €), jeune ≤ adulte,
 * montants croissants avec le nombre de départs, et aucune ligne source issue de l'OCR.
 */
function fiabiliteTarifs(tarifs, vientDeOcr) {
  const g = tarifs.grille;
  if (!g.length) return false;
  const vals = g.flatMap((t) => [t.adulte, t.jeune]).filter((v) => v !== null);
  if (!vals.length || vals.some((v) => v < 2 || v > 60)) return false;
  for (const t of g) if (t.adulte !== null && t.jeune !== null && t.jeune > t.adulte) return false;
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1], b = g[i];
    if (a.adulte !== null && b.adulte !== null && b.adulte < a.adulte) return false;
    if (a.jeune !== null && b.jeune !== null && b.jeune < a.jeune) return false;
  }
  if (tarifs.lignes.some((l) => MONTANT.test(l) && vientDeOcr(l))) return false;
  return true;
}

/** Départs jugés fiables si chacun a une date et une heure plausible (6h-20h) et qu'aucune ligne d'horaire ne vient de l'OCR. */
function fiabiliteDeparts(departs, vientDeOcr, text) {
  if (!departs.length) return false;
  for (const d of departs) {
    if (!d.datetime) return false;
    const h = Number(d.heure_debut.slice(0, 2));
    if (h < 6 || h > 20) return false;
  }
  const horaires = lines(text).filter((l) => ROW_LABELS.some(([, re]) => re.test(l)) && HEURE.test(l));
  if (horaires.some(vientDeOcr)) return false;
  return true;
}

// ---------------------------------------------------------------- Départs

const HEURE = /(\d{1,2})\s?(?:h|H|:|heures?)\s?(\d{2})?\b/;
const HEURE_G = new RegExp(HEURE.source, "g");
const ROW_LABELS = [
  ["greffe", /greffe|^\W*l['’]?apr[eè]s[- ]midi\s+\d/i],
  ["echauffement", /échauffement|echauffement|entra[iî]nement/i],
  ["tirs", /(d[ée]but|d[ée]part)\s+(des\s+)?tirs?|^tirs?\b/i],
];

const fmtHeure = (m) => `${m[1].padStart(2, "0")}:${m[2] || "00"}`;
const minutes = (h) => (h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3)) : null);

/**
 * Reconstitue les départs (créneaux de tir) à partir des lignes d'horaires.
 * Formats gérés :
 *  - colonnes : « Ouverture du greffe | 13h00 | 8h30 | 13h30 » (une colonne = un départ),
 *    avec éventuellement une ligne d'en-tête « DEPART 1 - 19/09 | Samedi | Dimanche » juste au-dessus ;
 *  - cellules répétées : « Greffe : 07h30 - 08h30 | Greffe : 12h45 - 13h30 » ;
 *  - lignes : « 1er départ | Accueil greffe | 8H00 » puis « Dimanche matin | … échauffement | 8H30 » ;
 *  - texte : « Ouverture du greffe 7 h 30 et fermeture 8 h 15 » (un départ par ligne).
 * Les dates sont déduites : en-tête (jj/mm, jour de semaine), sinon date de début du concours,
 * en passant au jour suivant quand les horaires repartent en arrière (samedi 13h → dimanche 8h30).
 */
function extractDeparts(text, ref, jaugeGlobale) {
  const ls = lines(text);
  const cols = []; // cols[k] = { greffe, echauffement, tirs, nom, date }
  let firstRow = -1;
  let rowMode = null; // "colonnes" | "lignes"

  const ensure = (k) => (cols[k] ||= { nom: null, date: null, greffe: null, echauffement: null, tirs: null });

  // ---- Format « lignes » : « 1er départ | Accueil greffe | 8H00 »
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/^(\d{1,2})\s*(?:er|ème|eme|e)?\s*d[ée]part\b/i);
    if (!m || !HEURE.test(ls[i])) continue;
    rowMode = "lignes";
    if (firstRow < 0) firstRow = i;
    const k = Number(m[1]) - 1;
    const c = ensure(k);
    c.nom = `Départ ${k + 1}`;
    const setFrom = (line) => {
      const h = line.match(HEURE);
      if (!h) return;
      for (const [key, re] of ROW_LABELS) if (re.test(line) && !c[key]) c[key] = fmtHeure(h);
      const d = parseDateFr(line, ref).date;
      if (d && !c.date) c.date = d;
    };
    setFrom(ls[i]);
    // Les 2 lignes suivantes appartiennent au même départ tant qu'elles ne commencent pas un autre départ
    for (let j = i + 1; j <= i + 2 && j < ls.length; j++) {
      if (/^\d{1,2}\s*(?:er|ème|eme|e)?\s*d[ée]part\b/i.test(ls[j])) break;
      setFrom(ls[j]);
    }
  }

  // ---- Format « colonnes »
  if (!rowMode) {
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      const label = ROW_LABELS.find(([, re]) => re.test(l.split("|")[0]) || (l.includes("|") && re.test(l)));
      if (!label) continue;
      const cells = l.split("|").map((c) => c.trim());
      // Cellules d'horaires : soit toutes les cellules après le libellé, soit chaque cellule contenant libellé + heure
      const first = cells.findIndex((c) => HEURE.test(c));
      if (first < 0) continue;
      const timeCells = cells[0].match(HEURE) && cells.every((c) => label[1].test(c) || !c) ? cells : cells.slice(first);
      const times = timeCells.map((c) => {
        const h = c.match(HEURE);
        return h ? fmtHeure(h) : null;
      });
      if (!times.some(Boolean)) continue;
      // Une seule cellule sans « | » mais plusieurs heures : « Ouverture du greffe 7 h 30 et fermeture 8 h 15 » → on garde la première
      if (firstRow < 0) firstRow = i;
      // Le bloc d'horaires est compact : une occurrence lointaine (bulletin d'inscription, plan...) est ignorée
      if (i - firstRow > 12) continue;
      rowMode = "colonnes";
      const key = label[0];
      // Si cette ligne est une deuxième occurrence du même libellé (autre jour écrit plus bas), on l'ajoute à la suite
      const offset = cols.length && cols.every((c) => c[key]) ? cols.length : 0;
      times.forEach((t, k) => {
        if (t) ensure(offset + k)[key] = t;
      });
    }
  }

  if (!cols.length) return [];

  // ---- En-tête (au-dessus de la première ligne d'horaires) : noms de départs, jours, dates
  // Un mandat peut couvrir un week-end alors que l'épreuve ffta.fr ne fait qu'un jour :
  // on résout les jours de semaine sur une fenêtre élargie, puis on marque les départs hors épreuve.
  const refLarge = ref.debut ? { debut: addDays(ref.debut, -3), fin: addDays(ref.fin || ref.debut, 3) } : ref;
  if (rowMode === "colonnes" && firstRow > 0) {
    for (let i = Math.max(0, firstRow - 4); i < firstRow; i++) {
      const cells = ls[i].split("|").map((c) => c.trim()).filter(Boolean);
      const infoCells = cells.filter(
        (c) => c.length <= 40 && /d[ée]part\s*\d|samedi|dimanche|vendredi|lundi|mardi|mercredi|jeudi|matin|après|apres|\d{1,2}\/\d{1,2}/i.test(c)
      );
      // L'en-tête doit avoir exactement une cellule par colonne d'horaires
      if (infoCells.length !== cols.length) continue;
      infoCells.forEach((c, k) => {
        const col = cols[k];
        col.nom ||= c.replace(/\s*[-–]\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?/, "").trim();
        col.date ||= parseDateFr(c, refLarge).date;
      });
      break;
    }
  }

  // ---- Dates manquantes : jour de début, puis jour suivant quand l'heure repart en arrière
  let date = ref.debut;
  let prev = null;
  for (const c of cols) {
    const h = c.greffe || c.echauffement || c.tirs;
    if (!c.date) {
      if (prev !== null && minutes(h) !== null && minutes(h) < prev && date && (!ref.fin || date < ref.fin)) date = addDays(date, 1);
      c.date = date;
    } else date = c.date;
    prev = minutes(h);
  }

  return cols.map((c, k) => {
    const heure = c.greffe || c.echauffement || c.tirs;
    const hors = !!(ref.debut && c.date && (c.date < ref.debut || c.date > (ref.fin || ref.debut)));
    return {
      nom: c.nom || `Départ ${k + 1}`,
      date: c.date,
      heure_greffe: c.greffe,
      heure_echauffement: c.echauffement,
      heure_debut_tirs: c.tirs,
      heure_debut: heure,
      datetime: c.date && heure ? `${c.date}T${heure}` : null,
      jauge: jaugeGlobale.places,
      cibles: jaugeGlobale.cibles,
      ...(hors && { hors_epreuve: true }),
    };
  });
}

/** Jauge : places, cibles, archers par cible. */
function extractJauge(text) {
  const j = { places: null, cibles: null, archers_par_cible: null, texte: null };
  const t = text.replace(/\s+/g, " ");
  let m;
  if ((m = t.match(/(\d{1,3})\s*(?:places?|archers?)\s*(?:maximum|max\.?)?\s*(?:par|\/)\s*d[ée]part/i))) j.places = Number(m[1]);
  else if ((m = t.match(/limit[ée]e?s?\s*(?:à|:)?\s*(\d{1,3})\s*(?:archers?|places?|tireurs?|comp[ée]titeurs?)/i))) j.places = Number(m[1]);
  else if ((m = t.match(/\d\s*x\s*(\d{1,3})\s*places/i))) j.places = Number(m[1]);
  else if ((m = t.match(/(\d{1,3})\s*places\s*(?:maximum|max\.?|disponibles)/i))) j.places = Number(m[1]);
  if ((m = t.match(/(\d{1,3})\s*cibles/i))) j.cibles = Number(m[1]);
  if ((m = t.match(/(\d)\s*(?:archers?|tireurs?)\s*(?:par|\/)\s*cible/i))) j.archers_par_cible = Number(m[1]);
  if (!j.places && j.cibles && j.archers_par_cible) j.places = j.cibles * j.archers_par_cible;
  const src = t.match(/[^.]*\b(places?|archers? par|cibles)\b[^.]*/i);
  if (src) j.texte = src[0].trim().slice(0, 160);
  return j;
}

/** Détecte le moyen d'inscription : lien (y compris URL courte), mail, courrier. */
function extractInscription(text, infos) {
  const ls = lines(text);
  const result = { mode: null, urls: [], emails: [], texte: [] };

  const urlsInscription = infos.urls.filter((u) => INSCRIPTION_URL.test(u) || SHORT_URL_HOSTS.test(u));
  result.urls.push(...urlsInscription);

  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (!/inscri/i.test(l)) continue;
    // Contexte : la ligne et les deux suivantes (l'adresse mail est souvent à la ligne)
    const ctx = [l, ls[i + 1], ls[i + 2]].filter(Boolean).join(" ");
    const mails = ctx.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
    const urls = ctx.match(/(?:https?:\/\/|www\.)[^\s|)>\]"']+/g) || [];
    if (mails.length || urls.length || /par (mail|courriel|courrier|internet|e-mail)|en ligne|auprès de|aupres de/i.test(l)) {
      result.texte.push(l.trim());
      result.emails.push(...mails.map((e) => e.replace(/[.,;:]+$/, "")));
      result.urls.push(...urls.map((u) => u.replace(/[.,;]+$/, "")));
    }
  }
  result.urls = uniq(result.urls);
  result.emails = uniq(result.emails);
  result.texte = uniq(result.texte);

  const joined = result.texte.join(" ").toLowerCase();
  if (result.urls.length || /en ligne|internet|inscriptarc/.test(joined)) result.mode = "url";
  else if (result.emails.length || /mail|courriel/.test(joined)) result.mode = "mail";
  else if (/courrier|adresser|envoyer à|à l'ordre de/.test(joined)) result.mode = "courrier";
  return result;
}

/**
 * Tarifs : d'abord les tableaux reconstitués (ligne d'en-tête « … | 1 tir | 2 tirs »
 * suivie de lignes « Adultes | 9 € | 16 € »), sinon les lignes contenant un montant.
 */
const HEADER_CELL = /^(tarifs?|engagements?|inscriptions?|)$|tirs?\b|d[ée]parts?|concours|adultes?|jeunes?|s[ée]niors?|\bU\d{2}\b|\bS[123]\b|tarif|montant|prix|unique/i;
const MONTANT = /(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)/i;

function extractTarifs(text) {
  const ls = lines(text);
  const tableaux = [];
  const bruts = [];

  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (!l.includes("|") || MONTANT.test(l)) continue;
    const cells = l.split("|").map((c) => c.trim());
    if (cells.length < 2 || !cells.every((c) => HEADER_CELL.test(c))) continue;
    // En-tête : soit « Tarifs | 1 tir | 2 tirs » (cellule d'angle), soit « Adulte | Jeune » (sans angle)
    const hasCorner = /^(tarifs?|engagements?|inscriptions?|cat[ée]gories?|)$/i.test(cells[0]);
    const colonnes = hasCorner ? cells.slice(1) : cells;
    let found = 0;
    for (let j = i + 1; j < ls.length && j <= i + 10; j++) {
      const row = ls[j].split("|").map((c) => c.trim());
      const valeurs = row.filter((c) => MONTANT.test(c));
      if (row.length < 2 || !valeurs.length) break;
      // Libellé = cellules de tête sans montant ; valeurs alignées sur les colonnes
      const firstVal = row.findIndex((c) => MONTANT.test(c));
      const entry = { categorie: row.slice(0, firstVal).join(" ").trim() || `ligne ${j - i}` };
      row.slice(firstVal).forEach((c, k) => {
        const m = c.match(MONTANT);
        if (m) entry[colonnes[k] || `col${k + 1}`] = Number(m[1].replace(",", "."));
      });
      tableaux.push(entry);
      found++;
    }
    if (found) i += found;
  }

  for (const l of ls) {
    if (MONTANT.test(l) && !/factur|pénalit|penalit/i.test(l)) bruts.push(l.replace(/\s*\|\s*/g, " ").trim());
  }

  // Format en ligne : « 1 départ : Adultes : 12 € - Jeunes 7 € » ou « Adulte : 13 € | Jeune : 9 € »
  let nbCourant = 1;
  for (const l of bruts) {
    const nb = l.match(/(\d)\s*(?:er|ème|e)?\s*(?:tirs?|d[ée]parts?|concours)\b/i);
    if (nb) nbCourant = Number(nb[1]);
    const adulte = l.match(/adultes?[^\d€]{0,12}(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)/i);
    const jeune = l.match(/jeunes?[^\d€]{0,12}(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)/i);
    if (adulte || jeune) {
      const last = tableaux[tableaux.length - 1];
      // « Adulte : 13 € » puis « Jeune : 9 € » sur deux lignes = même tarif
      if (!nb && last?.categorie.endsWith("(déduit)") && ((adulte && !("Adulte" in last)) || (jeune && !("Jeune" in last)))) {
        if (adulte) last.Adulte = Number(adulte[1].replace(",", "."));
        if (jeune) last.Jeune = Number(jeune[1].replace(",", "."));
        continue;
      }
      tableaux.push({
        categorie: nb ? `${nbCourant} départ${nbCourant > 1 ? "s" : ""}` : `${nbCourant} départ (déduit)`,
        ...(adulte && { Adulte: Number(adulte[1].replace(",", ".")) }),
        ...(jeune && { Jeune: Number(jeune[1].replace(",", ".")) }),
      });
      if (!nb) nbCourant++;
    }
  }
  return { tableaux, grille: normaliserGrille(tableaux), lignes: uniq(bruts) };
}

/**
 * Transforme les tableaux (quelle que soit leur orientation) en grille
 * [{ nb_departs, adulte, jeune }] exploitable directement.
 */
function normaliserGrille(tableaux) {
  const nbDeparts = (label) => {
    const m = label.match(/(\d)\s*(?:er|ème|e)?\s*(tirs?|d[ée]parts?|concours)/i);
    return m ? Number(m[1]) : null;
  };
  const audience = (label) => {
    if (/adulte|s[ée]nior|\bU21\b|\bS[123]\b|senior/i.test(label)) return "adulte";
    if (/jeune|\bU1[0-8]\b|cadet|minime|benjamin|poussin/i.test(label)) return "jeune";
    if (/unique|tous|tout public/i.test(label)) return "tous";
    return null;
  };
  const grille = new Map();
  for (const t of tableaux) {
    for (const [col, val] of Object.entries(t)) {
      if (col === "categorie") continue;
      const nb = nbDeparts(t.categorie) ?? nbDeparts(col);
      const aud = audience(t.categorie) ?? audience(col);
      if (nb === null || aud === null) continue;
      const g = grille.get(nb) || { nb_departs: nb, adulte: null, jeune: null };
      if (aud === "tous") {
        g.adulte ??= val;
        g.jeune ??= val;
      } else g[aud] ??= val;
      grille.set(nb, g);
    }
  }
  return [...grille.values()].sort((a, b) => a.nb_departs - b.nb_departs);
}
