import path from "node:path";
import { downloadMandat, parseMandat, reextractInfos } from "./mandat.js";
import { terminateOcr } from "./pdf.js";

/**
 * Télécharge et analyse (texte + OCR + heuristiques) les mandats des compétitions passées en paramètre.
 * Modifie les objets en place.
 *
 * options : { outDir, ocr = true, force = false, concurrency = 3, log }
 */
export async function analyseMandats(competitions, { outDir, ocr = true, force = false, concurrency = 3, log = () => {} }) {
  const mandatDir = path.join(outDir, "mandats");
  const cibles = competitions.filter((c) => c.mandat_url);
  // Un même PDF peut servir plusieurs épreuves : on l'analyse une seule fois
  const parCache = new Map();

  await mapLimit(cibles, concurrency, async (c) => {
    try {
      const { file, modifie_le, retelecharge, hash } = await downloadMandat(c.mandat_url, mandatDir);
      const key = path.basename(file);
      if (!parCache.has(key)) {
        parCache.set(
          key,
          (async () => {
            // Déjà analysé (format courant) et PDF inchangé : on réutilise
            if (!force && !retelecharge && c.mandat?.texte && c.mandat.infos?.departs && "texte_ocr" in c.mandat) return c.mandat;
            const m = await parseMandat(file, { ocr });
            m.fichier = path.relative(outDir, file).replace(/\\/g, "/");
            return m;
          })()
        );
      }
      const base = await parCache.get(key);
      // Les départs et dates limites dépendent des dates de l'épreuve : recalcul par compétition
      c.mandat = {
        ...base,
        modifie_le,
        hash,
        infos: reextractInfos(base.texte, { date_debut: c.date_debut, date_fin: c.date_fin, texte_ocr: base.texte_ocr }),
      };
      delete c.mandat_erreur;
      log(`mandat OK ${c.id} (${c.mandat.pages} p.${c.mandat.ocr ? ", OCR p." + c.mandat.ocr_pages.join(",") : ""}${retelecharge ? ", retéléchargé" : ""})`);
    } catch (e) {
      c.mandat_erreur = String(e.message || e);
      log(`  ! erreur mandat ${c.id} : ${c.mandat_erreur}`);
    }
  });

  await terminateOcr();
}

export async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}
