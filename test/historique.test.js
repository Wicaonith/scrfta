import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { comparer } from "../src/historique.js";

function concours(over = {}) {
  const { detail, ...reste } = over;
  return {
    id: "1000",
    titre: "CONCOURS DE TEST",
    dates_texte: "Le 17 octobre 2026",
    date_debut: "2026-10-17",
    date_fin: "2026-10-17",
    discipline: "Tir à 18m",
    organisateur: "CLUB DE TEST",
    url: "https://www.ffta.fr/epreuve/1000",
    detail: { statut: "Validée", champs: { lieu: "TESTVILLE" }, adresse: [], contacts: {}, ...detail },
    ...reste,
  };
}

const mandat = (over = {}) => ({
  fichier: "mandats/test.pdf",
  modifie_le: "2026-09-01T10:00:00.000Z",
  infos: {
    tarifs: { grille: [{ nb_departs: 1, adulte: 9, jeune: 7 }], fiable: true },
    departs: [{ nom: "Départ 1", date: "2026-10-17", heure_greffe: "08:00", heure_debut: "08:00", datetime: "2026-10-17T08:00", jauge: 40 }],
    jauge: { places: 40, cibles: null },
    date_limite_iso: "2026-10-12",
    inscription: { mode: "mail", urls: [], emails: [] },
    ...over,
  },
});

describe("comparer — mouvements du calendrier", () => {
  test("un concours ajouté", () => {
    const d = comparer([concours({ id: "1" })], [concours({ id: "1" }), concours({ id: "2" })]);
    assert.equal(d.resume.apparus, 1);
    assert.equal(d.apparus[0].id, "2");
    assert.equal(d.resume.disparus, 0);
  });

  test("un concours retiré", () => {
    const d = comparer([concours({ id: "1" }), concours({ id: "2" })], [concours({ id: "1" })]);
    assert.equal(d.resume.disparus, 1);
    assert.equal(d.disparus[0].id, "2");
  });

  test("aucun mouvement entre deux relevés identiques", () => {
    const l = [concours({ id: "1" }), concours({ id: "2" })];
    const d = comparer(l, l.map((c) => structuredClone(c)));
    assert.deepEqual(
      { ...d.resume, avant: 0, apres: 0 },
      { avant: 0, apres: 0, apparus: 0, disparus: 0, modifies: 0, mandats_publies: 0, mandats_modifies: 0 }
    );
  });

  test("les résultats sont triés par date de concours", () => {
    const avant = [];
    const apres = [
      concours({ id: "3", date_debut: "2026-12-01" }),
      concours({ id: "1", date_debut: "2026-10-01" }),
      concours({ id: "2", date_debut: "2026-11-01" }),
    ];
    const d = comparer(avant, apres);
    assert.deepEqual(d.apparus.map((c) => c.id), ["1", "2", "3"]);
  });
});

describe("comparer — modifications de fiche", () => {
  test("un titre modifié est signalé avec l'avant et l'après", () => {
    const d = comparer([concours({ titre: "ANCIEN TITRE" })], [concours({ titre: "NOUVEAU TITRE" })]);
    assert.equal(d.resume.modifies, 1);
    const ch = d.modifies[0].changements.find((c) => c.champ === "titre");
    assert.equal(ch.avant, "ANCIEN TITRE");
    assert.equal(ch.apres, "NOUVEAU TITRE");
    assert.equal(ch.libelle, "Titre");
  });

  test("plusieurs champs modifiés à la fois", () => {
    const d = comparer(
      [concours({ detail: { champs: { lieu: "ANCIEN LIEU" } } })],
      [concours({ titre: "AUTRE", detail: { champs: { lieu: "NOUVEAU LIEU" } } })]
    );
    assert.deepEqual(d.modifies[0].changements.map((c) => c.champ).sort(), ["lieu", "titre"]);
  });

  test("un champ vidé est signalé", () => {
    const d = comparer([concours({ email: "avant@test.fr" })], [concours({ email: null })]);
    const ch = d.modifies[0].changements.find((c) => c.champ === "email");
    assert.equal(ch.apres, null);
  });

  test("une chaîne vide et une valeur absente sont équivalentes, pas un changement", () => {
    const d = comparer([concours({ email: "" })], [concours({ email: null })]);
    assert.equal(d.resume.modifies, 0);
  });
});

describe("comparer — mandats", () => {
  test("un mandat publié entre deux relevés", () => {
    const d = comparer(
      [concours({ id: "1" })],
      [concours({ id: "1", mandat_url: "https://extranet.ffta.fr/x.pdf", mandat: mandat() })]
    );
    assert.equal(d.resume.mandats_publies, 1);
    const p = d.mandats_publies[0];
    assert.equal(p.mandat.departs.length, 1);
    assert.deepEqual(p.mandat.tarifs, [
      { departs: 1, public: "adulte", montant_cents: 900 },
      { departs: 1, public: "jeune", montant_cents: 700 },
    ]);
    assert.equal(p.mandat.date_limite, "2026-10-12");
  });

  test("la publication d'un mandat n'est pas comptée aussi comme une fiche modifiée", () => {
    const d = comparer(
      [concours({ id: "1" })],
      [concours({ id: "1", mandat_url: "https://extranet.ffta.fr/x.pdf", mandat: mandat() })]
    );
    assert.equal(d.resume.mandats_publies, 1);
    assert.equal(d.resume.modifies, 0, "le seul changement de fiche est le lien du mandat, déjà signalé");
  });

  test("un tarif modifié dans un mandat existant", () => {
    const avant = concours({ id: "1", mandat_url: "u", mandat: mandat() });
    const apresMandat = mandat();
    apresMandat.infos.tarifs.grille = [{ nb_departs: 1, adulte: 11, jeune: 8 }];
    const d = comparer([avant], [concours({ id: "1", mandat_url: "u", mandat: apresMandat })]);

    assert.equal(d.resume.mandats_modifies, 1);
    const ch = d.mandats_modifies[0].changements.find((c) => c.champ === "tarifs");
    assert.match(ch.avant, /adulte 9,00 €|adulte 9.00 €/);
    assert.match(ch.apres, /adulte 11,00 €|adulte 11.00 €/);
  });

  test("un horaire de départ modifié", () => {
    const avant = concours({ id: "1", mandat_url: "u", mandat: mandat() });
    const apresMandat = mandat();
    apresMandat.infos.departs[0].datetime = "2026-10-17T09:00";
    const d = comparer([avant], [concours({ id: "1", mandat_url: "u", mandat: apresMandat })]);
    assert.equal(d.resume.mandats_modifies, 1);
    assert.ok(d.mandats_modifies[0].changements.some((c) => c.champ === "departs"));
  });

  test("une date limite repoussée", () => {
    const avant = concours({ id: "1", mandat_url: "u", mandat: mandat() });
    const apresMandat = mandat();
    apresMandat.infos.date_limite_iso = "2026-10-15";
    const d = comparer([avant], [concours({ id: "1", mandat_url: "u", mandat: apresMandat })]);
    const ch = d.mandats_modifies[0].changements.find((c) => c.champ === "date_limite");
    assert.equal(ch.avant, "2026-10-12");
    assert.equal(ch.apres, "2026-10-15");
  });

  test("un mandat identique ne produit aucun signalement", () => {
    const avant = concours({ id: "1", mandat_url: "u", mandat: mandat() });
    const apres = concours({ id: "1", mandat_url: "u", mandat: mandat() });
    const d = comparer([avant], [apres]);
    assert.equal(d.resume.mandats_modifies, 0);
    assert.equal(d.resume.modifies, 0);
  });
});
