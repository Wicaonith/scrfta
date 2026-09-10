/**
 * @file Orchestration du téléchargement et de l'analyse des mandats.
 *
 * Fait le lien entre la liste des compétitions et les modules spécialisés `mandat.js` et `pdf.js`.
 * Trois préoccupations lui appartiennent en propre :
 *
 * 1. **Ne lire chaque PDF qu'une fois**, même quand plusieurs épreuves le partagent.
 * 2. **Traiter plusieurs mandats en parallèle**, sans saturer le serveur fédéral.
 * 3. **Isoler les erreurs** : un mandat illisible ne doit pas faire échouer le relevé entier.
 */

import path from "node:path";
import { downloadMandat, parseMandat, reextractInfos } from "./mandat.js";
import { terminateOcr } from "./pdf.js";

/**
 * Télécharge et analyse les mandats de toutes les compétitions qui en ont un.
 *
 * ## Deux niveaux de mise en cache
 *
 * **Entre deux exécutions**, `downloadMandat` ne retélécharge un PDF que si le serveur annonce une
 * date de modification plus récente.
 *
 * **Au sein d'une exécution**, la carte `parCache` évite de relire deux fois le même fichier. Le
 * cas se présente à chaque week-end publié en deux épreuves : les deux pointent vers le même PDF.
 * Comme la lecture d'un PDF, et davantage encore la reconnaissance de caractères, coûte cher, le
 * gain est net.
 *
 * Attention à une subtilité : le texte est partagé, **mais pas l'analyse**. Les départs et la date
 * limite dépendent des dates de l'épreuve, qui diffèrent d'une épreuve à l'autre. On rejoue donc
 * `reextractInfos` pour chacune, sur le texte mis en commun.
 *
 * ## Parallélisme
 *
 * Trois mandats à la fois par défaut. Assez pour que les attentes réseau se recouvrent, assez peu
 * pour rester courtois envers le serveur de la fédération, qui rend un service public gratuit.
 *
 * ## Erreurs
 *
 * Un mandat en échec renseigne `mandat_erreur` sur sa compétition et n'interrompt rien. Un lien
 * mort ou un PDF corrompu ne doit pas faire perdre les cent quatre-vingts autres épreuves déjà
 * collectées.
 *
 * @param {import("./types.js").Competition[]} competitions modifiées en place
 * @param {object} options
 * @param {string} options.outDir dossier de sortie, contenant le sous-dossier `mandats`
 * @param {boolean} [options.ocr=true] autoriser la reconnaissance de caractères
 * @param {boolean} [options.force=false] réanalyser même si le mandat est déjà en cache
 * @param {number} [options.concurrency=3] nombre de mandats traités en parallèle
 * @param {(msg: string) => void} [options.log] fonction de journalisation
 * @returns {Promise<void>}
 */
export async function analyseMandats(competitions, { outDir, ocr = true, force = false, concurrency = 3, log = () => {} }) {
  const mandatDir = path.join(outDir, "mandats");
  const cibles = competitions.filter((c) => c.mandat_url);

  /**
   * Analyses en cours ou terminées, indexées par nom de fichier.
   *
   * On y range la **promesse** et non le résultat : si deux épreuves demandent le même PDF en même
   * temps, la seconde attend l'analyse déjà lancée au lieu d'en démarrer une concurrente.
   *
   * @type {Map<string, Promise<import("./types.js").Mandat>>}
   */
  const parCache = new Map();

  await mapLimit(cibles, concurrency, async (c) => {
    try {
      const { file, modifie_le, retelecharge, hash } = await downloadMandat(c.mandat_url, mandatDir);
      const key = path.basename(file);

      if (!parCache.has(key)) {
        parCache.set(
          key,
          (async () => {
            // Réutilisation du relevé précédent, à trois conditions : l'utilisateur ne force pas,
            // le PDF n'a pas changé, et les données sont au format courant. Le test sur
            // `texte_ocr` détecte les relevés produits par une version antérieure, qu'il faut
            // réanalyser pour disposer des champs récents.
            if (!force && !retelecharge && c.mandat?.texte && c.mandat.infos?.departs && "texte_ocr" in c.mandat) {
              return c.mandat;
            }
            const m = await parseMandat(file, { ocr });
            // Chemin relatif, séparateurs normalisés : le JSON doit rester lisible sous Windows
            // comme sous Linux, et ne pas révéler l'arborescence de la machine.
            m.fichier = path.relative(outDir, file).replace(/\\/g, "/");
            return m;
          })()
        );
      }

      const base = await parCache.get(key);

      // Analyse propre à cette épreuve, sur le texte partagé : les dates du concours changent d'une
      // épreuve à l'autre, et avec elles les dates des départs et la limite d'inscription.
      c.mandat = {
        ...base,
        modifie_le,
        hash,
        infos: reextractInfos(base.texte, { date_debut: c.date_debut, date_fin: c.date_fin, texte_ocr: base.texte_ocr }),
      };
      delete c.mandat_erreur; // une tentative précédente a pu échouer

      log(
        `mandat OK ${c.id} (${c.mandat.pages} p.` +
          `${c.mandat.ocr ? ", OCR p." + c.mandat.ocr_pages.join(",") : ""}` +
          `${retelecharge ? ", retéléchargé" : ""})`
      );
    } catch (e) {
      c.mandat_erreur = String(e.message || e);
      log(`  ! erreur mandat ${c.id} : ${c.mandat_erreur}`);
    }
  });

  // Indispensable : Tesseract maintient des processus de travail qui empêcheraient Node de rendre
  // la main. Sans cet appel, le programme resterait suspendu après avoir tout écrit.
  await terminateOcr();
}

/**
 * Exécute une tâche sur chaque élément, en limitant le nombre d'exécutions simultanées.
 *
 * On lance un nombre fixe de « travailleurs » qui puisent tous dans la même file. Chacun prend
 * l'élément suivant dès qu'il a terminé le précédent, ce qui répartit naturellement la charge même
 * si les tâches ont des durées très inégales, ce qui est le cas ici entre un PDF texte lu en
 * quelques millisecondes et un document scanné qui demande plusieurs secondes de reconnaissance.
 *
 * @template T
 * @param {T[]} items éléments à traiter
 * @param {number} limit nombre maximal de tâches simultanées
 * @param {(item: T) => Promise<void>} fn traitement d'un élément
 * @returns {Promise<void>} résolue quand tous les éléments ont été traités
 */
export async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}
