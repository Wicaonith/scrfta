import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toCsv, tarifsJson, departsJson, departsEpreuve, regrouperConcours, completerCompetitions, completerDepartement } from "../src/output.js";

/** Compétition minimale, complétée par les champs passés en paramètre. */
function concours(over = {}) {
  const { detail, mandat, ...reste } = over;
  return {
    id: "1000",
    titre: "CONCOURS DE TEST",
    dates_texte: "Le 17 octobre 2026",
    date_debut: "2026-10-17",
    date_fin: "2026-10-17",
    discipline: "Tir à 18m",
    organisateur: "CLUB DE TEST",
    ville: "TESTVILLE",
    url: "https://www.ffta.fr/epreuve/1000",
    detail: { statut: "Validée", champs: { lieu: "TESTVILLE" }, adresse: ["44000 TESTVILLE"], contacts: {}, ...detail },
    ...(mandat ? { mandat } : {}),
    ...reste,
  };
}

const mandatType = {
  fichier: "mandats/test.pdf",
  hash: "abc123",
  infos: {
    tarifs: { grille: [{ nb_departs: 1, adulte: 9, jeune: 7 }, { nb_departs: 2, adulte: 16, jeune: 12 }], tableaux: [], lignes: [], fiable: true },
    departs: [
      { nom: "Départ 1", date: "2026-10-17", heure_greffe: "08:00", heure_echauffement: "08:30", heure_debut_tirs: "09:00", heure_debut: "08:00", datetime: "2026-10-17T08:00", jauge: 48, cibles: null },
      { nom: "Départ 2", date: "2026-10-18", heure_greffe: "13:00", heure_echauffement: null, heure_debut_tirs: null, heure_debut: "13:00", datetime: "2026-10-18T13:00", jauge: 48, cibles: null, hors_epreuve: true },
    ],
    jauge: { places: 48, cibles: null },
    date_limite_iso: "2026-10-12",
    inscription: { mode: "mail", urls: [], emails: [] },
  },
};

describe("tarifsJson : montants en centimes, un objet par public", () => {
  test("grille complète", () => {
    assert.deepEqual(tarifsJson(concours({ mandat: mandatType })), [
      { departs: 1, public: "adulte", montant_cents: 900 },
      { departs: 1, public: "jeune", montant_cents: 700 },
      { departs: 2, public: "adulte", montant_cents: 1600 },
      { departs: 2, public: "jeune", montant_cents: 1200 },
    ]);
  });

  test("un tarif jeune absent n'invente pas de ligne", () => {
    const m = { ...mandatType, infos: { ...mandatType.infos, tarifs: { grille: [{ nb_departs: 1, adulte: 9, jeune: null }] } } };
    assert.deepEqual(tarifsJson(concours({ mandat: m })), [{ departs: 1, public: "adulte", montant_cents: 900 }]);
  });

  test("les centimes sont exacts", () => {
    const m = { ...mandatType, infos: { ...mandatType.infos, tarifs: { grille: [{ nb_departs: 1, adulte: 12.5, jeune: 7.1 }] } } };
    assert.deepEqual(tarifsJson(concours({ mandat: m })).map((t) => t.montant_cents), [1250, 710]);
  });

  test("sans mandat, aucune donnée", () => assert.deepEqual(tarifsJson(concours()), []));
});

describe("départs de l'épreuve", () => {
  test("les départs hors des dates de l'épreuve sont écartés", () => {
    const d = departsEpreuve(concours({ mandat: mandatType }));
    assert.equal(d.length, 1);
    assert.equal(d[0].nom, "Départ 1");
  });

  test("si aucun départ ne tombe dans l'épreuve, on les garde tous plutôt que de ne rien afficher", () => {
    const m = { ...mandatType, infos: { ...mandatType.infos, departs: mandatType.infos.departs.map((d) => ({ ...d, hors_epreuve: true })) } };
    assert.equal(departsEpreuve(concours({ mandat: m })).length, 2);
  });

  test("departsJson expose les champs attendus par un import", () => {
    assert.deepEqual(departsJson(concours({ mandat: mandatType })), [
      { nom: "Départ 1", debut: "2026-10-17T08:00", greffe: "08:00", echauffement: "08:30", tirs: "09:00", places: 48, cibles: null },
    ]);
  });
});

describe("toCsv", () => {
  const ligne = (csv, n) => csv.split("\r\n")[n];

  test("en-tête et nombre de colonnes constants", () => {
    const csv = toCsv([concours(), concours({ id: "1001" })]);
    const entete = ligne(csv, 0).split(";");
    assert.ok(entete.includes("id"));
    assert.ok(entete.includes("concours_id"));
    assert.ok(entete.includes("mandat_tarifs_json"));
    assert.equal(ligne(csv, 1).split(";").length, entete.length);
    assert.equal(csv.split("\r\n").length, 3, "une ligne d'en-tête et deux de données");
  });

  test("un point-virgule dans une valeur est protégé par des guillemets", () => {
    const csv = toCsv([concours({ titre: "CONCOURS ; PIÈGE" })]);
    assert.match(ligne(csv, 1), /"CONCOURS ; PIÈGE"/);
  });

  test("les guillemets sont doublés", () => {
    const csv = toCsv([concours({ titre: 'LE "GRAND" CONCOURS' })]);
    assert.match(ligne(csv, 1), /"LE ""GRAND"" CONCOURS"/);
  });

  test("un retour à la ligne interne reste dans la cellule et ne crée pas d'enregistrement", () => {
    const csv = toCsv([concours({ titre: "DEUX\nLIGNES" })]);
    assert.equal(csv.split("\r\n").length, 2, "une ligne d'en-tête et une seule ligne de données");
    assert.match(csv, /"DEUX\nLIGNES"/, "la valeur est entre guillemets");
  });

  test("une valeur absente donne une cellule vide, jamais « undefined »", () => {
    const csv = toCsv([concours()]);
    assert.equal(csv.includes("undefined"), false);
    assert.equal(csv.includes("null"), false);
  });
});

describe("completerDepartement", () => {
  test("depuis le code postal de l'adresse", () => {
    const c = completerDepartement(concours({ detail: { adresse: ["Salle des sports", "85710 LA GARNACHE"] } }));
    assert.equal(c.departement.code, "85");
  });

  test("à défaut, depuis le comité départemental", () => {
    const c = completerDepartement(concours({ detail: { adresse: [], champs: { comite_departemental: "COMITE DEPARTEMENTAL SARTHE" } } }));
    assert.equal(c.departement.code, "72");
  });
});

describe("regrouperConcours", () => {
  test("deux épreuves du même club, même lieu et mêmes dates forment un seul concours", () => {
    const l = [
      concours({ id: "100", discipline: "Tir à 18m" }),
      concours({ id: "101", discipline: "Para-tir à l'arc à 18m" }),
    ];
    regrouperConcours(l);
    assert.equal(l[0].concours.id, "100");
    assert.equal(l[1].concours.id, "100");
    assert.equal(l[0].concours.nb_epreuves, 2);
  });

  test("deux épreuves partageant le même PDF sont regroupées, même à des dates différentes", () => {
    const l = [
      concours({ id: "200", dates_texte: "Le 03 octobre 2026", date_debut: "2026-10-03", date_fin: "2026-10-03", mandat: { ...mandatType, hash: "weekend" } }),
      concours({ id: "201", dates_texte: "Le 04 octobre 2026", date_debut: "2026-10-04", date_fin: "2026-10-04", mandat: { ...mandatType, hash: "weekend" } }),
    ];
    regrouperConcours(l);
    assert.equal(l[0].concours.id, l[1].concours.id);
    assert.equal(l[0].concours.nb_epreuves, 2);
  });

  test("des concours sans rapport restent séparés", () => {
    const l = [concours({ id: "300" }), concours({ id: "301", organisateur: "AUTRE CLUB", detail: { champs: { lieu: "AILLEURS" } } })];
    regrouperConcours(l);
    assert.notEqual(l[0].concours.id, l[1].concours.id);
    assert.equal(l[0].concours.nb_epreuves, 1);
  });

  test("chaque départ indique les épreuves auxquelles il appartient", () => {
    const l = [
      concours({ id: "400", date_debut: "2026-10-17", date_fin: "2026-10-17", mandat: mandatType }),
      concours({ id: "401", date_debut: "2026-10-18", date_fin: "2026-10-18", dates_texte: "Le 18 octobre 2026", mandat: mandatType }),
    ];
    regrouperConcours(l);
    const departs = l[0].concours.departs;
    assert.equal(departs.length, 2, "les départs des deux épreuves sont réunis");
    assert.deepEqual(departs[0].epreuves, ["400"]);
    assert.deepEqual(departs[1].epreuves, ["401"]);
  });
});

describe("completerCompetitions — suivi des modifications", () => {
  const T1 = "2026-01-01T00:00:00.000Z";
  const T2 = "2026-02-01T00:00:00.000Z";

  test("une épreuve inconnue est datée du relevé courant", () => {
    const l = [concours({ id: "500" })];
    completerCompetitions(l, new Map(), T1);
    assert.equal(l[0].epreuve_vue_le, T1);
    assert.equal(l[0].epreuve_maj_le, T1);
    assert.ok(l[0].epreuve_hash);
  });

  test("une fiche inchangée conserve sa date de modification", () => {
    const premier = [concours({ id: "500" })];
    completerCompetitions(premier, new Map(), T1);
    const precedent = new Map([["500", premier[0]]]);

    const second = [concours({ id: "500" })];
    completerCompetitions(second, precedent, T2);
    assert.equal(second[0].epreuve_vue_le, T1, "la première apparition ne bouge pas");
    assert.equal(second[0].epreuve_maj_le, T1, "rien n'a changé, la date de modification non plus");
  });

  test("une fiche modifiée est redatée", () => {
    const premier = [concours({ id: "500" })];
    completerCompetitions(premier, new Map(), T1);
    const precedent = new Map([["500", premier[0]]]);

    const second = [concours({ id: "500", titre: "TITRE MODIFIÉ" })];
    completerCompetitions(second, precedent, T2);
    assert.equal(second[0].epreuve_vue_le, T1);
    assert.equal(second[0].epreuve_maj_le, T2);
    assert.notEqual(second[0].epreuve_hash, premier[0].epreuve_hash);
  });

  test("date_fin vaut date_debut pour un concours d'un jour", () => {
    const l = [concours({ date_debut: "2026-10-17", date_fin: undefined })];
    completerCompetitions(l, new Map(), T1);
    assert.equal(l[0].date_fin, "2026-10-17");
  });

  test("la discipline est structurée au passage", () => {
    const l = [concours({ discipline: "Para-tir à l'arc à 18m" })];
    completerCompetitions(l, new Map(), T1);
    assert.equal(l[0].discipline_info.para, true);
    assert.equal(l[0].discipline_info.code, "salle");
  });
});

describe("colonnes de repli quand la grille n'a pas pu être normalisée", () => {
  test("les tableaux bruts prennent le relais pour les tarifs", () => {
    const m = {
      fichier: "mandats/x.pdf",
      infos: {
        tarifs: { grille: [], tableaux: [{ categorie: "Adultes", "1 tir": 9 }], lignes: [], fiable: false },
        departs: [],
        jauge: { places: null, cibles: null },
        inscription: { mode: null, urls: [], emails: [] },
      },
    };
    const csv = toCsv([concours({ mandat: m })]);
    const i = csv.split("\r\n")[0].split(";").indexOf("mandat_tarifs");
    assert.match(csv.split("\r\n")[1].split(";")[i], /Adultes 1 tir : 9 €/);
  });

  test("les lignes brutes prennent le relais si aucun tableau n'a été reconstitué", () => {
    const m = {
      fichier: "mandats/x.pdf",
      infos: {
        tarifs: { grille: [], tableaux: [], lignes: ["Adulte : 13 € par départ"], fiable: false },
        departs: [],
        jauge: { places: null, cibles: null },
        inscription: { mode: null, urls: [], emails: [] },
      },
    };
    const csv = toCsv([concours({ mandat: m })]);
    assert.match(csv, /Adulte : 13 € par départ/);
  });

  test("les horaires bruts prennent le relais si aucun départ n'a été reconstitué", () => {
    const m = {
      fichier: "mandats/x.pdf",
      infos: {
        tarifs: { grille: [], tableaux: [], lignes: [] },
        departs: [],
        horaires: ["Ouverture du greffe 7 h 30", "Début des tirs 9 h"],
        jauge: { places: null, cibles: null },
        inscription: { mode: null, urls: [], emails: [] },
      },
    };
    const csv = toCsv([concours({ mandat: m })]);
    const i = csv.split("\r\n")[0].split(";").indexOf("mandat_departs");
    assert.match(csv.split("\r\n")[1].split(";")[i], /Ouverture du greffe 7 h 30/);
  });
});

describe("tarifs avec supplément par départ", () => {
  test("la colonne lisible rappelle la règle du supplément", () => {
    const m = {
      fichier: "mandats/x.pdf",
      infos: {
        tarifs: { grille: [{ nb_departs: 1, adulte: 9, jeune: 7 }], tableaux: [], lignes: [], supplement: { adulte: 6, jeune: 4 } },
        departs: [],
        jauge: { places: null, cibles: null },
        inscription: { mode: null, urls: [], emails: [] },
      },
    };
    const csv = toCsv([concours({ mandat: m })]);
    assert.match(csv, /1 départ : adulte 9 € \/ jeune 7 € \| départ supplémentaire : adulte \+6 € \/ jeune \+4 €/);
  });
});
