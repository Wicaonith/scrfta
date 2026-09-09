// Conversion des options de la ligne de commande vers les paramètres de la vue ffta.fr/competitions.
import { REGIONS, DEPARTEMENTS, DISCIPLINES, UNIVERS, DEFAULT_REGION } from "./config.js";

const sansAccents = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const splitList = (v) =>
  String(v)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Résout les filtres depuis les arguments CLI.
 * Renvoie { depIds, params, description } :
 *  - depIds : identifiants ffta.fr des départements (vide = toute la France)
 *  - params : autres paramètres GET (start, end, discipline, univers, inter, search, sort_order)
 *  - description : filtres résolus, lisibles, écrits dans le JSON de sortie
 */
export function resoudreFiltres(args) {
  const desc = {};
  let depIds = [];

  // ---- Zone géographique : --dep (numéros) > --region (une ou plusieurs, ou "france") > région par défaut
  if (args.dep) {
    const codes = splitList(args.dep);
    depIds = codes.map((code) => {
      const c = code.toUpperCase().padStart(2, "0");
      const entry = Object.entries(DEPARTEMENTS).find(([, d]) => d.code === c);
      if (!entry) throw new Error(`Département inconnu : ${code}. Numéros attendus : 01…95, 2A, 2B, 971…976, 988.`);
      return entry[0];
    });
    desc.departements = depIds.map((id) => DEPARTEMENTS[id]);
  } else {
    const regions = args.region ? splitList(args.region) : [DEFAULT_REGION];
    if (regions.some((r) => /^(france|all|tout|toutes|\*)$/i.test(r))) {
      desc.regions = ["France entière"];
    } else {
      desc.regions = regions.map((r) => {
        const key = Object.keys(REGIONS).find((k) => sansAccents(k) === sansAccents(r));
        if (!key) throw new Error(`Région inconnue : ${r}. Régions : ${Object.keys(REGIONS).join(", ")}, ou "france".`);
        depIds.push(...REGIONS[key]);
        return key;
      });
      desc.departements = depIds.map((id) => DEPARTEMENTS[id]);
    }
  }

  // ---- Autres filtres de la page
  const params = {};
  if (args.start) params.start = verifierDate(args.start, "--start");
  if (args.end) params.end = verifierDate(args.end, "--end");

  if (args.discipline) {
    const v = String(args.discipline);
    let d = /^\d+$/.test(v) ? Object.values(DISCIPLINES).find((x) => x.id === Number(v)) : null;
    d ||= Object.values(DISCIPLINES).find((x) => x.code === sansAccents(v).replace(/ /g, "_"));
    d ||= Object.entries(DISCIPLINES).find(([nom]) => sansAccents(nom) === sansAccents(v))?.[1];
    if (!d) throw new Error(`Discipline inconnue : ${v}. Codes : ${[...new Set(Object.values(DISCIPLINES).map((x) => x.code))].join(", ")}.`);
    params.discipline = String(d.id);
    desc.discipline = Object.entries(DISCIPLINES).find(([, x]) => x === d)[0];
  }

  if (args.univers) {
    const v = String(args.univers);
    const u = UNIVERS[sansAccents(v).replace(/ /g, "_")] || Object.values(UNIVERS).find((x) => x.id === Number(v) || sansAccents(x.nom) === sansAccents(v));
    if (!u) throw new Error(`Univers inconnu : ${v}. Valeurs : ${Object.keys(UNIVERS).join(", ")}.`);
    params.univers = String(u.id);
    desc.univers = u.nom;
  }

  if (args.search) {
    params.search = String(args.search);
    desc.recherche = params.search;
  }
  if (args.restreint !== undefined) {
    params.inter = args.restreint === false || /^(0|non|false|faux)$/i.test(String(args.restreint)) ? "0" : "1";
    desc.calendrier_restreint = params.inter === "1";
  }
  if (args.sort && /^desc/i.test(String(args.sort))) params.sort_order = "DESC";

  if (params.start) desc.du = params.start;
  if (params.end) desc.au = params.end;
  return { depIds, params, description: desc };
}

function verifierDate(v, opt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error(`${opt} attend une date au format YYYY-MM-DD (reçu : ${v})`);
  return String(v);
}

/** Texte d'aide listant les valeurs acceptées par les filtres. */
export function aideFiltres() {
  const lignes = [];
  lignes.push("Régions (--region, plusieurs possibles séparées par des virgules, ou \"france\") :");
  for (const [nom, ids] of Object.entries(REGIONS)) lignes.push(`  ${nom.padEnd(28)} ${ids.map((id) => DEPARTEMENTS[id]?.code).join(", ")}`);
  lignes.push("\nDisciplines (--discipline, code ou libellé) :");
  for (const [nom, d] of Object.entries(DISCIPLINES)) lignes.push(`  ${d.code.padEnd(26)} ${nom}`);
  lignes.push("\nUnivers (--univers) :");
  for (const [code, u] of Object.entries(UNIVERS)) lignes.push(`  ${code.padEnd(26)} ${u.nom}`);
  return lignes.join("\n");
}
