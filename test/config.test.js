import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { REGIONS, DEPARTEMENTS, DISCIPLINES, departementDe, disciplineDe, estInterne } from "../src/config.js";

describe("cohérence des tables", () => {
  test("chaque département d'une région existe dans la table des départements", () => {
    for (const [region, ids] of Object.entries(REGIONS)) {
      for (const id of ids) {
        assert.ok(DEPARTEMENTS[id], `${region} : identifiant ${id} absent de DEPARTEMENTS`);
      }
    }
  });

  test("les Pays de la Loire correspondent bien à 44, 49, 53, 72 et 85", () => {
    const codes = REGIONS["Pays de la Loire"].map((id) => DEPARTEMENTS[id].code);
    assert.deepEqual(codes.sort(), ["44", "49", "53", "72", "85"]);
  });

  test("aucun département n'appartient à deux régions", () => {
    const vus = new Map();
    for (const [region, ids] of Object.entries(REGIONS)) {
      for (const id of ids) {
        // 988 apparaît deux fois côté ffta.fr, mais dans la même région
        if (vus.has(id)) assert.equal(vus.get(id), region, `identifiant ${id} dans deux régions`);
        vus.set(id, region);
      }
    }
  });
});

describe("departementDe — depuis un code postal", () => {
  test("métropole", () => {
    assert.deepEqual(departementDe({ codePostal: "44330" }), { code: "44", nom: "Loire-Atlantique" });
    assert.equal(departementDe({ codePostal: "85710" }).code, "85");
    assert.equal(departementDe({ codePostal: "01090" }).code, "01");
  });

  test("Corse : 2A en dessous de 20200, 2B au-dessus", () => {
    assert.equal(departementDe({ codePostal: "20190" }).code, "2A");
    assert.equal(departementDe({ codePostal: "20250" }).code, "2B");
  });

  test("outre-mer sur trois chiffres", () => {
    assert.equal(departementDe({ codePostal: "97400" }).code, "974");
    assert.equal(departementDe({ codePostal: "97110" }).code, "971");
  });
});

describe("departementDe — depuis le libellé d'un comité", () => {
  test("libellés réellement rencontrés sur ffta.fr", () => {
    assert.equal(departementDe({ comite: "COMITE DEPARTEMENTAL LOIRE ATLANTIQUE" }).code, "44");
    assert.equal(departementDe({ comite: "COMITE DEPARTEMENTAL DE VENDEE" }).code, "85");
    assert.equal(departementDe({ comite: "COMITE DEPARTEMENTAL SARTHE" }).code, "72");
    assert.equal(departementDe({ comite: "COMITE DEPARTEMENTAL AIN" }).code, "01");
  });

  test("le code postal a la priorité sur le comité", () => {
    const d = departementDe({ codePostal: "85710", comite: "COMITE DEPARTEMENTAL SARTHE" });
    assert.equal(d.code, "85");
  });

  test("rien de reconnaissable : null plutôt qu'une valeur fausse", () => {
    assert.equal(departementDe({ comite: "COMITE DEPARTEMENTAL DE NULLE PART" }), null);
    assert.equal(departementDe({}), null);
  });
});

describe("disciplineDe", () => {
  test("discipline courante", () => {
    const d = disciplineDe("Tir à 18m");
    assert.equal(d.code, "salle");
    assert.equal(d.id, 103);
    assert.equal(d.para, false);
  });

  test("le para est reconnu et la discipline de base conservée", () => {
    const d = disciplineDe("Para-tir à l'arc à 18m");
    assert.equal(d.code, "salle", "même code que le 18m non para");
    assert.equal(d.para, true);
    assert.equal(d.base, "Tir à 18m");
  });

  test("para extérieur", () => {
    const d = disciplineDe("Para-tir à l'arc en extérieur");
    assert.equal(d.code, "tae");
    assert.equal(d.para, true);
  });

  test("libellé inconnu : le para est quand même détecté", () => {
    const d = disciplineDe("Para-tir à l'arc en salle sur cible mouvante");
    assert.equal(d.para, true);
    assert.equal(d.id, null);
  });

  test("valeur absente", () => assert.equal(disciplineDe(null), null));

  test("toutes les disciplines de la table ont un code et un identifiant", () => {
    for (const [nom, d] of Object.entries(DISCIPLINES)) {
      assert.ok(d.code, `${nom} sans code`);
      assert.ok(Number.isInteger(d.id), `${nom} sans identifiant`);
      assert.equal(typeof d.para, "boolean", `${nom} sans indicateur para`);
    }
  });
});

describe("estInterne", () => {
  test("titres réellement rencontrés", () => {
    assert.ok(estInterne({ titre: "CONCOURS INTERNE LOISIR à LE MANS" }));
    assert.ok(estInterne({ titre: "TIR DE NOEL INTERNE" }));
    assert.ok(estInterne({ titre: "TIR DES CITROUILLES - INTERNE à LE MANS" }));
  });

  test("un concours ouvert n'est pas écarté", () => {
    assert.equal(estInterne({ titre: "CONCOURS 3D à VALLET" }), false);
    assert.equal(estInterne({ titre: "CHAMPIONNAT REGIONAL BEURSAULT" }), false);
  });

  test("« international » ne doit pas être confondu avec « interne »", () => {
    assert.equal(estInterne({ titre: "TOURNOI INTERNATIONAL DE NANTES" }), false);
  });

  test("titre absent", () => assert.equal(estInterne({}), false));
});
