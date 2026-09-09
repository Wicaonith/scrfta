import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { departementDe, disciplineDe } from "./config.js";

/** Charge l'export précédent (pour le suivi des modifications) ; vide s'il n'existe pas. */
export async function chargerPrecedent(outDir) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(outDir, "competitions.json"), "utf8"));
    return new Map((data.competitions || []).map((c) => [String(c.id), c]));
  } catch {
    return new Map();
  }
}

/**
 * Complète chaque compétition : département, discipline structurée, date_fin garantie,
 * empreinte de la fiche et dates de suivi (epreuve_vue_le : première apparition,
 * epreuve_maj_le : dernière modification constatée de la fiche fédérale).
 */
export function completerCompetitions(competitions, precedent = new Map(), maintenant = new Date().toISOString()) {
  for (const c of competitions) {
    completerDepartement(c);
    c.discipline_info = disciplineDe(c.discipline);
    if (c.date_debut && !c.date_fin) c.date_fin = c.date_debut;
    c.epreuve_hash = empreinte(c);
    const prev = precedent.get(String(c.id));
    c.epreuve_vue_le = prev?.epreuve_vue_le || maintenant;
    c.epreuve_maj_le = prev && prev.epreuve_hash === c.epreuve_hash ? prev.epreuve_maj_le || prev.epreuve_vue_le || maintenant : maintenant;
  }
  return competitions;
}

/** Empreinte du contenu de la fiche fédérale (hors données dérivées et mandat analysé). */
function empreinte(c) {
  const d = c.detail || {};
  const base = {
    titre: c.titre, dates: c.dates_texte, statut: d.statut || c.statut, discipline: c.discipline, type: c.type,
    organisateur: c.organisateur, ville: c.ville, email: c.email, site: c.site, mandat_url: c.mandat_url,
    champs: d.champs, adresse: d.adresse, contacts: d.contacts, documents: d.documents,
  };
  return crypto.createHash("sha1").update(JSON.stringify(base)).digest("hex").slice(0, 16);
}

/** Écrit competitions.json et competitions.csv dans outDir. */
export async function writeOutputs(outDir, meta, competitions) {
  const jsonFile = await writeSafe(
    path.join(outDir, "competitions.json"),
    JSON.stringify({ ...meta, genere_le: new Date().toISOString(), nb: competitions.length, competitions }, null, 2)
  );
  const csvFile = await writeSafe(path.join(outDir, "competitions.csv"), "﻿" + toCsv(competitions));
  return { jsonFile, csvFile };
}

/** Écrit le fichier ; s'il est verrouillé (ouvert dans Excel...), écrit une copie horodatée à côté. */
async function writeSafe(file, content) {
  try {
    await fs.writeFile(file, content);
    return file;
  } catch (e) {
    if (e.code !== "EBUSY" && e.code !== "EPERM") throw e;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const alt = file.replace(/(\.\w+)$/, `.${stamp}$1`);
    await fs.writeFile(alt, content);
    console.error(`  ! ${path.basename(file)} est verrouillé (ouvert dans une autre application ?) : écrit dans ${path.basename(alt)}`);
    return alt;
  }
}

const join = (arr, sep = " | ") => (Array.isArray(arr) && arr.length ? arr.join(sep) : "");

/** Résumé des tarifs : adulte / jeune par nombre de départs. */
function tarifsResume(c) {
  const grille = c.mandat?.infos?.tarifs?.grille;
  if (grille?.length) {
    return grille.map((t) => `${t.nb_departs} départ${t.nb_departs > 1 ? "s" : ""} : adulte ${t.adulte ?? "?"} € / jeune ${t.jeune ?? "?"} €`).join(" | ");
  }
  const tab = c.mandat?.infos?.tarifs?.tableaux;
  if (tab?.length) {
    return tab
      .map((t) =>
        Object.entries(t)
          .filter(([k]) => k !== "categorie")
          .map(([k, v]) => `${t.categorie} ${k} : ${v} €`)
          .join(" | ")
      )
      .join(" | ");
  }
  return join(c.mandat?.infos?.tarifs?.lignes);
}

/** Départs de l'épreuve : ceux du mandat qui tombent dans ses dates (tous si aucun ne correspond). */
export function departsEpreuve(c) {
  const all = c.mandat?.infos?.departs || [];
  const dedans = all.filter((d) => !d.hors_epreuve);
  return dedans.length ? dedans : all;
}

/** Tarifs structurés : [{ departs, public, montant_cents }]. */
export function tarifsJson(c) {
  const grille = c.mandat?.infos?.tarifs?.grille || [];
  const out = [];
  for (const t of grille) {
    if (t.adulte !== null) out.push({ departs: t.nb_departs, public: "adulte", montant_cents: Math.round(t.adulte * 100) });
    if (t.jeune !== null) out.push({ departs: t.nb_departs, public: "jeune", montant_cents: Math.round(t.jeune * 100) });
  }
  return out;
}

/** Départs structurés : [{ nom, debut, greffe, echauffement, tirs, places, cibles }]. */
export function departsJson(c) {
  return departsEpreuve(c).map((d) => ({
    nom: d.nom,
    debut: d.datetime,
    greffe: d.heure_greffe,
    echauffement: d.heure_echauffement,
    tirs: d.heure_debut_tirs,
    places: d.jauge ?? null,
    cibles: d.cibles ?? null,
  }));
}

const ouiNon = (v) => (v === true ? "oui" : v === false ? "non" : "");

function departsResume(c) {
  const departs = departsEpreuve(c);
  if (departs?.length) {
    return departs
      .map((d) => `${d.nom}${d.date ? " " + d.date : ""}${d.heure_debut ? " " + d.heure_debut : ""}${d.jauge ? " (" + d.jauge + " pl.)" : ""}`)
      .join(" | ");
  }
  return join(c.mandat?.infos?.horaires);
}

export function toCsv(rows) {
  const cols = [
    ["id", (c) => c.id],
    ["titre", (c) => c.titre],
    ["date_debut", (c) => c.date_debut],
    ["date_fin", (c) => c.date_fin],
    ["dates_texte", (c) => c.dates_texte],
    ["statut", (c) => c.detail?.statut || c.statut],
    ["discipline", (c) => c.detail?.champs?.discipline || c.discipline],
    ["discipline_code", (c) => c.discipline_info?.code],
    ["discipline_id", (c) => c.discipline_info?.id],
    ["discipline_base", (c) => c.discipline_info?.base],
    ["para", (c) => ouiNon(c.discipline_info?.para)],
    ["championnat", (c) => c.detail?.champs?.championnat],
    ["type", (c) => c.type],
    ["duels", (c) => c.detail?.champs?.duels],
    ["organisateur", (c) => c.organisateur],
    ["departement", (c) => c.departement?.code],
    ["departement_nom", (c) => c.departement?.nom],
    ["ville", (c) => c.ville],
    ["lieu", (c) => c.detail?.champs?.lieu],
    ["adresse", (c) => c.detail?.adresse?.join(", ")],
    ["comite_regional", (c) => c.detail?.champs?.comite_regional],
    ["comite_departemental", (c) => c.detail?.champs?.comite_departemental],
    ["email", (c) => c.email || c.detail?.contacts?.mail],
    ["telephone", (c) => c.detail?.contacts?.tel],
    ["site", (c) => c.site || c.detail?.contacts?.site],
    ["url", (c) => c.url],
    ["epreuve_vue_le", (c) => c.epreuve_vue_le],
    ["epreuve_maj_le", (c) => c.epreuve_maj_le],
    ["epreuve_hash", (c) => c.epreuve_hash],
    ["mandat_url", (c) => c.mandat_url],
    ["mandat_fichier", (c) => c.mandat?.fichier],
    ["mandat_modifie_le", (c) => c.mandat?.modifie_le],
    ["mandat_ocr", (c) => (c.mandat ? ouiNon(!!c.mandat.ocr) : "")],
    ["mandat_departs", departsResume],
    ["mandat_departs_json", (c) => (c.mandat ? JSON.stringify(departsJson(c)) : "")],
    ["mandat_departs_fiable", (c) => (c.mandat ? ouiNon(!!c.mandat.infos?.departs_fiable) : "")],
    ["mandat_nb_departs", (c) => departsEpreuve(c).length || ""],
    ["mandat_depart1_datetime", (c) => departsEpreuve(c)[0]?.datetime],
    ["mandat_jauge", (c) => c.mandat?.infos?.jauge?.places],
    ["mandat_cibles", (c) => c.mandat?.infos?.jauge?.cibles],
    ["mandat_tarifs", tarifsResume],
    ["mandat_tarifs_json", (c) => (c.mandat ? JSON.stringify(tarifsJson(c)) : "")],
    ["mandat_tarifs_fiable", (c) => (c.mandat ? ouiNon(!!c.mandat.infos?.tarifs?.fiable) : "")],
    ["mandat_inscription_mode", (c) => c.mandat?.infos?.inscription?.mode],
    ["mandat_inscription_url", (c) => join(c.mandat?.infos?.inscription?.urls)],
    ["mandat_inscription_email", (c) => join(c.mandat?.infos?.inscription?.emails)],
    ["mandat_date_limite_iso", (c) => c.mandat?.infos?.date_limite_iso],
    ["mandat_date_limite", (c) => c.mandat?.infos?.date_limite_inscription],
    ["mandat_distances", (c) => join(c.mandat?.infos?.distances)],
    ["mandat_blasons", (c) => join(c.mandat?.infos?.blasons)],
    ["mandat_arbitres", (c) => c.mandat?.infos?.arbitres],
    ["mandat_buvette", (c) => (c.mandat ? (c.mandat.infos?.buvette ? "oui" : "non") : "")],
    ["mandat_emails", (c) => join(c.mandat?.infos?.emails)],
    ["mandat_telephones", (c) => join(c.mandat?.infos?.telephones)],
  ];
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => c[0]).join(";")];
  for (const r of rows) lines.push(cols.map(([, f]) => esc(f(r))).join(";"));
  return lines.join("\r\n");
}

/** Renseigne c.departement = { code, nom } à partir de l'adresse (code postal) ou du comité départemental. */
export function completerDepartement(c) {
  const adresse = (c.detail?.adresse || []).join(" ");
  const cp = adresse.match(/\b(\d{5})\b/);
  let dep = cp ? departementDe({ codePostal: cp[1] }) : null;
  if (!dep) dep = departementDe({ comite: c.detail?.champs?.comite_departemental });
  c.departement = dep;
  return c;
}
