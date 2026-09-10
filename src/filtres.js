/**
 * @file Traduction des options de la ligne de commande en paramètres d'URL du site fédéral.
 *
 * ## Rôle
 *
 * L'utilisateur écrit ce qui lui vient naturellement :
 *
 * ```
 * node src/scrape.js --region "Bretagne, Pays de la Loire" --discipline salle
 * ```
 *
 * Le site, lui, attend des identifiants internes :
 *
 * ```
 * /competitions?dep[]=21&dep[]=28&dep[]=36&dep[]=57&dep[]=45&…&discipline=103
 * ```
 *
 * Ce module fait la conversion, et lui seule. Il ne touche ni au réseau ni au disque, ce qui le
 * rend entièrement testable et explique sa couverture de 100 %.
 *
 * ## Deux principes
 *
 * 1. **Tolérance en entrée.** Une région s'écrit avec ou sans accent, en majuscules ou non ; une
 *    discipline s'accepte par code court, par libellé fédéral ou par identifiant numérique. Rien
 *    n'oblige l'utilisateur à connaître les conventions du site.
 *
 * 2. **Refus net des valeurs inconnues.** Une valeur non reconnue lève une erreur nommant les
 *    valeurs acceptées, plutôt que d'être ignorée. Un filtre silencieusement écarté produirait un
 *    relevé bien plus large que demandé, sans que rien ne l'indique : c'est le genre de panne qu'on
 *    ne découvre qu'une fois les mauvaises données diffusées.
 */

import { REGIONS, DEPARTEMENTS, DISCIPLINES, UNIVERS, DEFAULT_REGION } from "./config.js";

/**
 * Réduit une chaîne à sa forme comparable : sans accent, en minuscules, ponctuation en espaces.
 * Permet à « Île-de-France », « ile de france » et « ILE-DE-FRANCE » de désigner la même région.
 *
 * @param {unknown} s
 * @returns {string}
 */
const sansAccents = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Découpe une liste saisie en une seule option.
 *
 * Le point-virgule est accepté en plus de la virgule, parce que sous Windows la virgule oblige
 * parfois à jouer avec les guillemets selon l'interpréteur de commandes.
 *
 * @param {unknown} v par exemple « Bretagne, Pays de la Loire » ou « 44;85 »
 * @returns {string[]} les éléments nettoyés, sans entrée vide
 */
const splitList = (v) =>
  String(v)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Convertit les options de la ligne de commande en filtres exploitables.
 *
 * ## Priorité de la zone géographique
 *
 * Trois sources possibles, dans cet ordre :
 * 1. `--dep 44,85` : des numéros de départements, qui l'emportent sur tout le reste ;
 * 2. `--region "Bretagne"` : une ou plusieurs régions, ou le mot `france` pour tout le calendrier ;
 * 3. rien : la région par défaut s'applique.
 *
 * Le cas « France entière » se traduit par une liste de départements **vide**, et non par la liste
 * de tous les départements : ne pas envoyer de paramètre `dep[]` au site revient à ne pas filtrer,
 * ce qui est à la fois plus court et plus sûr qu'une énumération de cent entrées.
 *
 * @param {Object<string, string|boolean>} args options analysées depuis `process.argv`
 * @returns {import("./types.js").Filtres} les filtres résolus
 * @throws {Error} si une valeur ne correspond à rien de connu ; le message énumère les valeurs acceptées
 */
export function resoudreFiltres(args) {
  /** Version lisible des filtres, recopiée dans le JSON de sortie pour tracer l'origine des données. */
  const desc = {};
  /** @type {string[]} identifiants ffta.fr des départements ; vide signifie « toute la France » */
  let depIds = [];

  // ---------------------------------------------------------------- Zone géographique
  if (args.dep) {
    // Numéros officiels fournis par l'utilisateur : on remonte à l'identifiant interne du site.
    // Le complément à deux chiffres accepte « 1 » aussi bien que « 01 » ; les majuscules
    // permettent d'écrire « 2a » pour la Corse-du-Sud.
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
      // Aucun filtre géographique : `depIds` reste vide, aucun paramètre `dep[]` ne sera envoyé
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

  // ---------------------------------------------------------------- Autres filtres
  /** @type {Object<string, string>} paramètres de requête à ajouter à l'URL */
  const params = {};

  if (args.start) params.start = verifierDate(args.start, "--start");
  if (args.end) params.end = verifierDate(args.end, "--end");

  if (args.discipline) {
    // Trois écritures acceptées, essayées dans l'ordre : identifiant numérique, code court, libellé.
    // L'identifiant est testé en premier parce qu'il est sans ambiguïté possible.
    const v = String(args.discipline);
    let d = /^\d+$/.test(v) ? Object.values(DISCIPLINES).find((x) => x.id === Number(v)) : null;
    d ||= Object.values(DISCIPLINES).find((x) => x.code === sansAccents(v).replace(/ /g, "_"));
    d ||= Object.entries(DISCIPLINES).find(([nom]) => sansAccents(nom) === sansAccents(v))?.[1];
    if (!d) {
      const codes = [...new Set(Object.values(DISCIPLINES).map((x) => x.code))].join(", ");
      throw new Error(`Discipline inconnue : ${v}. Codes : ${codes}.`);
    }
    params.discipline = String(d.id);
    desc.discipline = Object.entries(DISCIPLINES).find(([, x]) => x === d)[0];
  }

  if (args.univers) {
    const v = String(args.univers);
    const u =
      UNIVERS[sansAccents(v).replace(/ /g, "_")] ||
      Object.values(UNIVERS).find((x) => x.id === Number(v) || sansAccents(x.nom) === sansAccents(v));
    if (!u) throw new Error(`Univers inconnu : ${v}. Valeurs : ${Object.keys(UNIVERS).join(", ")}.`);
    params.univers = String(u.id);
    desc.univers = u.nom;
  }

  if (args.search) {
    params.search = String(args.search);
    desc.recherche = params.search;
  }

  if (args.restreint !== undefined) {
    // `--restreint` seul vaut « oui » ; les formes négatives explicites valent « non ».
    // Le paramètre du site s'appelle `inter`, héritage de son formulaire.
    params.inter = args.restreint === false || /^(0|non|false|faux)$/i.test(String(args.restreint)) ? "0" : "1";
    desc.calendrier_restreint = params.inter === "1";
  }

  // Le site trie par date croissante par défaut : on ne transmet le paramètre que pour l'inverser
  if (args.sort && /^desc/i.test(String(args.sort))) params.sort_order = "DESC";

  if (params.start) desc.du = params.start;
  if (params.end) desc.au = params.end;

  return { depIds, params, description: desc };
}

/**
 * Vérifie qu'une date est bien au format ISO avant de l'envoyer au site.
 *
 * Le contrôle est volontairement strict et purement formel. Une date écrite « 01/10/2026 » serait
 * comprise de travers par le site, qui n'attend que le format ISO, et produirait un relevé vide
 * sans message d'erreur. Mieux vaut refuser tout de suite, en expliquant le format attendu.
 *
 * @param {unknown} v la valeur saisie
 * @param {string} opt le nom de l'option, cité dans le message d'erreur
 * @returns {string} la date validée
 * @throws {Error} si le format n'est pas `AAAA-MM-JJ`
 */
function verifierDate(v, opt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    throw new Error(`${opt} attend une date au format YYYY-MM-DD (reçu : ${v})`);
  }
  return String(v);
}

/**
 * Compose le texte affiché par `--list-filters`.
 *
 * Il est engendré à partir des tables de `config.js` plutôt que recopié à la main : impossible
 * qu'il se désynchronise si une discipline ou une région est ajoutée.
 *
 * @returns {string} le texte d'aide, prêt à être affiché sur la sortie standard
 */
export function aideFiltres() {
  const lignes = [];

  lignes.push('Régions (--region, plusieurs possibles séparées par des virgules, ou "france") :');
  for (const [nom, ids] of Object.entries(REGIONS)) {
    lignes.push(`  ${nom.padEnd(28)} ${ids.map((id) => DEPARTEMENTS[id]?.code).join(", ")}`);
  }

  lignes.push("\nDisciplines (--discipline, code ou libellé) :");
  for (const [nom, d] of Object.entries(DISCIPLINES)) lignes.push(`  ${d.code.padEnd(26)} ${nom}`);

  lignes.push("\nUnivers (--univers) :");
  for (const [code, u] of Object.entries(UNIVERS)) lignes.push(`  ${code.padEnd(26)} ${u.nom}`);

  return lignes.join("\n");
}
