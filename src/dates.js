/**
 * @file Lecture des dates écrites en français.
 *
 * Deux besoins bien distincts, d'où deux fonctions :
 *
 * 1. `parseDates` lit les dates que **ffta.fr** affiche sur chaque épreuve. Leur forme est
 *    régulière, imposée par le site : « Le 13 septembre 2026 », « Du 19 au 20 septembre 2026 ».
 *    On peut donc exiger une correspondance stricte, du début à la fin de la chaîne, et refuser
 *    tout le reste plutôt que de deviner.
 *
 * 2. `parseDateFr` cherche une date **au milieu du texte libre d'un mandat**, rédigé par un club
 *    sans contrainte de forme : « avant le 07/10/2026 », « Vendredi 09 octobre », « Samedi matin ».
 *    Ici on est en terrain mouvant, et l'année ou le jour manquent souvent. La date du concours
 *    sert alors de repère pour combler les trous.
 *
 * Règle commune à tout le fichier : **quand on ne sait pas, on renvoie `null`**. Une date fausse
 * dans un calendrier de compétitions est plus nuisible qu'une date absente, parce qu'elle ne se
 * remarque pas.
 */

/**
 * Numéro de mois par nom, avec et sans accent : le texte d'un PDF perd parfois ses accents,
 * et les clubs écrivent aussi bien « fevrier » que « février ».
 * @type {Object<string, number>}
 */
const MOIS = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};

/**
 * Assemble une date au format ISO `AAAA-MM-JJ`.
 * Les composants peuvent être des nombres ou des chaînes, les expressions régulières
 * renvoyant toujours des chaînes.
 *
 * @param {number|string} y année sur quatre chiffres
 * @param {number|string} m mois de 1 à 12
 * @param {number|string} d jour du mois
 * @returns {string} par exemple « 2026-09-13 »
 */
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Fragment d'expression régulière reconnaissant un nom de mois, accentué ou non.
 * Il est inséré dans plusieurs motifs construits dynamiquement, d'où la forme chaîne.
 * Chaque insertion consomme un groupe de capture : attention à la numérotation des groupes.
 */
const MOT = "(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)";

/**
 * Convertit la date affichée par ffta.fr en dates de début et de fin.
 *
 * Les quatre formes rencontrées sur le site, dans l'ordre où on les teste :
 *
 * | Texte du site                          | Début      | Fin        |
 * | -------------------------------------- | ---------- | ---------- |
 * | « Le 13 septembre 2026 »               | 2026-09-13 | 2026-09-13 |
 * | « Du 11 au 13 septembre 2026 »         | 2026-09-11 | 2026-09-13 |
 * | « Du 30 septembre au 2 octobre 2026 »  | 2026-09-30 | 2026-10-02 |
 * | « Du 30 décembre 2026 au 2 janvier 2027 » | 2026-12-30 | 2027-01-02 |
 *
 * Les motifs sont ancrés (`^` et `$`) : une chaîne inattendue ne produit aucune date plutôt
 * qu'une date approximative. Si le site change sa façon d'écrire les dates, on le verra
 * immédiatement à des colonnes vides, et non à des dates silencieusement fausses.
 *
 * @param {string|null|undefined} txt la date telle qu'affichée
 * @returns {{debut: string|null, fin: string|null}} dates ISO, ou deux `null` si la forme est inconnue
 */
export function parseDates(txt) {
  const t = (txt || "").toLowerCase().replace(/\s+/g, " ").trim();
  let m;

  // « Le <jour> <mois> <année> » : un seul jour, début et fin confondus
  if ((m = t.match(new RegExp(`^le (\\d{1,2}) ${MOT} (\\d{4})$`)))) {
    const d = iso(m[3], MOIS[m[2]], m[1]);
    return { debut: d, fin: d };
  }

  // « Du <jour> au <jour> <mois> <année> » : mois et année communs aux deux bornes
  if ((m = t.match(new RegExp(`^du (\\d{1,2}) au (\\d{1,2}) ${MOT} (\\d{4})$`)))) {
    return { debut: iso(m[4], MOIS[m[3]], m[1]), fin: iso(m[4], MOIS[m[3]], m[2]) };
  }

  // « Du <jour> <mois> au <jour> <mois> <année> » : à cheval sur deux mois, année en fin de chaîne
  if ((m = t.match(new RegExp(`^du (\\d{1,2}) ${MOT} au (\\d{1,2}) ${MOT} (\\d{4})$`)))) {
    return { debut: iso(m[5], MOIS[m[2]], m[1]), fin: iso(m[5], MOIS[m[4]], m[3]) };
  }

  // « Du <jour> <mois> <année> au <jour> <mois> <année> » : à cheval sur deux années
  if ((m = t.match(new RegExp(`^du (\\d{1,2}) ${MOT} (\\d{4}) au (\\d{1,2}) ${MOT} (\\d{4})$`)))) {
    return { debut: iso(m[3], MOIS[m[2]], m[1]), fin: iso(m[6], MOIS[m[5]], m[4]) };
  }

  return { debut: null, fin: null };
}

/**
 * Jours de la semaine indexés comme `Date.getUTCDay()` : dimanche vaut 0.
 * @type {string[]}
 */
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/**
 * Repère utilisé pour compléter une date incomplète trouvée dans un mandat.
 *
 * @typedef {object} RepereDate
 * @property {string|null} [debut]  Premier jour du concours, `AAAA-MM-JJ`
 * @property {string|null} [fin]    Dernier jour du concours
 * @property {boolean} [limite]     Vrai si la date cherchée est une date limite d'inscription.
 *                                  Change la déduction d'année : voir plus bas.
 */

/**
 * Cherche une date dans un fragment de texte libre issu d'un mandat.
 *
 * Trois écritures sont reconnues, testées dans cet ordre de fiabilité décroissante :
 *
 * 1. **Numérique** : « 12/10/2026 », « 07/10/26 », ou « 19/09 » sans année.
 * 2. **En toutes lettres** : « lundi 12 octobre 2026 », « 6 septembre », « 1er mars ».
 * 3. **Jour de la semaine seul** : « Samedi après-midi ». Ne peut être résolu que si l'on connaît
 *    la période du concours ; on prend alors le premier jour de cette période qui tombe un samedi.
 *
 * ### Déduction de l'année
 *
 * Quand l'année n'est pas écrite, on prend celle du concours. Un cas particulier se présente pour
 * les dates limites d'inscription, signalées par `ref.limite` : une date limite est forcément
 * *antérieure* au concours. Si la date reconstituée tombe après, c'est que l'année est la
 * précédente. Exemple concret : un concours en salle le 10 janvier 2027 dont le mandat annonce
 * « inscriptions avant le 20 décembre » parle du 20 décembre 2026, pas du 20 décembre 2027.
 *
 * @param {string|null|undefined} txt le fragment de texte à examiner
 * @param {RepereDate} [ref] dates du concours, qui servent de repère
 * @returns {{date: string|null, heure: string|null}} date ISO et heure `HH:MM` si elle figure dans le texte
 */
export function parseDateFr(txt, ref = {}) {
  const t = (txt || "").toLowerCase().replace(/\s+/g, " ");
  const refYear = ref.debut ? Number(ref.debut.slice(0, 4)) : new Date().getFullYear();
  let date = null;
  let m;

  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    // Forme numérique. L'année sur deux chiffres est ramenée au XXIe siècle : « 26 » vaut 2026.
    let y = m[3] ? Number(m[3]) : refYear;
    if (y < 100) y += 2000;
    date = iso(y, Number(m[2]), Number(m[1]));
  } else if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+${MOT}(?:\\s+(\\d{4}))?`)))) {
    // Forme en toutes lettres. Le « er » de « 1er » est absorbé sans être capturé.
    date = iso(m[3] ? Number(m[3]) : refYear, MOIS[m[2]], Number(m[1]));
  } else if ((m = t.match(/\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/)) && ref.debut) {
    // Jour de la semaine seul : résolu uniquement dans la période du concours
    date = dayInRange(JOURS.indexOf(m[1]), ref.debut, ref.fin || ref.debut);
  }

  // Correction d'année pour les dates limites, expliquée dans la documentation ci-dessus.
  // Les deux tests sur `t` vérifient qu'aucune année n'était réellement écrite : sinon on la respecte.
  if (date && !/\d{4}/.test(t) && !/\/\d{2,4}\b/.test(t) && ref.debut && ref.limite && date > ref.debut) {
    date = `${refYear - 1}${date.slice(4)}`;
  }

  // L'heure est cherchée indépendamment de la date : « avant le 22 octobre 12h » donne les deux,
  // « à 9h30 » ne donne que l'heure. Les minutes sont facultatives, « 9h » vaut 09:00.
  const h = t.match(/\b(\d{1,2})\s?[h:]\s?(\d{2})?\b/);
  const heure = h ? `${h[1].padStart(2, "0")}:${h[2] || "00"}` : null;

  return { date, heure };
}

/**
 * Premier jour de l'intervalle `[debut, fin]` qui tombe sur le jour de semaine demandé.
 *
 * Sert à résoudre « Samedi après-midi » quand le mandat ne donne pas la date. Le midi UTC évite
 * les surprises de fuseau horaire : à minuit, un décalage d'une heure ferait basculer de jour.
 *
 * @param {number} jour 0 pour dimanche, 6 pour samedi, comme `Date.getUTCDay()`
 * @param {string} debut date ISO de début, incluse
 * @param {string} fin date ISO de fin, incluse
 * @returns {string|null} la date trouvée, ou `null` si aucun jour de l'intervalle ne convient
 */
function dayInRange(jour, debut, fin) {
  const d = new Date(debut + "T12:00:00Z");
  const end = new Date(fin + "T12:00:00Z");
  while (d <= end) {
    if (d.getUTCDay() === jour) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

/**
 * Décale une date ISO d'un nombre de jours, positif ou négatif.
 *
 * Utilisé pour deux choses : passer au lendemain quand les horaires d'un mandat repartent en
 * arrière (samedi 14 h puis 8 h, donc dimanche), et élargir la fenêtre de recherche d'un jour
 * de semaine autour du concours.
 *
 * `Date` gère les fins de mois et les années bissextiles ; le midi UTC neutralise les fuseaux.
 *
 * @param {string} isoDate date de départ, `AAAA-MM-JJ`
 * @param {number} n nombre de jours à ajouter
 * @returns {string} la date décalée, `AAAA-MM-JJ`
 */
export function addDays(isoDate, n) {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
