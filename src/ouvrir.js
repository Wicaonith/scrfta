#!/usr/bin/env node
/**
 * @file Ouvre la page de suivi dans le navigateur par défaut.
 *
 * Confort pur, mais qui compte pour le public visé : plutôt que d'expliquer où trouver
 * `output/rapport/index.html` et comment l'ouvrir, `npm run voir` s'en charge.
 *
 * ```
 * node src/ouvrir.js [--out output]
 * ```
 */

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const i = args.indexOf("--out");
const outDir = path.resolve(i >= 0 ? args[i + 1] : "output");
const file = path.join(outDir, "rapport", "index.html");

// Vérification avant d'ouvrir : sans elle, le navigateur afficherait une page d'erreur peu
// explicite, là où un message en français indique quoi faire.
try {
  await fs.access(file);
} catch {
  console.error(`Pas de rapport dans ${file}. Lancez d'abord : npm run scrape (ou npm run rapport).`);
  process.exit(1);
}

const url = pathToFileURL(file).href;

// Chaque système a sa commande d'ouverture. Sous Windows, `start` est une commande interne de
// l'interpréteur et non un exécutable, d'où le passage par `cmd /c` ; son premier argument est
// interprété comme un titre de fenêtre, d'où la chaîne vide qui précède le chemin.
const cmd =
  process.platform === "win32"
    ? ["cmd", ["/c", "start", "", file]]
    : process.platform === "darwin"
      ? ["open", [file]]
      : ["xdg-open", [file]];

// `detached` et `unref` détachent le navigateur de ce programme, qui peut ainsi rendre la main
// immédiatement sans attendre que l'utilisateur ferme sa fenêtre.
spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
console.log(`Ouverture de ${url}`);
