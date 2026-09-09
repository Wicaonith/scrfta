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

// Identifiant ffta.fr -> numéro et nom de département
export const DEPARTEMENTS = {
  "45": { code: "44", nom: "Loire-Atlantique" },
  "50": { code: "49", nom: "Maine-et-Loire" },
  "54": { code: "53", nom: "Mayenne" },
  "73": { code: "72", nom: "Sarthe" },
  "86": { code: "85", nom: "Vendée" },
};

export const BASE_URL = "https://www.ffta.fr";
export const LIST_PATH = "/competitions";
export const DEFAULT_REGION = "Pays de la Loire";
