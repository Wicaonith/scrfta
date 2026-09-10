// Tests de la mise en page : c'est l'algorithme par lequel passe chaque tableau de chaque mandat.
// Il travaille sur les « items » de pdf.js, qu'on peut fabriquer sans PDF réel.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { layoutText, extractPdfText } from "../src/pdf.js";
import { creerPdf } from "./fixtures/pdf.js";

/** Fabrique un item pdf.js : un mot posé à la position (x, y), de largeur w et de corps h. */
const mot = (str, x, y, w = str.length * 6, h = 10) => ({
  str,
  transform: [h, 0, 0, h, x, y],
  width: w,
  height: h,
});

describe("regroupement en lignes", () => {
  test("des mots à la même hauteur forment une seule ligne", () => {
    assert.equal(layoutText([mot("Début", 10, 100), mot("des", 50, 100), mot("tirs", 75, 100)]), "Début des tirs");
  });

  test("des hauteurs différentes forment des lignes distinctes", () => {
    const out = layoutText([mot("Première", 10, 100), mot("Seconde", 10, 80)]);
    assert.equal(out, "Première\nSeconde");
  });

  test("les lignes sont rendues de haut en bas, quel que soit l'ordre des items", () => {
    const out = layoutText([mot("Bas", 10, 40), mot("Haut", 10, 100), mot("Milieu", 10, 70)]);
    assert.equal(out, "Haut\nMilieu\nBas");
  });

  test("un léger décalage vertical reste sur la même ligne", () => {
    // les caractères d'une même ligne ne sont pas toujours parfaitement alignés
    const out = layoutText([mot("Greffe", 10, 100), mot("8h00", 60, 102)]);
    assert.equal(out.split("\n").length, 1);
  });

  test("les mots d'une ligne sont remis dans l'ordre horizontal", () => {
    assert.equal(layoutText([mot("tirs", 75, 100), mot("Début", 10, 100), mot("des", 50, 100)]), "Début des tirs");
  });
});

describe("détection des colonnes", () => {
  test("un grand écart horizontal devient un séparateur de colonne", () => {
    // corps 10 : au-delà de 15 points d'écart, on change de colonne
    const out = layoutText([mot("Ouverture du greffe", 10, 100, 80), mot("13h00", 200, 100)]);
    assert.equal(out, "Ouverture du greffe | 13h00");
  });

  test("un tableau à trois colonnes est reconstitué", () => {
    const out = layoutText([
      mot("Tarifs", 10, 100, 40),
      mot("1 tir", 150, 100, 30),
      mot("2 tirs", 300, 100, 35),
      mot("Adultes", 10, 80, 45),
      mot("9 €", 150, 80, 20),
      mot("16 €", 300, 80, 25),
    ]);
    assert.equal(out, "Tarifs | 1 tir | 2 tirs\nAdultes | 9 € | 16 €");
  });

  test("un petit écart reste une espace, pas une colonne", () => {
    const out = layoutText([mot("Début", 10, 100, 30), mot("des", 45, 100, 18), mot("tirs", 66, 100, 22)]);
    assert.equal(out, "Début des tirs");
  });

  test("des mots collés ne sont pas séparés", () => {
    const out = layoutText([mot("18", 10, 100, 12), mot("m", 22, 100, 6)]);
    assert.equal(out, "18m");
  });

  test("le seuil de colonne suit la taille de police", () => {
    // même écart de 40 points : colonne en corps 10, simple espace en corps 40
    const petit = layoutText([mot("A", 10, 100, 10, 10), mot("B", 60, 100, 10, 10)]);
    const grand = layoutText([mot("A", 10, 100, 10, 40), mot("B", 60, 100, 10, 40)]);
    assert.equal(petit, "A | B");
    assert.equal(grand, "A B");
  });
});

describe("cas limites", () => {
  test("aucun item", () => assert.equal(layoutText([]), ""));

  test("les items vides ou blancs sont ignorés", () => {
    assert.equal(layoutText([mot("", 10, 100), mot("   ", 30, 100), mot("Texte", 50, 100)]), "Texte");
  });

  test("un item sans hauteur ne fait pas échouer le calcul", () => {
    const sansHauteur = { str: "Test", transform: [0, 0, 0, 0, 10, 100], width: 20 };
    assert.equal(layoutText([sansHauteur]), "Test");
  });

  test("les séparateurs redondants sont nettoyés", () => {
    const out = layoutText([mot("A", 10, 100, 10), mot("B", 300, 100, 10)]);
    assert.equal(out.includes("| |"), false);
  });
});

describe("lecture d'un PDF de bout en bout", () => {
  let dossier;

  before(async () => {
    dossier = await fs.mkdtemp(path.join(os.tmpdir(), "scrfta-pdf-"));
  });
  after(async () => {
    await fs.rm(dossier, { recursive: true, force: true });
  });

  /** Écrit un PDF fabriqué dans le dossier temporaire et renvoie son chemin. */
  async function ecrire(nom, pages) {
    const f = path.join(dossier, nom);
    await fs.writeFile(f, creerPdf(pages));
    return f;
  }

  test("les colonnes sont reconstituées depuis un vrai fichier", async () => {
    const f = await ecrire("colonnes.pdf", [
      [
        { texte: "Ouverture du greffe", x: 60, y: 700 },
        { texte: "8h30", x: 400, y: 700 },
        { texte: "Debut des tirs", x: 60, y: 670 },
        { texte: "9h15", x: 400, y: 670 },
      ],
    ]);
    const r = await extractPdfText(f, { ocr: false });
    assert.equal(r.text, "Ouverture du greffe | 8h30\nDebut des tirs | 9h15");
    assert.equal(r.pages, 1);
    assert.equal(r.ocr, false);
    assert.deepEqual(r.ocr_pages, []);
  });

  test("les pages sont lues dans l'ordre et séparées", async () => {
    const f = await ecrire("deux-pages.pdf", [
      [{ texte: "Premiere page", x: 60, y: 700 }],
      [{ texte: "Seconde page", x: 60, y: 700 }],
    ]);
    const r = await extractPdfText(f, { ocr: false });
    assert.equal(r.pages, 2);
    assert.equal(r.text, "Premiere page\n\nSeconde page");
  });

  test("une page presque vide n'est pas envoyée à l'OCR quand il est désactivé", async () => {
    const f = await ecrire("vide.pdf", [[{ texte: "Peu de texte", x: 60, y: 700 }]]);
    const r = await extractPdfText(f, { ocr: false });
    assert.equal(r.ocr, false);
    assert.equal(r.text, "Peu de texte");
  });

  test("les parenthèses et antislashs du texte ne cassent pas le fichier", async () => {
    const f = await ecrire("echappement.pdf", [[{ texte: "Tarif (adulte) 9 EUR", x: 60, y: 700 }]]);
    const r = await extractPdfText(f, { ocr: false });
    assert.equal(r.text, "Tarif (adulte) 9 EUR");
  });
});
