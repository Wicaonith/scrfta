// Régénère l'instantané de non-régression à partir de l'export courant.
// À lancer après une modification volontaire des heuristiques d'extraction, puis à relire dans le diff git.
import fs from "node:fs/promises";
import path from "node:path";
import { deriver } from "../test/snapshot/deriver.js";

const exportFile = path.resolve("output/competitions.json");
const reference = path.resolve("test/snapshot/extraction.json");

let data;
try {
  data = JSON.parse(await fs.readFile(exportFile, "utf8"));
} catch {
  console.error(`Aucun export dans ${exportFile}. Lancez d'abord : npm run scrape`);
  process.exit(1);
}

const mandats = deriver(data.competitions);
await fs.mkdir(path.dirname(reference), { recursive: true });
await fs.writeFile(reference, JSON.stringify({ genere_le: new Date().toISOString(), nb: mandats.length, mandats }, null, 2) + "\n");
console.log(`Instantané mis à jour : ${mandats.length} mandats dans ${reference}`);
console.log("Relisez le diff git avant de committer : chaque écart est une régression ou une amélioration voulue.");
