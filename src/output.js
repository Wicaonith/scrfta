import fs from "node:fs/promises";
import path from "node:path";

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

/** Résumé d'un tarif : adulte / jeune par nombre de départs. */
function tarifsResume(c) {
  const llm = c.mandat?.llm?.tarifs;
  if (llm?.length) {
    return llm.map((t) => `${t.nb_departs} départ${t.nb_departs > 1 ? "s" : ""} : adulte ${t.adulte ?? "?"} € / jeune ${t.jeune ?? "?"} €`).join(" | ");
  }
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
  const all = c.mandat?.llm?.departs?.length ? c.mandat.llm.departs : c.mandat?.infos?.departs || [];
  const dedans = all.filter((d) => !d.hors_epreuve);
  return dedans.length ? dedans : all;
}

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
    ["championnat", (c) => c.detail?.champs?.championnat],
    ["type", (c) => c.type],
    ["duels", (c) => c.detail?.champs?.duels],
    ["organisateur", (c) => c.organisateur],
    ["ville", (c) => c.ville],
    ["lieu", (c) => c.detail?.champs?.lieu],
    ["adresse", (c) => c.detail?.adresse?.join(", ")],
    ["comite_regional", (c) => c.detail?.champs?.comite_regional],
    ["comite_departemental", (c) => c.detail?.champs?.comite_departemental],
    ["email", (c) => c.email || c.detail?.contacts?.mail],
    ["telephone", (c) => c.detail?.contacts?.tel],
    ["site", (c) => c.site || c.detail?.contacts?.site],
    ["url", (c) => c.url],
    ["mandat_url", (c) => c.mandat_url],
    ["mandat_fichier", (c) => c.mandat?.fichier],
    ["mandat_ocr", (c) => (c.mandat ? (c.mandat.ocr ? "oui" : "non") : "")],
    ["mandat_llm", (c) => (c.mandat?.llm ? "oui" : c.mandat?.llm_erreur ? "erreur" : "")],
    ["mandat_lieu", (c) => c.mandat?.llm?.lieu && [c.mandat.llm.lieu.nom, c.mandat.llm.lieu.adresse, c.mandat.llm.lieu.code_postal, c.mandat.llm.lieu.ville].filter(Boolean).join(", ")],
    ["mandat_departs", departsResume],
    ["mandat_nb_departs", (c) => departsEpreuve(c).length || ""],
    ["mandat_depart1_datetime", (c) => departsEpreuve(c)[0]?.datetime],
    ["mandat_jauge", (c) => c.mandat?.infos?.jauge?.places],
    ["mandat_cibles", (c) => c.mandat?.infos?.jauge?.cibles],
    ["mandat_tarifs", tarifsResume],
    ["mandat_autres_tarifs", (c) => join(c.mandat?.llm?.autres_tarifs)],
    ["mandat_inscription_mode", (c) => c.mandat?.llm?.inscription?.mode ?? c.mandat?.infos?.inscription?.mode],
    ["mandat_inscription_url", (c) => c.mandat?.llm?.inscription?.url ?? join(c.mandat?.infos?.inscription?.urls)],
    ["mandat_inscription_email", (c) => c.mandat?.llm?.inscription?.email ?? join(c.mandat?.infos?.inscription?.emails)],
    ["mandat_date_limite_iso", (c) => c.mandat?.llm?.inscription?.date_limite ?? c.mandat?.infos?.date_limite_iso],
    ["mandat_date_limite", (c) => c.mandat?.infos?.date_limite_inscription],
    ["mandat_paiement", (c) => c.mandat?.llm?.inscription?.paiement],
    ["mandat_rythme", (c) => c.mandat?.llm?.rythme],
    ["mandat_distances", (c) => join(c.mandat?.llm?.distances ?? c.mandat?.infos?.distances)],
    ["mandat_blasons", (c) => join(c.mandat?.llm?.blasons ?? c.mandat?.infos?.blasons)],
    ["mandat_arbitres", (c) => join(c.mandat?.llm?.arbitres) || c.mandat?.infos?.arbitres],
    ["mandat_selectif", (c) => (c.mandat?.llm ? (c.mandat.llm.selectif === null ? "" : c.mandat.llm.selectif ? "oui" : "non") : "")],
    ["mandat_restauration", (c) => c.mandat?.llm?.restauration],
    ["mandat_infos_complementaires", (c) => c.mandat?.llm?.informations_complementaires],
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
