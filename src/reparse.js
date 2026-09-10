#!/usr/bin/env node
/**
 * Ré-analyse les mandats d'un competitions.json existant sans re-scraper le site.
 *
 *   node src/reparse.js [--out output] [--no-ocr] [--force] [--id 24876,26477] [--inclure-internes] [--no-rapport]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { analyseMandats } from "./analyse.js";
import { writeOutputs, completerCompetitions } from "./output.js";
import { estInterne } from "./config.js";
import { archiver } from "./historique.js";
import { genererRapport } from "./rapport.js";

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out || "output");
const jsonFile = path.join(outDir, "competitions.json");

const data = JSON.parse(await fs.readFile(jsonFile, "utf8"));
let { competitions, genere_le, nb, ...meta } = data;
if (!args["inclure-internes"]) {
  const internes = competitions.filter(estInterne);
  competitions = competitions.filter((c) => !estInterne(c));
  if (internes.length) log(`${internes.length} concours internes exclus : ${internes.map((c) => c.id).join(", ")}`);
}
const ids = args.id ? String(args.id).split(",") : null;
const selection = ids ? competitions.filter((c) => ids.includes(String(c.id))) : competitions;

log(`${selection.length} compétitions, ${selection.filter((c) => c.mandat_url).length} avec mandat`);
await analyseMandats(selection, {
  outDir,
  ocr: !args["no-ocr"],
  force: !!args.force,
  log,
});

completerCompetitions(selection, new Map(competitions.map((c) => [String(c.id), c])));
const files = await writeOutputs(outDir, meta, competitions);
log(`Écrit : ${files.jsonFile}`);
log(`Écrit : ${files.csvFile}`);
if (!args["no-rapport"] && !ids && files.jsonFile.endsWith("competitions.json")) {
  log(`Snapshot : ${await archiver(outDir)}`);
  await genererRapport(outDir, log);
}

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

function log(msg) {
  console.error(`[${new Date().toLocaleTimeString("fr-FR")}] ${msg}`);
}
