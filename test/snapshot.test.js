// Test de non-régression : rejoue l'extraction sur les vrais mandats déjà téléchargés
// et compare le résultat à un instantané de référence.
//
// Les mandats vivent dans output/, qui n'est pas versionné : sur un dépôt fraîchement cloné,
// ce test est ignoré. Il protège la machine de développement et le serveur, là où les données existent.
//
// Après une modification volontaire des heuristiques :  npm run snapshot
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { deriver } from "./snapshot/deriver.js";

const EXPORT = path.resolve("output/competitions.json");
const REFERENCE = path.resolve("test/snapshot/extraction.json");

async function charger(f) {
  try {
    return JSON.parse(await fs.readFile(f, "utf8"));
  } catch {
    return null;
  }
}

describe("non-régression sur les mandats réels", async () => {
  const exporte = await charger(EXPORT);
  const reference = await charger(REFERENCE);

  if (!exporte || !reference) {
    test("ignoré : aucune donnée locale à comparer", { skip: "lancez npm run scrape puis npm run snapshot" }, () => {});
    return;
  }

  const actuel = deriver(exporte.competitions);
  const parId = (l) => new Map(l.map((x) => [x.id, x]));
  const ref = parId(reference.mandats);
  const now = parId(actuel);

  // Un concours passé disparaît du calendrier, donc de l'export : c'est normal, pas une régression.
  // Seul compte le cas d'une épreuve encore présente dont le mandat n'est plus analysé.
  const presents = new Set(exporte.competitions.map((c) => String(c.id)));

  test("les mandats encore au calendrier sont toujours analysés", () => {
    const manquants = [...ref.keys()].filter((id) => presents.has(id) && !now.has(id));
    assert.deepEqual(manquants, [], "des mandats de la référence ne sont plus analysés");
  });

  for (const [id, attendu] of ref) {
    if (!presents.has(id)) continue; // concours passé, sorti du calendrier
    test(`${id} — ${attendu.titre}`, () => {
      const obtenu = now.get(id);
      if (!obtenu) return; // déjà signalé par le test précédent
      assert.deepEqual(obtenu, attendu);
    });
  }

  test("aucune donnée personnelle dans l'instantané", () => {
    const brut = JSON.stringify(reference);
    assert.equal(/[\w.+-]+@[\w-]+\.[\w.-]+/.test(brut), false, "une adresse mail figure dans l'instantané");
    assert.equal(/\b0[1-9](?:[\s.-]?\d{2}){4}\b/.test(brut), false, "un numéro de téléphone figure dans l'instantané");
  });
});
