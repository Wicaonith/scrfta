import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { reextractInfos, parseMandat } from "../src/mandat.js";
import { creerPdf, mandatSimple } from "./fixtures/pdf.js";
import * as f from "./fixtures/mandats.js";

const lire = (fixture) => reextractInfos(fixture.texte, fixture.contexte);

describe("mandat en colonnes : un départ par colonne, dates dans l'en-tête", () => {
  const infos = lire(f.colonnes);

  test("trois départs, aux bonnes dates", () => {
    assert.equal(infos.departs.length, 3);
    assert.deepEqual(
      infos.departs.map((d) => d.date),
      ["2026-10-17", "2026-10-18", "2026-10-18"]
    );
  });

  test("horaires de greffe, échauffement et tirs par départ", () => {
    assert.deepEqual(
      infos.departs.map((d) => d.heure_greffe),
      ["13:00", "07:45", "13:00"]
    );
    assert.deepEqual(
      infos.departs.map((d) => d.heure_debut_tirs),
      ["14:00", "08:45", "14:00"]
    );
    assert.equal(infos.departs[0].datetime, "2026-10-17T13:00");
  });

  test("noms repris de l'en-tête, sans la date accolée", () => {
    assert.deepEqual(
      infos.departs.map((d) => d.nom),
      ["DEPART 1", "DEPART 2", "DEPART 3"]
    );
  });

  test("grille tarifaire par nombre de départs", () => {
    assert.deepEqual(infos.tarifs.grille, [
      { nb_departs: 1, adulte: 10, jeune: 8 },
      { nb_departs: 2, adulte: 16, jeune: 12 },
      { nb_departs: 3, adulte: 22, jeune: 16 },
    ]);
  });

  test("jauge, date limite et mode d'inscription", () => {
    assert.equal(infos.jauge.places, 96);
    assert.equal(infos.date_limite_iso, "2026-10-14");
    assert.equal(infos.inscription.mode, "mail");
    assert.ok(infos.inscription.emails.includes("concours@archers-testville.fr"));
  });

  test("les valeurs sont jugées fiables", () => {
    assert.equal(infos.tarifs.fiable, true);
    assert.equal(infos.departs_fiable, true);
  });
});

describe("mandat avec tarifs en colonnes Adulte / Jeune", () => {
  const infos = lire(f.tarifsAdulteJeune);

  test("deux départs le même jour", () => {
    assert.equal(infos.departs.length, 2);
    assert.deepEqual(
      infos.departs.map((d) => d.date),
      ["2026-09-20", "2026-09-20"]
    );
    assert.deepEqual(
      infos.departs.map((d) => d.heure_greffe),
      ["08:30", "13:15"]
    );
  });

  test("le tableau est lu dans le bon sens : 1 tir puis 2 tirs", () => {
    assert.deepEqual(infos.tarifs.grille, [
      { nb_departs: 1, adulte: 9, jeune: 7 },
      { nb_departs: 2, adulte: 16, jeune: 12 },
    ]);
  });

  test("distances et blasons relevés", () => {
    assert.ok(infos.distances.includes("70m"));
    assert.ok(infos.blasons.some((b) => /122/.test(b)));
  });

  test("date limite d'inscription", () => {
    assert.equal(infos.date_limite_iso, "2026-09-15");
  });
});

describe("mandat avec départs décrits ligne par ligne", () => {
  const infos = lire(f.lignes);

  test("deux départs, horaires de greffe et d'échauffement", () => {
    assert.equal(infos.departs.length, 2);
    assert.deepEqual(
      infos.departs.map((d) => d.heure_greffe),
      ["08:00", "13:30"]
    );
    assert.deepEqual(
      infos.departs.map((d) => d.heure_echauffement),
      ["08:30", "14:00"]
    );
  });

  test("jauge par départ", () => {
    assert.equal(infos.jauge.places, 15);
    assert.equal(infos.departs[0].jauge, 15);
  });

  test("grille tarifaire", () => {
    assert.deepEqual(infos.tarifs.grille, [
      { nb_departs: 1, adulte: 9, jeune: 7 },
      { nb_departs: 2, adulte: 16, jeune: 12 },
    ]);
  });

  test("buvette détectée", () => assert.equal(infos.buvette, true));
});

describe("mandat avec tarifs rédigés en phrases", () => {
  const infos = lire(f.enLigne);

  test("deux départs sur la même ligne, matin et après-midi", () => {
    assert.equal(infos.departs.length, 2);
    assert.deepEqual(
      infos.departs.map((d) => d.heure_greffe),
      ["07:30", "12:45"]
    );
  });

  test("tarifs extraits des phrases", () => {
    assert.deepEqual(infos.tarifs.grille, [
      { nb_departs: 1, adulte: 12, jeune: 7 },
      { nb_departs: 2, adulte: 18, jeune: 12 },
    ]);
  });

  test("nombre de cibles", () => assert.equal(infos.jauge.cibles, 24));

  test("inscription par lien, y compris une URL courte", () => {
    assert.equal(infos.inscription.mode, "url");
    assert.ok(infos.inscription.urls.includes("https://urlz.fr/aBcDeF"));
  });

  test("date limite", () => assert.equal(infos.date_limite_iso, "2026-09-06"));
});

describe("pièges à éviter", () => {
  const infos = lire(f.piegePenalite);

  test("une pénalité de désistement n'est pas un tarif d'inscription", () => {
    assert.deepEqual(infos.tarifs.grille, []);
    assert.equal(
      infos.tarifs.lignes.some((l) => /factur/i.test(l)),
      false,
      "les lignes de pénalité ne doivent pas figurer parmi les tarifs"
    );
  });

  test("la date limite est celle des inscriptions, pas celle du désistement", () => {
    assert.equal(infos.date_limite_iso, "2026-10-21");
  });

  test("le départ reste correctement lu", () => {
    assert.equal(infos.departs.length, 1);
    assert.equal(infos.departs[0].datetime, "2026-10-24T13:30");
  });
});

describe("indicateurs de fiabilité", () => {
  test("une grille incohérente (jeune plus cher que l'adulte) est signalée", () => {
    const infos = lire(f.tarifsIncoherents);
    assert.equal(infos.tarifs.fiable, false);
  });

  test("un texte issu de l'OCR rend la grille non fiable", () => {
    const infos = reextractInfos(f.lignes.texte, {
      ...f.lignes.contexte,
      texte_ocr: f.lignes.texte, // tout le texte provient de la reconnaissance de caractères
    });
    assert.equal(infos.tarifs.fiable, false);
    assert.equal(infos.departs_fiable, false);
  });

  test("un mandat sans horaire ni tarif ne prétend rien", () => {
    const infos = reextractInfos("Concours de test\nRenseignements au club.", { date_debut: "2027-01-01" });
    assert.deepEqual(infos.departs, []);
    assert.deepEqual(infos.tarifs.grille, []);
    assert.equal(infos.departs_fiable, false);
    assert.equal(infos.tarifs.fiable, false);
    assert.equal(infos.date_limite_iso, null);
  });
});

describe("analyse d'un mandat depuis un vrai fichier PDF", () => {
  let dossier;
  before(async () => {
    dossier = await fs.mkdtemp(path.join(os.tmpdir(), "scrfta-mandat-"));
  });
  after(async () => {
    await fs.rm(dossier, { recursive: true, force: true });
  });

  test("le PDF est lu et les informations en sont extraites", async () => {
    const fichier = path.join(dossier, "mandat.pdf");
    await fs.writeFile(fichier, creerPdf(mandatSimple));

    const m = await parseMandat(fichier, {
      ocr: false,
      contexte: { date_debut: "2026-10-17", date_fin: "2026-10-17" },
    });

    assert.equal(m.fichier, "mandat.pdf");
    assert.equal(m.pages, 1);
    assert.equal(m.ocr, false);
    assert.equal(m.texte_ocr, "");
    assert.match(m.texte, /LES ARCHERS DE TESTVILLE/);

    assert.equal(m.infos.departs.length, 1);
    assert.equal(m.infos.departs[0].heure_greffe, "08:30");
    assert.equal(m.infos.departs[0].heure_debut_tirs, "09:15");
    assert.equal(m.infos.date_limite_iso, "2026-10-12");
    assert.equal(m.infos.inscription.mode, "mail");
    assert.ok(m.infos.emails.includes("concours@archers-testville.fr"));
    assert.equal(m.infos.buvette, true);
  });

  test("le texte est normalisé : espaces multiples et lignes vides réduits", async () => {
    const fichier = path.join(dossier, "espaces.pdf");
    await fs.writeFile(
      fichier,
      creerPdf([[{ texte: "Un    texte     espace", x: 60, y: 700 }, { texte: "Suite", x: 60, y: 600 }]])
    );
    const m = await parseMandat(fichier, { ocr: false });
    assert.equal(m.texte.includes("  "), false, "aucune suite de deux espaces");
    assert.equal(/\n{3,}/.test(m.texte), false, "jamais plus d'une ligne vide d'affilée");
  });
});

describe("tarifs multi-départs : la réduction est incluse dans le prix total", () => {
  test("« U11 à U21 » désigne les jeunes, « S.1 à S.3 » les adultes", () => {
    assert.deepEqual(lire(f.categoriesFederales).tarifs.grille, [
      { nb_departs: 1, adulte: 12, jeune: 10 },
      { nb_departs: 2, adulte: 20, jeune: 15 },
    ]);
  });

  test("cellule d'angle « CATÉGORIE » et publics entre parenthèses", () => {
    assert.deepEqual(lire(f.angleCategorie).tarifs.grille, [
      { nb_departs: 1, adulte: 8, jeune: 6 },
      { nb_departs: 2, adulte: 14, jeune: 10 },
    ]);
  });

  test("« tir supplémentaire + 6 € » : grille prolongée jusqu'au nombre de départs proposés", () => {
    const t = lire(f.supplementParTir).tarifs;
    assert.deepEqual(t.grille, [
      { nb_departs: 1, adulte: 9, jeune: 7 },
      { nb_departs: 2, adulte: 16, jeune: 13 },
      { nb_departs: 3, adulte: 23, jeune: 19 },
    ]);
    assert.deepEqual(t.supplement, { jeune: 6, adulte: 7 });
    assert.equal(t.fiable, true);
  });

  test("le prix de base n'est pas pris pour le supplément", () => {
    // « 9 € / tir supplémentaire + 7 € » : la barre oblique ne veut pas dire « par »
    assert.equal(lire(f.supplementParTir).tarifs.supplement.adulte, 7);
  });

  test("sans départs lisibles, aucun tarif n'est inventé au-delà de ce qui est écrit", () => {
    const t = lire(f.supplementSansDeparts).tarifs;
    assert.deepEqual(t.grille, [
      { nb_departs: 1, adulte: 9, jeune: 7 },
      { nb_departs: 2, adulte: 15, jeune: 11 },
    ]);
    assert.deepEqual(t.supplement, { adulte: 6, jeune: 4 }, "la règle reste disponible");
  });

  test("« 16,00 € (2 tirs) » et licences A / J", () => {
    assert.deepEqual(lire(f.prixPuisNombre).tarifs.grille, [
      { nb_departs: 1, adulte: 9, jeune: 7 },
      { nb_departs: 2, adulte: 16, jeune: 12 },
    ]);
  });

  test("montants sans symbole €, dans un tableau identifié", () => {
    assert.deepEqual(lire(f.montantsSansSymbole).tarifs.grille, [
      { nb_departs: 1, adulte: 8, jeune: 6 },
      { nb_departs: 2, adulte: 15, jeune: 11 },
      { nb_departs: 3, adulte: 22, jeune: 16 },
    ]);
  });

  test("prix alignés par des points de conduite", () => {
    assert.deepEqual(lire(f.pointsDeConduite).tarifs.grille, [
      { nb_departs: 1, adulte: 9, jeune: 7 },
      { nb_departs: 2, adulte: 16, jeune: 12 },
      { nb_departs: 3, adulte: 23, jeune: 17 },
    ]);
  });

  test("une ligne parasite n'interrompt pas la lecture du tableau", () => {
    assert.deepEqual(lire(f.tableauInterrompu).tarifs.grille, [
      { nb_departs: 1, adulte: 9, jeune: 7 },
      { nb_departs: 2, adulte: 16, jeune: 12 },
      { nb_departs: 3, adulte: 22, jeune: 16 },
    ]);
  });

  test("« U21 à Senior 3 » reste adulte", () => {
    const grille = lire(f.colonnes).tarifs.grille;
    assert.equal(grille[0].adulte, 10);
    assert.equal(grille[0].jeune, 8);
  });
});
