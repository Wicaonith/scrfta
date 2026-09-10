#!/usr/bin/env node
/**
 * @file Ré-analyse les mandats d'un relevé existant, sans retourner sur le site.
 *
 * ## À quoi cela sert
 *
 * Les heuristiques d'extraction s'améliorent au fil des mandats rencontrés. Chaque amélioration doit
 * être vérifiée sur les mandats déjà collectés : est-ce que le nouveau cas est bien compris, et
 * est-ce que les anciens le restent ?
 *
 * Relancer une collecte complète pour cela serait absurde. Le texte des mandats est déjà dans le
 * JSON, et les PDF sont sur le disque : cette commande rejoue l'analyse sur ces données, en quelques
 * secondes au lieu de plusieurs minutes, et sans solliciter le serveur fédéral.
 *
 * C'est aussi la commande à lancer après avoir mis le programme à jour, pour que les relevés
 * existants profitent des nouveaux champs.
 *
 * ## Utilisation
 *
 * ```
 * node src/reparse.js [--out output] [--no-ocr] [--force] [--id 24876,26477] [--inclure-internes] [--no-rapport]
 * ```
 *
 * `--force` réanalyse même ce qui est déjà en cache, `--id` limite à quelques épreuves pour mettre
 * au point une heuristique sur un cas précis.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { analyseMandats } from "./analyse.js";
import { writeOutputs, completerCompetitions, regrouperConcours } from "./output.js";
import { estInterne } from "./config.js";
import { archiver } from "./historique.js";
import { genererRapport } from "./rapport.js";

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out || "output");
const jsonFile = path.join(outDir, "competitions.json");

// `genere_le` et `nb` sont retirés puis recalculés par `writeOutputs` ; le reste des métadonnées,
// notamment les filtres qui ont produit ce relevé, est conservé tel quel.
const data = JSON.parse(await fs.readFile(jsonFile, "utf8"));
let { competitions, genere_le, nb, ...meta } = data;

// Un relevé produit par une version antérieure peut contenir des concours internes, exclus depuis
if (!args["inclure-internes"]) {
  const internes = competitions.filter(estInterne);
  competitions = competitions.filter((c) => !estInterne(c));
  if (internes.length) log(`${internes.length} concours internes exclus : ${internes.map((c) => c.id).join(", ")}`);
}
// `--id` restreint le travail à quelques épreuves, pratique pour mettre au point une heuristique
// sur un mandat particulier sans attendre l'analyse des deux cents autres.
const ids = args.id ? String(args.id).split(",") : null;
const selection = ids ? competitions.filter((c) => ids.includes(String(c.id))) : competitions;

log(`${selection.length} compétitions, ${selection.filter((c) => c.mandat_url).length} avec mandat`);
await analyseMandats(selection, {
  outDir,
  ocr: !args["no-ocr"],
  force: !!args.force,
  log,
});

// Le relevé se compare à lui-même : les fiches n'ayant pas été relues sur le site, aucune ne peut
// avoir changé, et les dates de suivi sont donc préservées telles quelles.
completerCompetitions(selection, new Map(competitions.map((c) => [String(c.id), c])));
regrouperConcours(competitions);

// On écrit toujours l'ensemble des compétitions, même quand `--id` n'en a réanalysé que quelques-unes :
// écrire la seule sélection amputerait le relevé de tout le reste.
const files = await writeOutputs(outDir, meta, competitions);
log(`Écrit : ${files.jsonFile}`);
log(`Écrit : ${files.csvFile}`);

// Pas d'archive après un `--id` : le relevé serait partiel et fausserait les comparaisons.
// Pas d'archive non plus si le fichier a dû être écrit sous un nom horodaté, faute de quoi on
// archiverait l'ancienne version restée en place.
if (!args["no-rapport"] && !ids && files.jsonFile.endsWith("competitions.json")) {
  log(`Snapshot : ${await archiver(outDir)}`);
  await genererRapport(outDir, log);
}

/**
 * Analyse les arguments de la ligne de commande.
 * Volontairement identique à celle de `scrape.js` : quelques lignes dupliquées valent mieux qu'un
 * module partagé pour si peu.
 *
 * @param {string[]} argv
 * @returns {Object<string, string|boolean>}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

/**
 * Journalise une étape, horodatée, sur la sortie d'erreur.
 * @param {string} msg
 */
function log(msg) {
  console.error(`[${new Date().toLocaleTimeString("fr-FR")}] ${msg}`);
}
