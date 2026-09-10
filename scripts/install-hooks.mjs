// Active les hooks git versionnés du dossier .githooks (appelé par « npm install »).
// Sans effet si on n'est pas dans un dépôt git (projet téléchargé en zip, installé comme dépendance…).
import { execFileSync } from "node:child_process";
import fs from "node:fs";

if (!fs.existsSync(".git")) process.exit(0);

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  console.log("Hooks git activés : output/ ne peut plus être committé par erreur.");
} catch {
  // git absent ou dépôt en lecture seule : ce n'est pas bloquant pour l'installation
}
