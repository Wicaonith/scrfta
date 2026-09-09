// Identifiants internes des départements sur ffta.fr (valeur du <select name="dep[]">)
// Le mapping région -> départements provient de drupalSettings.ffta_regions sur /competitions.
export const REGIONS = {
  "Auvergne-Rhône-Alpes": ["1", "3", "7", "15", "25", "39", "43", "44", "64", "70", "74", "75"],
  "Hauts-de-France": ["2", "60", "61", "63", "81"],
  "Provence-Alpes-Côte d'Azur": ["4", "5", "6", "13", "84", "85"],
  "Grand Est": ["8", "10", "52", "53", "55", "56", "58", "68", "69", "89"],
  "Occitanie": ["9", "11", "12", "31", "32", "33", "35", "47", "49", "66", "67", "82", "83"],
  "Normandie": ["14", "26", "51", "62", "77"],
  "Nouvelle-Aquitaine": ["16", "17", "19", "22", "23", "34", "41", "48", "65", "80", "87", "88"],
  "Centre-Val de Loire": ["18", "27", "37", "38", "42", "46"],
  "Bourgogne-Franche-Comté": ["20", "24", "40", "59", "71", "72", "90", "91"],
  "Bretagne": ["21", "28", "36", "57"],
  "Corse": ["29", "30"],
  "Pays de la Loire": ["45", "50", "54", "73", "86"], // 44, 49, 53, 72, 85
  "Île-de-France": ["76", "78", "79", "92", "93", "94", "95", "96"],
  "Guadeloupe": ["97"],
  "Martinique": ["98"],
  "Guyane": ["99"],
  "La Réunion": ["100"],
  "Mayotte": ["101"],
  "Nouvelle Calédonie": ["395", "399"],
};

// Identifiant ffta.fr -> numéro et nom de département (options du <select name="dep[]"> du site)
export const DEPARTEMENTS = {
  "1": { code: "01", nom: "Ain" }, "2": { code: "02", nom: "Aisne" }, "3": { code: "03", nom: "Allier" },
  "4": { code: "04", nom: "Alpes-de-Haute-Provence" }, "5": { code: "05", nom: "Hautes-Alpes" },
  "6": { code: "06", nom: "Alpes-Maritimes" }, "7": { code: "07", nom: "Ardèche" }, "8": { code: "08", nom: "Ardennes" },
  "9": { code: "09", nom: "Ariège" }, "10": { code: "10", nom: "Aube" }, "11": { code: "11", nom: "Aude" },
  "12": { code: "12", nom: "Aveyron" }, "13": { code: "13", nom: "Bouches-du-Rhône" }, "14": { code: "14", nom: "Calvados" },
  "15": { code: "15", nom: "Cantal" }, "16": { code: "16", nom: "Charente" }, "17": { code: "17", nom: "Charente-Maritime" },
  "18": { code: "18", nom: "Cher" }, "19": { code: "19", nom: "Corrèze" }, "20": { code: "21", nom: "Côte-d'Or" },
  "21": { code: "22", nom: "Côtes-d'Armor" }, "22": { code: "23", nom: "Creuse" }, "23": { code: "24", nom: "Dordogne" },
  "24": { code: "25", nom: "Doubs" }, "25": { code: "26", nom: "Drôme" }, "26": { code: "27", nom: "Eure" },
  "27": { code: "28", nom: "Eure-et-Loir" }, "28": { code: "29", nom: "Finistère" }, "29": { code: "2A", nom: "Corse-du-Sud" },
  "30": { code: "2B", nom: "Haute-Corse" }, "31": { code: "30", nom: "Gard" }, "32": { code: "31", nom: "Haute-Garonne" },
  "33": { code: "32", nom: "Gers" }, "34": { code: "33", nom: "Gironde" }, "35": { code: "34", nom: "Hérault" },
  "36": { code: "35", nom: "Ille-et-Vilaine" }, "37": { code: "36", nom: "Indre" }, "38": { code: "37", nom: "Indre-et-Loire" },
  "39": { code: "38", nom: "Isère" }, "40": { code: "39", nom: "Jura" }, "41": { code: "40", nom: "Landes" },
  "42": { code: "41", nom: "Loir-et-Cher" }, "43": { code: "42", nom: "Loire" }, "44": { code: "43", nom: "Haute-Loire" },
  "45": { code: "44", nom: "Loire-Atlantique" }, "46": { code: "45", nom: "Loiret" }, "47": { code: "46", nom: "Lot" },
  "48": { code: "47", nom: "Lot-et-Garonne" }, "49": { code: "48", nom: "Lozère" }, "50": { code: "49", nom: "Maine-et-Loire" },
  "51": { code: "50", nom: "Manche" }, "52": { code: "51", nom: "Marne" }, "53": { code: "52", nom: "Haute-Marne" },
  "54": { code: "53", nom: "Mayenne" }, "55": { code: "54", nom: "Meurthe-et-Moselle" }, "56": { code: "55", nom: "Meuse" },
  "57": { code: "56", nom: "Morbihan" }, "58": { code: "57", nom: "Moselle" }, "59": { code: "58", nom: "Nièvre" },
  "60": { code: "59", nom: "Nord" }, "61": { code: "60", nom: "Oise" }, "62": { code: "61", nom: "Orne" },
  "63": { code: "62", nom: "Pas-de-Calais" }, "64": { code: "63", nom: "Puy-de-Dôme" }, "65": { code: "64", nom: "Pyrénées-Atlantiques" },
  "66": { code: "65", nom: "Hautes-Pyrénées" }, "67": { code: "66", nom: "Pyrénées-Orientales" }, "68": { code: "67", nom: "Bas-Rhin" },
  "69": { code: "68", nom: "Haut-Rhin" }, "70": { code: "69", nom: "Rhône" }, "71": { code: "70", nom: "Haute-Saône" },
  "72": { code: "71", nom: "Saône-et-Loire" }, "73": { code: "72", nom: "Sarthe" }, "74": { code: "73", nom: "Savoie" },
  "75": { code: "74", nom: "Haute-Savoie" }, "76": { code: "75", nom: "Paris" }, "77": { code: "76", nom: "Seine-Maritime" },
  "78": { code: "77", nom: "Seine-et-Marne" }, "79": { code: "78", nom: "Yvelines" }, "80": { code: "79", nom: "Deux-Sèvres" },
  "81": { code: "80", nom: "Somme" }, "82": { code: "81", nom: "Tarn" }, "83": { code: "82", nom: "Tarn-et-Garonne" },
  "84": { code: "83", nom: "Var" }, "85": { code: "84", nom: "Vaucluse" }, "86": { code: "85", nom: "Vendée" },
  "87": { code: "86", nom: "Vienne" }, "88": { code: "87", nom: "Haute-Vienne" }, "89": { code: "88", nom: "Vosges" },
  "90": { code: "89", nom: "Yonne" }, "91": { code: "90", nom: "Territoire de Belfort" }, "92": { code: "91", nom: "Essonne" },
  "93": { code: "92", nom: "Hauts-de-Seine" }, "94": { code: "93", nom: "Seine-Saint-Denis" }, "95": { code: "94", nom: "Val-de-Marne" },
  "96": { code: "95", nom: "Val-d'Oise" }, "97": { code: "971", nom: "Guadeloupe" }, "98": { code: "972", nom: "Martinique" },
  "99": { code: "973", nom: "Guyane" }, "100": { code: "974", nom: "La Réunion" }, "101": { code: "976", nom: "Mayotte" },
  "395": { code: "988", nom: "Nouvelle Calédonie" }, "399": { code: "988", nom: "Nouvelle Calédonie" },
};

const sansAccents = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Trouve le département { code, nom } à partir d'un code postal (« 44330 »)
 * ou du libellé d'un comité (« COMITE DEPARTEMENTAL LOIRE ATLANTIQUE », « COMITE DEPARTEMENTAL DE VENDEE »).
 */
export function departementDe({ codePostal, comite } = {}) {
  const liste = Object.values(DEPARTEMENTS);
  if (codePostal) {
    const cp = String(codePostal);
    let code = cp.startsWith("97") || cp.startsWith("98") ? cp.slice(0, 3) : cp.slice(0, 2);
    if (code === "20") code = Number(cp) < 20200 ? "2A" : "2B";
    const d = liste.find((x) => x.code === code);
    if (d) return { ...d };
  }
  if (comite) {
    const lib = sansAccents(comite).replace(/^comite departemental( de| du| des| d)?\s*/, "");
    const d = liste.find((x) => sansAccents(x.nom) === lib) || liste.find((x) => lib.includes(sansAccents(x.nom)));
    if (d) return { ...d };
  }
  return null;
}

/**
 * Disciplines telles que libellées sur ffta.fr (liste et filtre <select name="discipline">).
 * id   = identifiant de taxonomie ffta.fr (valeur du filtre, stable côté site)
 * code = code court stable de ce projet ; base = libellé sans la mention para ; para = discipline para-tir
 */
export const DISCIPLINES = {
  "Tir à 18m": { id: 103, code: "salle", base: "Tir à 18m", para: false },
  "Para-tir à l'arc à 18m": { id: 118, code: "salle", base: "Tir à 18m", para: true },
  "Tir à l'arc extérieur": { id: 102, code: "tae", base: "Tir à l'arc extérieur", para: false },
  "Para-tir à l'arc en extérieur": { id: 117, code: "tae", base: "Tir à l'arc extérieur", para: true },
  "Tir en campagne": { id: 107, code: "campagne", base: "Tir en campagne", para: false },
  "Tir 3d": { id: 108, code: "3d", base: "Tir 3D", para: false },
  "Tir beursault": { id: 110, code: "beursault", base: "Tir beursault", para: false },
  "Tir nature": { id: 109, code: "nature", base: "Tir nature", para: false },
  "Run archery": { id: 116, code: "run_archery", base: "Run archery", para: false },
  "Jeunes": { id: 113, code: "jeunes", base: "Jeunes", para: false },
  "Tournoi poussin": { id: 115, code: "poussin", base: "Tournoi poussin", para: false },
  "Loisirs": { id: 111, code: "loisir", base: "Loisirs", para: false },
  "Loisirs débutant": { id: 407, code: "loisir_debutant", base: "Loisirs débutant", para: false },
  "Loisirs confirmé": { id: 406, code: "loisir_confirme", base: "Loisirs confirmé", para: false },
  "Loisirs débutant et confirmé": { id: 408, code: "loisir_debutant_confirme", base: "Loisirs débutant et confirmé", para: false },
  "Rencontres clubs loisirs": { id: 114, code: "rencontre_clubs", base: "Rencontres clubs loisirs", para: false },
  "Divers": { id: 112, code: "divers", base: "Divers", para: false },
};

/** Discipline structurée à partir du libellé ffta.fr (insensible à la casse et aux accents). */
export function disciplineDe(libelle) {
  if (!libelle) return null;
  const key = sansAccents(libelle);
  for (const [nom, d] of Object.entries(DISCIPLINES)) if (sansAccents(nom) === key) return { libelle: nom, ...d };
  // Inconnue : on déduit au moins le para et un code approché
  const para = /^para/i.test(libelle);
  return { libelle, id: null, code: sansAccents(libelle).replace(/^para tir a l arc (a |en )?/, "").replace(/\s+/g, "_"), base: libelle.replace(/^Para-tir à l'arc (à |en )?/i, ""), para };
}

export const BASE_URL = "https://www.ffta.fr";
export const LIST_PATH = "/competitions";
export const DEFAULT_REGION = "Pays de la Loire";
