/**
 * @file Enrichissement des compétitions et écriture des fichiers de sortie.
 *
 * Dernière étape de la chaîne, entre les données brutes du site et les fichiers livrés. Trois
 * responsabilités distinctes :
 *
 * 1. **Enrichir** : département déduit de l'adresse, discipline décomposée, date de fin garantie,
 *    empreinte permettant de repérer les fiches modifiées d'un relevé à l'autre.
 * 2. **Regrouper** les épreuves qui décrivent un même concours physique, voir `regrouperConcours`.
 * 3. **Écrire** le JSON complet et le CSV, ce dernier taillé pour Excel en français.
 *
 * ## Deux formats, deux usages
 *
 * Le **JSON** conserve tout, y compris le texte intégral des mandats : c'est la source à laquelle
 * revenir, et celle que `reparse` relit pour ré-analyser sans retourner sur le site.
 *
 * Le **CSV** est un extrait à plat, une ligne par épreuve, destiné à un tableur ou à un import
 * automatique. Il expose les mêmes informations sous deux formes : lisible pour l'humain
 * (`mandat_tarifs`) et structurée pour la machine (`mandat_tarifs_json`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { departementDe, disciplineDe } from "./config.js";

/**
 * Relit l'export précédent du même dossier, pour comparer et repérer ce qui a changé.
 *
 * L'absence de fichier n'est pas une erreur : c'est le cas normal du tout premier relevé. Un
 * fichier illisible n'en est pas une non plus, un export interrompu pouvant laisser du JSON
 * tronqué. Dans les deux cas on repart d'une carte vide, et toutes les épreuves seront considérées
 * comme nouvelles.
 *
 * @param {string} outDir dossier de sortie
 * @returns {Promise<Map<string, import("./types.js").Competition>>} épreuves indexées par identifiant
 */
export async function chargerPrecedent(outDir) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(outDir, "competitions.json"), "utf8"));
    return new Map((data.competitions || []).map((c) => [String(c.id), c]));
  } catch {
    return new Map();
  }
}

/**
 * Enrichit chaque compétition et date ses modifications.
 *
 * ## Le suivi des modifications, et pourquoi il fonctionne ainsi
 *
 * La FFTA n'expose **aucune date de modification** sur ses fiches. Impossible donc de savoir
 * directement qu'un club a changé son lieu ou repoussé son concours.
 *
 * La parade consiste à calculer une empreinte du contenu de la fiche et à la comparer à celle du
 * relevé précédent. Si elle diffère, quelque chose a changé, et on date le changement d'aujourd'hui.
 * Si elle est identique, on reprend la date du relevé précédent, ce qui fait remonter dans le temps
 * la véritable date de dernière modification, tant que la fiche reste stable.
 *
 * Deux dates en résultent :
 * - `epreuve_vue_le` : première apparition de l'épreuve dans un relevé, jamais modifiée ensuite ;
 * - `epreuve_maj_le` : dernier relevé où la fiche a changé.
 *
 * Une application peut ainsi ne retraiter que ce qui a bougé.
 *
 * ## Le paramètre `maintenant`
 *
 * Injecté plutôt que lu depuis l'horloge, afin que les tests puissent simuler deux relevés à des
 * dates choisies et vérifier le comportement du suivi.
 *
 * @param {import("./types.js").Competition[]} competitions modifiées en place
 * @param {Map<string, import("./types.js").Competition>} [precedent] relevé précédent
 * @param {string} [maintenant] date ISO du relevé courant
 * @returns {import("./types.js").Competition[]} le même tableau, pour permettre le chaînage
 */
export function completerCompetitions(competitions, precedent = new Map(), maintenant = new Date().toISOString()) {
  for (const c of competitions) {
    completerDepartement(c);
    c.discipline_info = disciplineDe(c.discipline);

    // Un concours d'un jour n'a pas de date de fin sur le site : on la rend explicite, pour que
    // les applications puissent toujours raisonner sur un intervalle, même réduit à un jour.
    if (c.date_debut && !c.date_fin) c.date_fin = c.date_debut;

    c.epreuve_hash = empreinte(c);
    const prev = precedent.get(String(c.id));

    c.epreuve_vue_le = prev?.epreuve_vue_le || maintenant;
    // Empreinte inchangée : on hérite de la date de modification précédente. Les replis successifs
    // couvrent les relevés produits par une version antérieure, qui ne portaient pas ces champs.
    c.epreuve_maj_le =
      prev && prev.epreuve_hash === c.epreuve_hash
        ? prev.epreuve_maj_le || prev.epreuve_vue_le || maintenant
        : maintenant;
  }
  return competitions;
}

/**
 * Réunit les épreuves du calendrier qui décrivent en réalité un même concours.
 *
 * ## Le problème
 *
 * La FFTA publie une épreuve par championnat et par jour. Un même concours physique peut donc
 * apparaître deux, trois ou quatre fois :
 *
 * - **Découpage par championnat** : le tir à 18 m et le para-tir à 18 m d'un même après-midi, au
 *   même endroit, forment deux épreuves. C'est le cas le plus fréquent.
 * - **Découpage par jour** : un week-end de tir en campagne devient une épreuve « samedi » et une
 *   épreuve « dimanche », partageant le même mandat.
 *
 * Une application qui afficherait ces épreuves telles quelles montrerait des doublons, et
 * importerait deux fois les mêmes départs.
 *
 * ## Les deux critères de rapprochement
 *
 * 1. **Même organisateur, même lieu, mêmes dates.** Couvre le découpage par championnat.
 * 2. **Même mandat**, reconnu à l'empreinte de son contenu et non à son adresse, la FFTA publiant
 *    le même PDF sous deux noms de fichier. Couvre le découpage par jour.
 *
 * ## Pourquoi une structure union-find
 *
 * Les deux critères peuvent se chaîner : A rejoint B par le lieu, B rejoint C par le mandat, donc
 * A, B et C forment un seul concours, alors qu'aucun critère ne lie directement A à C. Comparer
 * les épreuves deux à deux manquerait ce transitif.
 *
 * L'union-find résout cela élégamment. Chaque épreuve et chaque critère devient un nœud ; relier
 * une épreuve à ses critères propage les fusions automatiquement. La compression de chemin dans
 * `find` garde l'ensemble rapide même sur plusieurs centaines d'épreuves.
 *
 * **À appeler après l'analyse des mandats**, puisque le second critère a besoin de leurs empreintes.
 *
 * @param {import("./types.js").Competition[]} competitions modifiées en place, champ `concours` ajouté
 * @returns {import("./types.js").Competition[]} le même tableau
 */
export function regrouperConcours(competitions) {
  /**
   * Structure union-find : chaque clé pointe vers son représentant.
   * Les clés sont soit des identifiants d'épreuves, soit des critères de rapprochement.
   * @type {Map<string, string>}
   */
  const parent = new Map();

  /**
   * Représentant du groupe auquel appartient une clé, avec compression de chemin :
   * chaque nœud traversé est raccroché à son grand-parent, ce qui aplatit l'arbre au fil des appels.
   * @param {string} k
   * @returns {string}
   */
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };

  /** Fusionne les groupes de deux clés. */
  const union = (a, b) => parent.set(find(a), find(b));

  /** Normalise un libellé pour la comparaison : majuscules, espaces réduits. */
  const norm = (s) => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();

  // Chaque épreuve est reliée à ses critères. Deux épreuves partageant un critère se retrouvent
  // ainsi dans le même groupe, sans jamais être comparées directement l'une à l'autre.
  for (const c of competitions) {
    const id = String(c.id);
    parent.set(id, id);

    const cles = [`fiche:${norm(c.organisateur)}|${norm(c.detail?.champs?.lieu || c.ville)}|${norm(c.dates_texte)}`];
    if (c.mandat?.hash) cles.push(`pdf:${c.mandat.hash}`);

    for (const k of cles) {
      if (!parent.has(k)) parent.set(k, k);
      union(id, k);
    }
  }

  // Rassemblement des épreuves par représentant
  /** @type {Map<string, import("./types.js").Competition[]>} */
  const groupes = new Map();
  for (const c of competitions) {
    const r = find(String(c.id));
    (groupes.get(r) || groupes.set(r, []).get(r)).push(c);
  }

  for (const l of groupes.values()) {
    // Tri par identifiant : le plus petit sert d'identifiant de concours, ce qui le rend stable
    // d'un relevé à l'autre tant que la même épreuve reste au calendrier.
    l.sort((a, b) => Number(a.id) - Number(b.id));

    // Départs du concours entier : on réunit ceux de tous les mandats du groupe, y compris ceux
    // marqués hors épreuve, puisqu'à l'échelle du concours ils ont bien lieu.
    /** @type {Map<string, import("./types.js").DepartDeConcours>} */
    const departs = new Map();
    for (const c of l) {
      for (const d of c.mandat?.infos?.departs || []) {
        // Clé de dédoublonnage : deux épreuves partageant un mandat décrivent les mêmes départs,
        // qui ne doivent apparaître qu'une fois. La date et l'heure les identifient ; à défaut,
        // le nom sert de repli.
        const k = `${d.datetime || d.nom}`;
        const entry = departs.get(k) || {
          nom: d.nom,
          debut: d.datetime,
          greffe: d.heure_greffe,
          echauffement: d.heure_echauffement,
          tirs: d.heure_debut_tirs,
          places: d.jauge ?? null,
          epreuves: [],
        };

        // À quelles épreuves ce départ appartient-il ? Celles dont la période le contient.
        // Un départ du samedi est ainsi rattaché à l'épreuve du samedi, et un départ commun au
        // 18 m et au para 18 m se voit rattaché aux deux.
        for (const e of l) {
          if (
            d.date &&
            e.date_debut &&
            d.date >= e.date_debut &&
            d.date <= (e.date_fin || e.date_debut) &&
            !entry.epreuves.includes(String(e.id))
          ) {
            entry.epreuves.push(String(e.id));
          }
        }
        departs.set(k, entry);
      }
    }

    const listeDeparts = [...departs.values()].sort((a, b) => (a.debut || "").localeCompare(b.debut || ""));
    const epreuves = l.map((c) => ({
      id: String(c.id),
      titre: c.titre,
      dates_texte: c.dates_texte,
      date_debut: c.date_debut,
      date_fin: c.date_fin,
      discipline: c.discipline,
      para: c.discipline_info?.para ?? null,
      mandat: !!c.mandat_url,
    }));
    for (const c of l) {
      c.concours = { id: String(l[0].id), nb_epreuves: l.length, epreuves, departs: listeDeparts };
    }
  }
  return competitions;
}

/**
 * Empreinte du contenu de la fiche fédérale, base du suivi des modifications.
 *
 * **Le choix des champs est ce qui compte ici.** On ne retient que ce que la FFTA publie, à
 * l'exclusion de tout ce que le programme calcule lui-même : département déduit, discipline
 * décomposée, regroupement, dates de suivi, mandat analysé.
 *
 * La raison est simple : une amélioration des heuristiques d'analyse changerait les données
 * dérivées, et toutes les fiches apparaîtraient modifiées alors que le site n'a pas bougé. Les
 * utilisateurs verraient deux cents fausses alertes. En n'empreignant que la source, on garantit
 * qu'un changement signalé est un vrai changement du calendrier.
 *
 * Seize caractères hexadécimaux suffisent : il ne s'agit pas de sécurité, seulement de détecter
 * une différence, et une empreinte courte reste lisible dans le CSV.
 *
 * @param {import("./types.js").Competition} c
 * @returns {string} empreinte sur seize caractères
 */
function empreinte(c) {
  const d = c.detail || {};
  const base = {
    titre: c.titre, dates: c.dates_texte, statut: d.statut || c.statut, discipline: c.discipline, type: c.type,
    organisateur: c.organisateur, ville: c.ville, email: c.email, site: c.site, mandat_url: c.mandat_url,
    champs: d.champs, adresse: d.adresse, contacts: d.contacts, documents: d.documents,
  };
  return crypto.createHash("sha1").update(JSON.stringify(base)).digest("hex").slice(0, 16);
}

/**
 * Écrit les deux fichiers de sortie.
 *
 * Le CSV est précédé d'une **marque d'ordre des octets** (le caractère `﻿`). Sans elle, Excel
 * en français interprète le fichier dans son encodage local et affiche « CompÃ©tition » au lieu de
 * « Compétition ». Ce caractère invisible est la seule façon de lui faire comprendre qu'il s'agit
 * d'UTF-8 sans passer par l'assistant d'importation.
 *
 * @param {string} outDir dossier de sortie, supposé exister
 * @param {object} meta métadonnées écrites en tête du JSON : filtres utilisés, paramètres
 * @param {import("./types.js").Competition[]} competitions
 * @returns {Promise<{jsonFile: string, csvFile: string}>} chemins réellement écrits, qui peuvent
 *   différer des chemins demandés si un fichier était verrouillé
 */
export async function writeOutputs(outDir, meta, competitions) {
  const jsonFile = await writeSafe(
    path.join(outDir, "competitions.json"),
    JSON.stringify({ ...meta, genere_le: new Date().toISOString(), nb: competitions.length, competitions }, null, 2)
  );
  const csvFile = await writeSafe(path.join(outDir, "competitions.csv"), "﻿" + toCsv(competitions));
  return { jsonFile, csvFile };
}

/**
 * Écrit un fichier, en contournant le verrou d'Excel plutôt qu'en échouant.
 *
 * ## Le cas d'usage réel
 *
 * L'utilisateur ouvre le CSV dans Excel pour consulter les concours, puis relance un relevé sans
 * fermer le tableur. Windows refuse alors l'écriture avec `EBUSY` ou `EPERM`. Perdre trois minutes
 * de collecte pour cette raison serait absurde : on écrit donc à côté, sous un nom horodaté, et on
 * prévient clairement.
 *
 * Toute autre erreur est propagée : un disque plein ou un dossier inexistant sont de vrais
 * problèmes, qu'il ne faut pas masquer.
 *
 * @param {string} file chemin souhaité
 * @param {string} content contenu à écrire
 * @returns {Promise<string>} le chemin réellement écrit
 */
async function writeSafe(file, content) {
  try {
    await fs.writeFile(file, content);
    return file;
  } catch (e) {
    if (e.code !== "EBUSY" && e.code !== "EPERM") throw e;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const alt = file.replace(/(\.\w+)$/, `.${stamp}$1`);
    await fs.writeFile(alt, content);
    console.error(`  ! ${path.basename(file)} est verrouillé (ouvert dans une autre application ?) : écrit dans ${path.basename(alt)}`);
    return alt;
  }
}

// ---------------------------------------------------------------- Colonnes du CSV
//
// Chaque information du mandat apparaît sous deux formes complémentaires :
//   - une colonne lisible, destinée à quelqu'un qui ouvre le fichier dans un tableur ;
//   - une colonne JSON, destinée à un import automatique.
// L'utilisateur choisit celle qui lui convient sans que l'autre le gêne.

/**
 * Joint les éléments d'un tableau, en rendant une cellule vide plutôt que « undefined ».
 * @param {unknown[]|undefined} arr
 * @param {string} [sep]
 * @returns {string}
 */
const join = (arr, sep = " | ") => (Array.isArray(arr) && arr.length ? arr.join(sep) : "");

/**
 * Tarifs sous forme lisible, avec repli progressif selon ce qui a pu être compris.
 *
 * Trois niveaux, du meilleur au moins bon :
 * 1. la grille normalisée, « 1 départ : adulte 9 € / jeune 7 € » ;
 * 2. les tableaux bruts, quand la normalisation n'a pas su déterminer public ou nombre de départs ;
 * 3. les lignes du PDF contenant un montant, en dernier recours.
 *
 * Ce dégradé garantit qu'une information lue reste visible, même mal structurée. Le point
 * d'interrogation signale un tarif absent de la grille plutôt que de laisser croire à la gratuité.
 *
 * @param {import("./types.js").Competition} c
 * @returns {string}
 */
function tarifsResume(c) {
  const grille = c.mandat?.infos?.tarifs?.grille;
  if (grille?.length) {
    return grille.map((t) => `${t.nb_departs} départ${t.nb_departs > 1 ? "s" : ""} : adulte ${t.adulte ?? "?"} € / jeune ${t.jeune ?? "?"} €`).join(" | ");
  }
  const tab = c.mandat?.infos?.tarifs?.tableaux;
  if (tab?.length) {
    return tab
      .map((t) =>
        Object.entries(t)
          .filter(([k]) => k !== "categorie")
          .map(([k, v]) => `${t.categorie} ${k} : ${v} €`)
          .join(" | ")
      )
      .join(" | ");
  }
  return join(c.mandat?.infos?.tarifs?.lignes);
}

/**
 * Départs à afficher pour cette épreuve précise.
 *
 * Un mandat de week-end décrit les départs des deux jours, alors que l'épreuve courante ne couvre
 * qu'un jour : on écarte ceux marqués hors épreuve.
 *
 * Le repli en fin de fonction compte : si **aucun** départ ne tombe dans les dates de l'épreuve,
 * c'est probablement que la déduction des dates a échoué. Afficher tous les départs vaut alors
 * mieux que n'en afficher aucun, quitte à ce que l'utilisateur trie lui-même.
 *
 * @param {import("./types.js").Competition} c
 * @returns {import("./types.js").Depart[]}
 */
export function departsEpreuve(c) {
  const all = c.mandat?.infos?.departs || [];
  const dedans = all.filter((d) => !d.hors_epreuve);
  return dedans.length ? dedans : all;
}

/**
 * Tarifs sous forme structurée, un objet par couple nombre de départs et public.
 *
 * **Les montants sont en centimes**, entiers, jamais en euros décimaux. Un prix de 12,50 € stocké
 * en nombre à virgule flottante peut se comparer et s'additionner de travers ; en centimes, 1250
 * est exact et le restera. C'est la convention usuelle pour manipuler de l'argent en informatique.
 *
 * Un tarif absent ne produit aucune entrée, plutôt qu'une entrée à zéro qui laisserait croire à
 * la gratuité.
 *
 * @param {import("./types.js").Competition} c
 * @returns {{departs: number, public: string, montant_cents: number}[]}
 */
export function tarifsJson(c) {
  const grille = c.mandat?.infos?.tarifs?.grille || [];
  const out = [];
  for (const t of grille) {
    if (t.adulte !== null) out.push({ departs: t.nb_departs, public: "adulte", montant_cents: Math.round(t.adulte * 100) });
    if (t.jeune !== null) out.push({ departs: t.nb_departs, public: "jeune", montant_cents: Math.round(t.jeune * 100) });
  }
  return out;
}

/**
 * Départs sous forme structurée, prêts à alimenter un formulaire ou un calendrier.
 *
 * @param {import("./types.js").Competition} c
 * @returns {{nom: string, debut: string|null, greffe: string|null, echauffement: string|null,
 *            tirs: string|null, places: number|null, cibles: number|null}[]}
 */
export function departsJson(c) {
  return departsEpreuve(c).map((d) => ({
    nom: d.nom,
    debut: d.datetime,
    greffe: d.heure_greffe,
    echauffement: d.heure_echauffement,
    tirs: d.heure_debut_tirs,
    places: d.jauge ?? null,
    cibles: d.cibles ?? null,
  }));
}

/**
 * Rend un booléen en français, en distinguant l'inconnu du faux.
 *
 * Distinction importante dans ce projet : « non » signifie que l'information a été lue et vaut
 * faux, la cellule vide qu'elle n'a pas pu être déterminée. Confondre les deux ferait croire à
 * l'absence de buvette là où le mandat n'a simplement pas pu être analysé.
 *
 * @param {boolean|null|undefined} v
 * @returns {string} « oui », « non », ou une chaîne vide
 */
const ouiNon = (v) => (v === true ? "oui" : v === false ? "non" : "");

/**
 * Départs sous forme lisible, avec repli sur les lignes d'horaires brutes.
 * @param {import("./types.js").Competition} c
 * @returns {string}
 */
function departsResume(c) {
  const departs = departsEpreuve(c);
  if (departs?.length) {
    return departs
      .map((d) => `${d.nom}${d.date ? " " + d.date : ""}${d.heure_debut ? " " + d.heure_debut : ""}${d.jauge ? " (" + d.jauge + " pl.)" : ""}`)
      .join(" | ");
  }
  return join(c.mandat?.infos?.horaires);
}

/**
 * Compose le CSV, une ligne par épreuve.
 *
 * ## La table `cols`
 *
 * Chaque entrée associe un **nom de colonne** à une **fonction d'extraction**. Ce choix a trois
 * avantages : l'ordre des colonnes se lit d'un coup d'œil, en-têtes et valeurs ne peuvent pas se
 * désynchroniser, et une colonne s'ajoute en insérant une ligne à l'endroit voulu.
 *
 * Les fonctions utilisent l'accès optionnel `?.` de bout en bout, si bien qu'une épreuve sans fiche
 * détaillée ou sans mandat produit des cellules vides au lieu d'interrompre le programme.
 *
 * ## Le format retenu
 *
 * Point-virgule comme séparateur et fins de ligne Windows : c'est ce qu'attend Excel en français,
 * où la virgule est le séparateur décimal. Combiné à la marque d'ordre des octets ajoutée par
 * `writeOutputs`, le fichier s'ouvre correctement d'un simple double-clic.
 *
 * @param {import("./types.js").Competition[]} rows
 * @returns {string} le contenu du CSV, sans la marque d'ordre des octets
 */
export function toCsv(rows) {
  /**
   * Colonnes du fichier : nom, puis fonction qui en extrait la valeur d'une compétition.
   * @type {[string, (c: import("./types.js").Competition) => unknown][]}
   */
  const cols = [
    ["id", (c) => c.id],
    ["titre", (c) => c.titre],
    ["date_debut", (c) => c.date_debut],
    ["date_fin", (c) => c.date_fin],
    ["dates_texte", (c) => c.dates_texte],
    ["statut", (c) => c.detail?.statut || c.statut],
    ["discipline", (c) => c.detail?.champs?.discipline || c.discipline],
    ["discipline_code", (c) => c.discipline_info?.code],
    ["discipline_id", (c) => c.discipline_info?.id],
    ["discipline_base", (c) => c.discipline_info?.base],
    ["para", (c) => ouiNon(c.discipline_info?.para)],
    ["championnat", (c) => c.detail?.champs?.championnat],
    ["type", (c) => c.type],
    ["duels", (c) => c.detail?.champs?.duels],
    ["organisateur", (c) => c.organisateur],
    ["departement", (c) => c.departement?.code],
    ["departement_nom", (c) => c.departement?.nom],
    ["ville", (c) => c.ville],
    ["lieu", (c) => c.detail?.champs?.lieu],
    ["adresse", (c) => c.detail?.adresse?.join(", ")],
    ["comite_regional", (c) => c.detail?.champs?.comite_regional],
    ["comite_departemental", (c) => c.detail?.champs?.comite_departemental],
    ["email", (c) => c.email || c.detail?.contacts?.mail],
    ["telephone", (c) => c.detail?.contacts?.tel],
    ["site", (c) => c.site || c.detail?.contacts?.site],
    ["url", (c) => c.url],
    ["concours_id", (c) => c.concours?.id],
    ["concours_nb_epreuves", (c) => c.concours?.nb_epreuves],
    ["concours_epreuves", (c) => c.concours?.epreuves.map((e) => e.id).join(" | ")],
    ["concours_nb_departs", (c) => c.concours?.departs.length || ""],
    ["concours_departs_json", (c) => (c.concours?.departs.length ? JSON.stringify(c.concours.departs) : "")],
    ["epreuve_vue_le", (c) => c.epreuve_vue_le],
    ["epreuve_maj_le", (c) => c.epreuve_maj_le],
    ["epreuve_hash", (c) => c.epreuve_hash],
    ["mandat_url", (c) => c.mandat_url],
    ["mandat_fichier", (c) => c.mandat?.fichier],
    ["mandat_modifie_le", (c) => c.mandat?.modifie_le],
    ["mandat_ocr", (c) => (c.mandat ? ouiNon(!!c.mandat.ocr) : "")],
    ["mandat_departs", departsResume],
    ["mandat_departs_json", (c) => (c.mandat ? JSON.stringify(departsJson(c)) : "")],
    ["mandat_departs_fiable", (c) => (c.mandat ? ouiNon(!!c.mandat.infos?.departs_fiable) : "")],
    ["mandat_nb_departs", (c) => departsEpreuve(c).length || ""],
    ["mandat_depart1_datetime", (c) => departsEpreuve(c)[0]?.datetime],
    ["mandat_jauge", (c) => c.mandat?.infos?.jauge?.places],
    ["mandat_cibles", (c) => c.mandat?.infos?.jauge?.cibles],
    ["mandat_tarifs", tarifsResume],
    ["mandat_tarifs_json", (c) => (c.mandat ? JSON.stringify(tarifsJson(c)) : "")],
    ["mandat_tarifs_fiable", (c) => (c.mandat ? ouiNon(!!c.mandat.infos?.tarifs?.fiable) : "")],
    ["mandat_inscription_mode", (c) => c.mandat?.infos?.inscription?.mode],
    ["mandat_inscription_url", (c) => join(c.mandat?.infos?.inscription?.urls)],
    ["mandat_inscription_email", (c) => join(c.mandat?.infos?.inscription?.emails)],
    ["mandat_date_limite_iso", (c) => c.mandat?.infos?.date_limite_iso],
    ["mandat_date_limite", (c) => c.mandat?.infos?.date_limite_inscription],
    ["mandat_distances", (c) => join(c.mandat?.infos?.distances)],
    ["mandat_blasons", (c) => join(c.mandat?.infos?.blasons)],
    ["mandat_arbitres", (c) => c.mandat?.infos?.arbitres],
    ["mandat_buvette", (c) => (c.mandat ? (c.mandat.infos?.buvette ? "oui" : "non") : "")],
    ["mandat_emails", (c) => join(c.mandat?.infos?.emails)],
    ["mandat_telephones", (c) => join(c.mandat?.infos?.telephones)],
  ];
  /**
   * Échappe une valeur selon les règles du format CSV.
   *
   * Une valeur contenant un point-virgule, un guillemet ou un retour à la ligne est entourée de
   * guillemets, et ses guillemets internes sont doublés. C'est indispensable ici : les titres de
   * concours contiennent des apostrophes et parfois des points-virgules, et les adresses tiennent
   * sur plusieurs lignes. Sans échappement, une seule ligne mal formée décale tout le fichier.
   *
   * Les valeurs absentes deviennent une cellule vide, jamais « undefined » ni « null », qui
   * s'afficheraient tels quels dans le tableur.
   *
   * @param {unknown} v
   * @returns {string}
   */
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [cols.map((c) => c[0]).join(";")];
  for (const r of rows) lines.push(cols.map(([, f]) => esc(f(r))).join(";"));
  return lines.join("\r\n");
}

/**
 * Détermine le département de l'épreuve et le range dans `c.departement`.
 *
 * Le code postal de l'adresse de tir est préféré, parce qu'il désigne l'endroit où l'on tire.
 * Le comité départemental sert de repli pour les fiches sans adresse, ce qui concerne environ un
 * quart des épreuves.
 *
 * @param {import("./types.js").Competition} c modifiée en place
 * @returns {import("./types.js").Competition} la même compétition, pour permettre le chaînage
 */
export function completerDepartement(c) {
  const adresse = (c.detail?.adresse || []).join(" ");
  const cp = adresse.match(/\b(\d{5})\b/);
  let dep = cp ? departementDe({ codePostal: cp[1] }) : null;
  if (!dep) dep = departementDe({ comite: c.detail?.champs?.comite_departemental });
  c.departement = dep;
  return c;
}
