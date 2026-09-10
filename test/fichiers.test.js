// Tests des fonctions qui touchent au disque et au réseau, dans un dossier temporaire
// et avec un fetch simulé : aucun appel réel n'est fait vers ffta.fr.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeOutputs, chargerPrecedent } from "../src/output.js";
import { archiver, listerSnapshots, chargerSnapshot } from "../src/historique.js";
import { downloadMandat } from "../src/mandat.js";

let tmp;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scrfta-test-"));
});
after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const concours = (id, over = {}) => ({
  id,
  titre: `CONCOURS ${id}`,
  dates_texte: "Le 17 octobre 2026",
  date_debut: "2026-10-17",
  date_fin: "2026-10-17",
  discipline: "Tir à 18m",
  organisateur: "CLUB DE TEST",
  url: `https://www.ffta.fr/epreuve/${id}`,
  detail: { statut: "Validée", champs: {}, adresse: [], contacts: {} },
  ...over,
});

describe("écriture des sorties", () => {
  let dossier;
  beforeEach(async () => {
    dossier = await fs.mkdtemp(path.join(tmp, "out-"));
  });

  test("les deux fichiers sont écrits", async () => {
    const r = await writeOutputs(dossier, { filtres: {} }, [concours("1"), concours("2")]);
    assert.equal(path.basename(r.jsonFile), "competitions.json");
    assert.equal(path.basename(r.csvFile), "competitions.csv");
    await fs.access(r.jsonFile);
    await fs.access(r.csvFile);
  });

  test("le JSON contient les métadonnées et la date de génération", async () => {
    const r = await writeOutputs(dossier, { filtres: { regions: ["Bretagne"] } }, [concours("1")]);
    const data = JSON.parse(await fs.readFile(r.jsonFile, "utf8"));
    assert.equal(data.nb, 1);
    assert.deepEqual(data.filtres.regions, ["Bretagne"]);
    assert.match(data.genere_le, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(data.competitions.length, 1);
  });

  test("le CSV commence par la marque d'ordre des octets, pour qu'Excel lise les accents", async () => {
    const r = await writeOutputs(dossier, {}, [concours("1")]);
    const csv = await fs.readFile(r.csvFile, "utf8");
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.match(csv.slice(1), /^id;titre;/);
  });

  test("le CSV se termine par des fins de ligne Windows", async () => {
    const r = await writeOutputs(dossier, {}, [concours("1")]);
    const csv = await fs.readFile(r.csvFile, "utf8");
    assert.ok(csv.includes("\r\n"));
  });
});

describe("chargement du relevé précédent", () => {
  test("dossier sans export : une carte vide plutôt qu'une erreur", async () => {
    const vide = await fs.mkdtemp(path.join(tmp, "vide-"));
    const m = await chargerPrecedent(vide);
    assert.equal(m.size, 0);
  });

  test("export existant : indexé par identifiant", async () => {
    const dossier = await fs.mkdtemp(path.join(tmp, "prec-"));
    await writeOutputs(dossier, {}, [concours("100"), concours("200")]);
    const m = await chargerPrecedent(dossier);
    assert.equal(m.size, 2);
    assert.equal(m.get("100").titre, "CONCOURS 100");
  });

  test("fichier illisible : une carte vide plutôt qu'une erreur", async () => {
    const dossier = await fs.mkdtemp(path.join(tmp, "casse-"));
    await fs.writeFile(path.join(dossier, "competitions.json"), "{ ceci n'est pas du json");
    const m = await chargerPrecedent(dossier);
    assert.equal(m.size, 0);
  });
});

describe("historique des relevés", () => {
  let dossier;
  beforeEach(async () => {
    dossier = await fs.mkdtemp(path.join(tmp, "hist-"));
    await writeOutputs(dossier, {}, [concours("1"), concours("2")]);
  });

  test("un relevé est archivé sous sa date", async () => {
    const f = await archiver(dossier, new Date("2026-09-10T08:00:00Z"));
    assert.equal(path.basename(f), "2026-09-10.json");
    const contenu = JSON.parse(await fs.readFile(f, "utf8"));
    assert.equal(contenu.competitions.length, 2);
  });

  test("deux relevés le même jour : le dernier remplace le premier", async () => {
    await archiver(dossier, new Date("2026-09-10T08:00:00Z"));
    await writeOutputs(dossier, {}, [concours("1")]);
    await archiver(dossier, new Date("2026-09-10T18:00:00Z"));

    const l = await listerSnapshots(dossier);
    assert.equal(l.length, 1);
    assert.equal((await chargerSnapshot(l[0].fichier)).length, 1);
  });

  test("les relevés sont listés du plus ancien au plus récent", async () => {
    await archiver(dossier, new Date("2026-09-17T08:00:00Z"));
    await archiver(dossier, new Date("2026-09-03T08:00:00Z"));
    await archiver(dossier, new Date("2026-09-10T08:00:00Z"));

    const dates = (await listerSnapshots(dossier)).map((s) => s.date);
    assert.deepEqual(dates, ["2026-09-03", "2026-09-10", "2026-09-17"]);
  });

  test("les fichiers qui ne sont pas des relevés sont ignorés", async () => {
    await archiver(dossier, new Date("2026-09-10T08:00:00Z"));
    await fs.writeFile(path.join(dossier, "historique", "notes.txt"), "à ignorer");
    await fs.writeFile(path.join(dossier, "historique", "brouillon.json"), "{}");

    const l = await listerSnapshots(dossier);
    assert.deepEqual(l.map((s) => s.date), ["2026-09-10"]);
  });

  test("aucun historique : une liste vide plutôt qu'une erreur", async () => {
    const vide = await fs.mkdtemp(path.join(tmp, "sanshist-"));
    assert.deepEqual(await listerSnapshots(vide), []);
  });
});

describe("téléchargement d'un mandat", () => {
  const URL_PDF = "https://extranet.ffta.fr/medias/documents_epreuves/abcdef.pdf";
  let dossier;
  let appels;
  let vraiFetch;

  /** Réponse HTTP simulée. */
  const reponse = (corps, { ok = true, type = "application/pdf", modifie = null } = {}) => ({
    ok,
    status: ok ? 200 : 404,
    headers: { get: (k) => ({ "content-type": type, "last-modified": modifie })[k.toLowerCase()] ?? null },
    arrayBuffer: async () => new TextEncoder().encode(corps).buffer,
  });

  before(() => {
    vraiFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = vraiFetch;
  });
  beforeEach(async () => {
    dossier = await fs.mkdtemp(path.join(tmp, "mandats-"));
    appels = [];
  });

  /** Installe un faux fetch qui enregistre les appels et renvoie toujours le même PDF. */
  function simuler(corps, modifie) {
    globalThis.fetch = async (url, opts = {}) => {
      appels.push(opts.method || "GET");
      return reponse(corps, { modifie });
    };
  }

  test("premier téléchargement : fichier écrit, empreinte et date enregistrées", async () => {
    simuler("%PDF-1.7 contenu", "Sun, 02 Aug 2026 17:24:39 GMT");
    const r = await downloadMandat(URL_PDF, dossier);

    assert.equal(path.basename(r.file), "abcdef.pdf");
    assert.equal(r.retelecharge, false);
    assert.equal(r.modifie_le, "2026-08-02T17:24:39.000Z");
    assert.match(r.hash, /^[0-9a-f]{40}$/);
    assert.equal(await fs.readFile(r.file, "utf8"), "%PDF-1.7 contenu");
    assert.deepEqual(appels, ["GET"]);
  });

  test("PDF inchangé : une requête HEAD, aucun téléchargement", async () => {
    const date = "Sun, 02 Aug 2026 17:24:39 GMT";
    simuler("%PDF-1.7 contenu", date);
    const premier = await downloadMandat(URL_PDF, dossier);

    appels = [];
    const second = await downloadMandat(URL_PDF, dossier);
    assert.deepEqual(appels, ["HEAD"], "le fichier ne doit pas être retéléchargé");
    assert.equal(second.retelecharge, false);
    assert.equal(second.hash, premier.hash);
  });

  test("PDF modifié sur le serveur : retéléchargé, nouvelle empreinte", async () => {
    simuler("%PDF-1.7 version 1", "Sun, 02 Aug 2026 17:24:39 GMT");
    const premier = await downloadMandat(URL_PDF, dossier);

    appels = [];
    simuler("%PDF-1.7 version 2 corrigée", "Mon, 07 Sep 2026 09:00:00 GMT");
    const second = await downloadMandat(URL_PDF, dossier);

    assert.deepEqual(appels, ["HEAD", "GET"]);
    assert.equal(second.retelecharge, true);
    assert.notEqual(second.hash, premier.hash);
    assert.equal(await fs.readFile(second.file, "utf8"), "%PDF-1.7 version 2 corrigée");
  });

  test("réponse qui n'est pas un PDF : erreur explicite", async () => {
    globalThis.fetch = async () => reponse("<html>Erreur</html>", { type: "text/html" });
    await assert.rejects(() => downloadMandat(URL_PDF, dossier), /Type inattendu/);
  });

  test("erreur HTTP : erreur explicite", async () => {
    globalThis.fetch = async () => reponse("", { ok: false });
    await assert.rejects(() => downloadMandat(URL_PDF, dossier), /HTTP 404/);
  });

  test("en-tête Last-Modified absent : le téléchargement fonctionne quand même", async () => {
    simuler("%PDF-1.7 sans date", null);
    const r = await downloadMandat(URL_PDF, dossier);
    assert.equal(r.modifie_le, null);
    assert.match(r.hash, /^[0-9a-f]{40}$/);
  });
});

describe("mandat téléchargé par une version antérieure du programme", () => {
  test("l'empreinte manquante est calculée et enregistrée sans retélécharger", async () => {
    const dossier = await fs.mkdtemp(path.join(tmp, "ancien-"));
    const pdf = path.join(dossier, "ancien.pdf");
    const meta = pdf + ".json";
    const date = "Sun, 02 Aug 2026 17:24:39 GMT";

    // Ce que produisait la version précédente : pas de champ « hash »
    await fs.writeFile(pdf, "%PDF-1.7 déjà téléchargé");
    await fs.writeFile(meta, JSON.stringify({ url: "x", modifie_le: "2026-08-02T17:24:39.000Z" }));

    const vrai = globalThis.fetch;
    const appels = [];
    globalThis.fetch = async (url, opts = {}) => {
      appels.push(opts.method || "GET");
      return {
        ok: true,
        headers: { get: (k) => (k.toLowerCase() === "last-modified" ? date : "application/pdf") },
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    try {
      const r = await downloadMandat("https://extranet.ffta.fr/medias/documents_epreuves/ancien.pdf", dossier);
      assert.deepEqual(appels, ["HEAD"], "aucun téléchargement : le PDF est inchangé");
      assert.match(r.hash, /^[0-9a-f]{40}$/, "l'empreinte est calculée depuis le fichier local");
      const relu = JSON.parse(await fs.readFile(meta, "utf8"));
      assert.equal(relu.hash, r.hash, "elle est enregistrée pour les fois suivantes");
    } finally {
      globalThis.fetch = vrai;
    }
  });
});
