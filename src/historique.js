// Archivage des exports (un snapshot daté par run) et comparaison entre deux snapshots.
import fs from "node:fs/promises";
import path from "node:path";
import { departsEpreuve, tarifsJson } from "./output.js";

/** Copie competitions.json dans output/historique/AAAA-MM-JJ.json (écrase le snapshot du même jour). */
export async function archiver(outDir, date = new Date()) {
  const dir = path.join(outDir, "historique");
  await fs.mkdir(dir, { recursive: true });
  const nom = date.toISOString().slice(0, 10) + ".json";
  await fs.copyFile(path.join(outDir, "competitions.json"), path.join(dir, nom));
  return path.join(dir, nom);
}

/** Liste des snapshots disponibles, du plus ancien au plus récent : [{ date, fichier }]. */
export async function listerSnapshots(outDir) {
  const dir = path.join(outDir, "historique");
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => ({ date: f.slice(0, 10), fichier: path.join(dir, f) }));
}

export async function chargerSnapshot(fichier) {
  const data = JSON.parse(await fs.readFile(fichier, "utf8"));
  return data.competitions || [];
}

// ---------------------------------------------------------------- Comparaison

/** Champs de la fiche comparés, avec leur libellé pour le rapport. */
const CHAMPS_FICHE = {
  titre: ["Titre", (c) => c.titre],
  dates: ["Dates", (c) => c.dates_texte],
  statut: ["Statut", (c) => c.detail?.statut || c.statut],
  discipline: ["Discipline", (c) => c.detail?.champs?.discipline || c.discipline],
  championnat: ["Championnat", (c) => c.detail?.champs?.championnat],
  type: ["Type", (c) => c.type],
  duels: ["Duels", (c) => c.detail?.champs?.duels],
  organisateur: ["Organisateur", (c) => c.organisateur],
  lieu: ["Lieu", (c) => c.detail?.champs?.lieu || c.ville],
  adresse: ["Adresse", (c) => (c.detail?.adresse || []).join(", ")],
  email: ["Email", (c) => c.email || c.detail?.contacts?.mail],
  telephone: ["Téléphone", (c) => c.detail?.contacts?.tel],
  site: ["Site web", (c) => c.site || c.detail?.contacts?.site],
  mandat_url: ["Lien du mandat", (c) => c.mandat_url],
};

/** Éléments du mandat comparés (résumés en texte pour une comparaison simple). */
const CHAMPS_MANDAT = {
  mandat_modifie_le: ["PDF modifié le", (c) => c.mandat?.modifie_le?.slice(0, 10)],
  departs: ["Départs", (c) => departsEpreuve(c).map((d) => `${d.nom} ${d.datetime || ""}`.trim()).join(" | ")],
  tarifs: ["Tarifs", (c) => tarifsJson(c).map((t) => `${t.departs}d ${t.public} ${(t.montant_cents / 100).toFixed(2)} €`).join(" | ")],
  jauge: ["Jauge", (c) => c.mandat?.infos?.jauge?.places],
  date_limite: ["Date limite d'inscription", (c) => c.mandat?.infos?.date_limite_iso],
  inscription: ["Inscription", (c) => {
    const i = c.mandat?.infos?.inscription;
    return i ? [i.mode, ...(i.urls || []), ...(i.emails || [])].filter(Boolean).join(" ") : undefined;
  }],
};

const norm = (v) => (v === undefined || v === null || v === "" ? null : String(v));

function comparerChamps(defs, avant, apres) {
  const out = [];
  for (const [cle, [libelle, get]] of Object.entries(defs)) {
    const a = norm(get(avant));
    const b = norm(get(apres));
    if (a !== b) out.push({ champ: cle, libelle, avant: a, apres: b });
  }
  return out;
}

/**
 * Compare deux listes de compétitions.
 * Renvoie { apparus, disparus, modifies, mandats_publies, mandats_modifies, resume }.
 */
export function comparer(avant, apres) {
  const A = new Map(avant.map((c) => [String(c.id), c]));
  const B = new Map(apres.map((c) => [String(c.id), c]));
  const resume = (c) => ({
    id: String(c.id),
    titre: c.titre,
    dates: c.dates_texte,
    date_debut: c.date_debut,
    discipline: c.detail?.champs?.discipline || c.discipline,
    organisateur: c.organisateur,
    departement: c.departement?.code,
    url: c.url,
    mandat_url: c.mandat_url,
  });

  const apparus = [...B.values()].filter((c) => !A.has(String(c.id))).map(resume);
  const disparus = [...A.values()].filter((c) => !B.has(String(c.id))).map(resume);

  const modifies = [];
  const mandats_publies = [];
  const mandats_modifies = [];
  for (const [id, b] of B) {
    const a = A.get(id);
    if (!a) continue;
    const fiche = comparerChamps(CHAMPS_FICHE, a, b);
    if (!a.mandat && b.mandat) {
      mandats_publies.push({ ...resume(b), mandat: extraitMandat(b) });
    } else if (a.mandat && b.mandat) {
      const m = comparerChamps(CHAMPS_MANDAT, a, b);
      if (m.length) mandats_modifies.push({ ...resume(b), changements: m });
    }
    // Le lien du mandat est déjà couvert par "mandats publiés"
    const ficheSansMandat = fiche.filter((ch) => !(ch.champ === "mandat_url" && !a.mandat && b.mandat));
    if (ficheSansMandat.length) modifies.push({ ...resume(b), changements: ficheSansMandat });
  }

  const tri = (l) => l.sort((x, y) => (x.date_debut || "").localeCompare(y.date_debut || ""));
  return {
    apparus: tri(apparus),
    disparus: tri(disparus),
    modifies: tri(modifies),
    mandats_publies: tri(mandats_publies),
    mandats_modifies: tri(mandats_modifies),
    resume: {
      avant: avant.length,
      apres: apres.length,
      apparus: apparus.length,
      disparus: disparus.length,
      modifies: modifies.length,
      mandats_publies: mandats_publies.length,
      mandats_modifies: mandats_modifies.length,
    },
  };
}

function extraitMandat(c) {
  const i = c.mandat?.infos || {};
  return {
    departs: departsEpreuve(c).map((d) => ({ nom: d.nom, debut: d.datetime, places: d.jauge })),
    tarifs: tarifsJson(c),
    date_limite: i.date_limite_iso || null,
    inscription: i.inscription?.mode || null,
    fiable: { tarifs: !!i.tarifs?.fiable, departs: !!i.departs_fiable },
  };
}
