import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resoudreFiltres, aideFiltres } from "../src/filtres.js";
import { DEPARTEMENTS } from "../src/config.js";

const codes = (r) => r.depIds.map((id) => DEPARTEMENTS[id].code).sort();

describe("zone géographique", () => {
  test("sans option : les Pays de la Loire", () => {
    const r = resoudreFiltres({});
    assert.deepEqual(codes(r), ["44", "49", "53", "72", "85"]);
    assert.deepEqual(r.description.regions, ["Pays de la Loire"]);
  });

  test("une région nommée, accents et casse indifférents", () => {
    assert.deepEqual(codes(resoudreFiltres({ region: "Bretagne" })), ["22", "29", "35", "56"]);
    assert.deepEqual(codes(resoudreFiltres({ region: "bretagne" })), ["22", "29", "35", "56"]);
    assert.equal(resoudreFiltres({ region: "ile-de-france" }).description.regions[0], "Île-de-France");
  });

  test("plusieurs régions séparées par des virgules", () => {
    const r = resoudreFiltres({ region: "Bretagne, Pays de la Loire" });
    assert.equal(r.depIds.length, 9);
    assert.deepEqual(r.description.regions, ["Bretagne", "Pays de la Loire"]);
  });

  test("france : aucun filtre de département", () => {
    const r = resoudreFiltres({ region: "france" });
    assert.deepEqual(r.depIds, []);
    assert.deepEqual(r.description.regions, ["France entière"]);
  });

  test("départements par numéro, Corse et outre-mer compris", () => {
    assert.deepEqual(codes(resoudreFiltres({ dep: "44,85" })), ["44", "85"]);
    assert.deepEqual(codes(resoudreFiltres({ dep: "2A,974" })), ["2A", "974"]);
  });

  test("un numéro sur un chiffre est complété", () => {
    assert.deepEqual(codes(resoudreFiltres({ dep: "1" })), ["01"]);
  });

  test("les départements l'emportent sur la région", () => {
    const r = resoudreFiltres({ dep: "44", region: "Bretagne" });
    assert.deepEqual(codes(r), ["44"]);
  });
});

describe("autres filtres de la page", () => {
  test("dates", () => {
    const r = resoudreFiltres({ start: "2027-01-01", end: "2027-03-31" });
    assert.equal(r.params.start, "2027-01-01");
    assert.equal(r.params.end, "2027-03-31");
  });

  test("discipline par code, par libellé ou par identifiant", () => {
    assert.equal(resoudreFiltres({ discipline: "salle" }).params.discipline, "103");
    assert.equal(resoudreFiltres({ discipline: "Tir à 18m" }).params.discipline, "103");
    assert.equal(resoudreFiltres({ discipline: "103" }).params.discipline, "103");
    assert.equal(resoudreFiltres({ discipline: "3d" }).params.discipline, "108");
  });

  test("univers", () => {
    assert.equal(resoudreFiltres({ univers: "para" }).params.univers, "297");
    assert.equal(resoudreFiltres({ univers: "Tir de parcours" }).params.univers, "300");
  });

  test("recherche libre", () => {
    assert.equal(resoudreFiltres({ search: "nantes" }).params.search, "nantes");
  });

  test("calendrier restreint, inclus ou exclu", () => {
    assert.equal(resoudreFiltres({ restreint: true }).params.inter, "1");
    assert.equal(resoudreFiltres({ restreint: "1" }).params.inter, "1");
    assert.equal(resoudreFiltres({ restreint: "0" }).params.inter, "0");
    assert.equal(resoudreFiltres({ restreint: "non" }).params.inter, "0");
  });

  test("ordre décroissant", () => {
    assert.equal(resoudreFiltres({ sort: "desc" }).params.sort_order, "DESC");
    assert.equal(resoudreFiltres({ sort: "asc" }).params.sort_order, undefined);
  });

  test("sans option, aucun paramètre parasite n'est envoyé au site", () => {
    assert.deepEqual(resoudreFiltres({}).params, {});
  });
});

describe("valeurs invalides : une erreur explicite, jamais un filtre silencieusement ignoré", () => {
  const messages = [
    [{ region: "Normandy" }, /Région inconnue/],
    [{ dep: "999" }, /Département inconnu/],
    [{ discipline: "tir a la carabine" }, /Discipline inconnue/],
    [{ univers: "cyclisme" }, /Univers inconnu/],
    [{ start: "01/10/2026" }, /--start attend une date/],
    [{ end: "demain" }, /--end attend une date/],
  ];

  for (const [args, attendu] of messages) {
    test(JSON.stringify(args), () => {
      assert.throws(() => resoudreFiltres(args), attendu);
    });
  }

  test("le message cite les valeurs acceptées", () => {
    assert.throws(() => resoudreFiltres({ region: "Normandy" }), /Pays de la Loire/);
    assert.throws(() => resoudreFiltres({ discipline: "xxx" }), /salle/);
  });
});

describe("aideFiltres", () => {
  test("liste les régions avec leurs départements, les disciplines et les univers", () => {
    const aide = aideFiltres();
    assert.match(aide, /Pays de la Loire\s+44, 49, 53, 72, 85/);
    assert.match(aide, /beursault/);
    assert.match(aide, /parcours/);
  });
});
