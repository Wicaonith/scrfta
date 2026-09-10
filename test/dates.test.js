import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDates, parseDateFr, addDays } from "../src/dates.js";

describe("parseDates — les dates affichées par ffta.fr", () => {
  test("un seul jour", () => {
    assert.deepEqual(parseDates("Le 13 septembre 2026"), { debut: "2026-09-13", fin: "2026-09-13" });
  });

  test("deux jours dans le même mois", () => {
    assert.deepEqual(parseDates("Du 19 au 20 septembre 2026"), { debut: "2026-09-19", fin: "2026-09-20" });
  });

  test("à cheval sur deux mois", () => {
    assert.deepEqual(parseDates("Du 31 octobre au 01 novembre 2026"), { debut: "2026-10-31", fin: "2026-11-01" });
  });

  test("à cheval sur deux années", () => {
    assert.deepEqual(parseDates("Du 30 décembre 2026 au 2 janvier 2027"), { debut: "2026-12-30", fin: "2027-01-02" });
  });

  test("accents et casse indifférents", () => {
    assert.deepEqual(parseDates("LE 05 FÉVRIER 2027"), { debut: "2027-02-05", fin: "2027-02-05" });
    assert.deepEqual(parseDates("Le 05 fevrier 2027"), { debut: "2027-02-05", fin: "2027-02-05" });
    assert.deepEqual(parseDates("Le 12 août 2027"), { debut: "2027-08-12", fin: "2027-08-12" });
  });

  test("format inconnu ou vide : aucune date inventée", () => {
    assert.deepEqual(parseDates("Prochainement"), { debut: null, fin: null });
    assert.deepEqual(parseDates(""), { debut: null, fin: null });
    assert.deepEqual(parseDates(null), { debut: null, fin: null });
  });
});

describe("parseDateFr — les dates trouvées dans le texte des mandats", () => {
  const ref = { debut: "2026-10-17", fin: "2026-10-18" };

  test("date numérique complète", () => {
    assert.equal(parseDateFr("avant le 07/10/2026", ref).date, "2026-10-07");
    assert.equal(parseDateFr("avant le 07/10/26", ref).date, "2026-10-07");
  });

  test("date numérique sans année : année déduite du concours", () => {
    assert.equal(parseDateFr("DEPART 2 - 19/09", { debut: "2026-09-19", fin: "2026-09-20" }).date, "2026-09-19");
  });

  test("date en toutes lettres, avec ou sans année", () => {
    assert.equal(parseDateFr("Vendredi 09 octobre 2026", ref).date, "2026-10-09");
    assert.equal(parseDateFr("le 1er mars", { debut: "2027-03-07" }).date, "2027-03-01");
  });

  test("jour de la semaine seul : résolu dans la période du concours", () => {
    // 17 octobre 2026 est un samedi, 18 un dimanche
    assert.equal(parseDateFr("Samedi après-midi", ref).date, "2026-10-17");
    assert.equal(parseDateFr("Dimanche matin", ref).date, "2026-10-18");
  });

  test("date limite sans année postérieure au concours : année précédente", () => {
    // « avant le 20 décembre » pour un concours de janvier 2027 = décembre 2026
    const janvier = { debut: "2027-01-10", fin: "2027-01-10", limite: true };
    assert.equal(parseDateFr("avant le 20 décembre", janvier).date, "2026-12-20");
  });

  test("heure extraite quand elle est présente", () => {
    assert.deepEqual(parseDateFr("avant le jeudi 22 octobre 12h", ref), { date: "2026-10-22", heure: "12:00" });
    assert.equal(parseDateFr("le 22 octobre à 9h30", ref).heure, "09:30");
    assert.equal(parseDateFr("le 22 octobre 2026", ref).heure, null);
  });

  test("texte sans date : rien n'est inventé", () => {
    assert.deepEqual(parseDateFr("à confirmer par courrier", ref), { date: null, heure: null });
  });
});

describe("addDays", () => {
  test("avance d'un jour", () => assert.equal(addDays("2026-10-17", 1), "2026-10-18"));
  test("change de mois", () => assert.equal(addDays("2026-10-31", 1), "2026-11-01"));
  test("change d'année", () => assert.equal(addDays("2026-12-31", 1), "2027-01-01"));
  test("recule", () => assert.equal(addDays("2026-01-01", -1), "2025-12-31"));
  test("année bissextile", () => assert.equal(addDays("2028-02-28", 1), "2028-02-29"));
});
