#!/usr/bin/env node
/**
 * Ré-analyse les mandats d'un competitions.json existant sans re-scraper le site.
 *
 *   node src/reparse.js [--out output] [--llm] [--no-ocr] [--force] [--id 24876,26477]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { analyseMandats } from "./analyse.js";
import { writeOutputs } from "./output.js";

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out || "output");
const jsonFile = path.join(outDir, "competitions.json");

const data = JSON.parse(await fs.readFile(jsonFile, "utf8"));
const { competitions, genere_le, nb, ...meta } = data;
const ids = args.id ? String(args.id).split(",") : null;
const selection = ids ? competitions.filter((c) => ids.includes(String(c.id))) : competitions;

log(`${selection.length} compétitions, ${selection.filter((c) => c.mandat_url).length} avec mandat`);
await analyseMandats(selection, {
  outDir,
  ocr: !args["no-ocr"],
  llm: !!args.llm,
  force: !!args.force,
  log,
});

const files = await writeOutputs(outDir, meta, competitions);
log(`Écrit : ${files.jsonFile}`);
log(`Écrit : ${files.csvFile}`);

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
