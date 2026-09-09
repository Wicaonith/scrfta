const MOIS = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const MOT = "(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)";

/**
 * "Le 13 septembre 2026"                       -> 2026-09-13 / 2026-09-13
 * "Du 11 au 13 septembre 2026"                 -> 2026-09-11 / 2026-09-13
 * "Du 30 septembre au 2 octobre 2026"          -> 2026-09-30 / 2026-10-02
 * "Du 30 décembre 2026 au 2 janvier 2027"      -> 2026-12-30 / 2027-01-02
 */
export function parseDates(txt) {
  const t = (txt || "").toLowerCase().replace(/\s+/g, " ").trim();
  let m;
  if ((m = t.match(new RegExp(`^le (\\d{1,2}) ${MOT} (\\d{4})$`)))) {
    const d = iso(m[3], MOIS[m[2]], m[1]);
    return { debut: d, fin: d };
  }
  if ((m = t.match(new RegExp(`^du (\\d{1,2}) au (\\d{1,2}) ${MOT} (\\d{4})$`)))) {
    return { debut: iso(m[4], MOIS[m[3]], m[1]), fin: iso(m[4], MOIS[m[3]], m[2]) };
  }
  if ((m = t.match(new RegExp(`^du (\\d{1,2}) ${MOT} au (\\d{1,2}) ${MOT} (\\d{4})$`)))) {
    return { debut: iso(m[5], MOIS[m[2]], m[1]), fin: iso(m[5], MOIS[m[4]], m[3]) };
  }
  if ((m = t.match(new RegExp(`^du (\\d{1,2}) ${MOT} (\\d{4}) au (\\d{1,2}) ${MOT} (\\d{4})$`)))) {
    return { debut: iso(m[3], MOIS[m[2]], m[1]), fin: iso(m[6], MOIS[m[5]], m[4]) };
  }
  return { debut: null, fin: null };
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/**
 * Trouve une date dans un texte libre et la renvoie en ISO.
 *  - « 12/10/2026 », « 07/10/26 », « 19/09 » (année déduite de ref)
 *  - « lundi 12 octobre 2026 », « 6 septembre », « 1er mars »
 *  - « samedi » seul (avec ref début/fin : premier jour de la période qui tombe ce jour-là)
 * ref = { debut: "YYYY-MM-DD", fin: "YYYY-MM-DD" } sert à déduire l'année (et le jour de semaine).
 * Renvoie { date, heure } ; heure = "HH:MM" si une heure figure dans le texte, sinon null.
 */
export function parseDateFr(txt, ref = {}) {
  const t = (txt || "").toLowerCase().replace(/\s+/g, " ");
  const refYear = ref.debut ? Number(ref.debut.slice(0, 4)) : new Date().getFullYear();
  let date = null;
  let m;
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    let y = m[3] ? Number(m[3]) : refYear;
    if (y < 100) y += 2000;
    date = iso(y, Number(m[2]), Number(m[1]));
  } else if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+${MOT}(?:\\s+(\\d{4}))?`)))) {
    date = iso(m[3] ? Number(m[3]) : refYear, MOIS[m[2]], Number(m[1]));
  } else if ((m = t.match(/\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/)) && ref.debut) {
    date = dayInRange(JOURS.indexOf(m[1]), ref.debut, ref.fin || ref.debut);
  }
  // Année déduite : une date limite est avant le concours ; si elle tombe après, c'est l'année précédente
  if (date && !/\d{4}/.test(t) && !/\/\d{2,4}\b/.test(t) && ref.debut && ref.limite && date > ref.debut) {
    date = `${refYear - 1}${date.slice(4)}`;
  }
  const h = t.match(/\b(\d{1,2})\s?[h:]\s?(\d{2})?\b/);
  const heure = h ? `${h[1].padStart(2, "0")}:${h[2] || "00"}` : null;
  return { date, heure };
}

/** Premier jour de [debut, fin] dont le jour de semaine est jour (0 = dimanche). */
function dayInRange(jour, debut, fin) {
  const d = new Date(debut + "T12:00:00Z");
  const end = new Date(fin + "T12:00:00Z");
  while (d <= end) {
    if (d.getUTCDay() === jour) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

/** Ajoute n jours à une date ISO. */
export function addDays(isoDate, n) {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
