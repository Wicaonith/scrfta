#!/usr/bin/env node
// Ouvre la page de suivi output/rapport/index.html dans le navigateur par défaut (Windows, macOS, Linux).
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const i = args.indexOf("--out");
const outDir = path.resolve(i >= 0 ? args[i + 1] : "output");
const file = path.join(outDir, "rapport", "index.html");

try {
  await fs.access(file);
} catch {
  console.error(`Pas de rapport dans ${file}. Lancez d'abord : npm run scrape (ou npm run rapport).`);
  process.exit(1);
}

const url = pathToFileURL(file).href;
const cmd =
  process.platform === "win32"
    ? ["cmd", ["/c", "start", "", file]]
    : process.platform === "darwin"
      ? ["open", [file]]
      : ["xdg-open", [file]];
spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
console.log(`Ouverture de ${url}`);
