/**
 * @file Archivage des relevés et comparaison entre deux relevés successifs.
 *
 * ## À quoi cela sert
 *
 * Un calendrier de compétitions bouge tout le temps : des concours s'ajoutent, d'autres sont
 * annulés, des clubs publient leur mandat, corrigent un tarif ou repoussent une date limite.
 * Recevoir chaque semaine la liste complète n'apprend rien ; savoir **ce qui a changé** est
 * exactement ce dont un responsable de club a besoin.
 *
 * Chaque exécution archive donc une copie datée du relevé, et ce module sait comparer deux de ces
 * copies. `rapport.js` en fait ensuite une page consultable.
 *
 * ## Cinq catégories de changement
 *
 * | Catégorie          | Ce qu'elle recouvre                                        |
 * | ------------------ | ---------------------------------------------------------- |
 * | `apparus`          | concours ajoutés au calendrier                             |
 * | `disparus`         | concours retirés, souvent annulés                          |
 * | `modifies`         | fiche changée : lieu, dates, contacts…                     |
 * | `mandats_publies`  | le club a mis son invitation en ligne, l'inscription ouvre |
 * | `mandats_modifies` | tarifs, horaires ou date limite revus                      |
 *
 * La quatrième est celle qu'on attend le plus : c'est le moment où un concours devient réellement
 * ouvert aux inscriptions.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { departsEpreuve, tarifsJson } from "./output.js";

/**
 * Archive le relevé courant sous une copie datée.
 *
 * Le nom du fichier est la date du jour, si bien que **deux relevés le même jour ne produisent
 * qu'une archive**, la seconde écrasant la première. C'est voulu : l'unité de comparaison est la
 * journée, et relancer une collecte après un incident ne doit pas polluer l'historique d'un
 * faux changement.
 *
 * Le paramètre `date` est injecté pour que les tests puissent simuler plusieurs jours.
 *
 * @param {string} outDir dossier de sortie
 * @param {Date} [date] date de l'archive, aujourd'hui par défaut
 * @returns {Promise<string>} chemin de l'archive écrite
 */
export async function archiver(outDir, date = new Date()) {
  const dir = path.join(outDir, "historique");
  await fs.mkdir(dir, { recursive: true });
  const nom = date.toISOString().slice(0, 10) + ".json";
  await fs.copyFile(path.join(outDir, "competitions.json"), path.join(dir, nom));
  return path.join(dir, nom);
}

/**
 * Liste les relevés archivés, du plus ancien au plus récent.
 *
 * Le filtre sur le nom de fichier est important : le dossier peut contenir des notes ou des
 * fichiers déposés à la main, qui feraient échouer la lecture. Le format `AAAA-MM-JJ` a en outre
 * la propriété de se trier chronologiquement par simple ordre alphabétique.
 *
 * Un dossier absent renvoie une liste vide plutôt qu'une erreur : c'est le cas normal du premier
 * relevé.
 *
 * @param {string} outDir dossier de sortie
 * @returns {Promise<{date: string, fichier: string}[]>}
 */
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
/**
 * Champs de la fiche suivis d'un relevé à l'autre.
 *
 * Chaque entrée associe une clé technique à un libellé affichable et à une fonction d'extraction.
 * Le libellé est ce que verra l'utilisateur dans le rapport, d'où sa rédaction en français courant.
 *
 * Seuls figurent ici les champs dont un changement intéresse quelqu'un qui suit le calendrier.
 * Ajouter un champ à cette table suffit à le faire apparaître dans les comparaisons.
 *
 * @type {Object<string, [string, (c: import("./types.js").Competition) => unknown]>}
 */
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

/**
 * Éléments du mandat suivis d'un relevé à l'autre.
 *
 * Chaque valeur est **réduite à une chaîne de caractères** avant comparaison. Comparer directement
 * des tableaux d'objets obligerait à une comparaison en profondeur, sensible à l'ordre des clés et
 * pénible à afficher. Une chaîne se compare d'un signe égal et se montre telle quelle à
 * l'utilisateur, ce qui suffit largement pour signaler « les tarifs ont changé ».
 *
 * @type {Object<string, [string, (c: import("./types.js").Competition) => unknown]>}
 */
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

/**
 * Ramène les trois façons d'exprimer l'absence à une seule.
 *
 * Sans cela, une valeur passée de la chaîne vide à `null` serait signalée comme un changement,
 * alors que rien n'a bougé du point de vue de l'utilisateur. Ce genre de faux positif décrédibilise
 * vite un rapport de changements.
 *
 * @param {unknown} v
 * @returns {string|null}
 */
const norm = (v) => (v === undefined || v === null || v === "" ? null : String(v));

/**
 * Compare deux versions d'une même compétition sur un ensemble de champs.
 *
 * @param {Object<string, [string, (c: any) => unknown]>} defs table de champs à comparer
 * @param {import("./types.js").Competition} avant version du relevé précédent
 * @param {import("./types.js").Competition} apres version du relevé courant
 * @returns {{champ: string, libelle: string, avant: string|null, apres: string|null}[]}
 *          uniquement les champs qui diffèrent
 */
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
 * Compare deux relevés et classe les changements en cinq catégories.
 *
 * Les épreuves sont appariées par leur identifiant ffta.fr, stable dans le temps. Celles présentes
 * d'un seul côté sont apparues ou ont disparu ; celles présentes des deux côtés sont examinées
 * champ par champ.
 *
 * Tous les résultats sont triés par date de concours, l'ordre dans lequel un lecteur les parcourt
 * naturellement.
 *
 * @param {import("./types.js").Competition[]} avant relevé le plus ancien
 * @param {import("./types.js").Competition[]} apres relevé le plus récent
 * @returns {{apparus: object[], disparus: object[], modifies: object[],
 *            mandats_publies: object[], mandats_modifies: object[], resume: object}}
 */
export function comparer(avant, apres) {
  const A = new Map(avant.map((c) => [String(c.id), c]));
  const B = new Map(apres.map((c) => [String(c.id), c]));

  /**
   * Réduit une compétition à ce qu'il faut pour l'identifier dans un rapport.
   * Le rapport embarque ses données dans la page : inutile d'y recopier les mandats entiers.
   * @param {import("./types.js").Competition} c
   */
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
    if (!a) continue; // épreuve nouvelle, déjà classée dans `apparus`

    const fiche = comparerChamps(CHAMPS_FICHE, a, b);

    if (!a.mandat && b.mandat) {
      // Le mandat vient d'être publié : on montre son contenu, c'est l'information attendue
      mandats_publies.push({ ...resume(b), mandat: extraitMandat(b) });
    } else if (a.mandat && b.mandat) {
      // Mandat déjà connu : on ne signale que ce qui a bougé dedans
      const m = comparerChamps(CHAMPS_MANDAT, a, b);
      if (m.length) mandats_modifies.push({ ...resume(b), changements: m });
    }

    // La publication d'un mandat ajoute forcément son lien à la fiche. Le signaler une seconde
    // fois dans « fiches modifiées » ferait doublon avec « mandats publiés », plus parlant.
    const ficheSansMandat = fiche.filter((ch) => !(ch.champ === "mandat_url" && !a.mandat && b.mandat));
    if (ficheSansMandat.length) modifies.push({ ...resume(b), changements: ficheSansMandat });
  }

  /** Trie par date de concours, l'ordre de lecture naturel. */
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

/**
 * Résume un mandat fraîchement publié, pour l'afficher dans le rapport.
 *
 * On retient ce qui décide un club à inscrire ses archers : quand tirer, combien ça coûte, jusqu'à
 * quand s'inscrire et comment. Les indicateurs de fiabilité accompagnent ces valeurs, afin que le
 * rapport puisse signaler celles qui méritent une vérification dans le PDF.
 *
 * @param {import("./types.js").Competition} c
 * @returns {object} résumé destiné à l'affichage
 */
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
