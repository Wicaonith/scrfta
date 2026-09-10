/**
 * @file Extraction du texte d'un mandat PDF, mise en page conservée.
 *
 * ## Le problème à résoudre
 *
 * Un extracteur de texte ordinaire rend un PDF sous forme de flux linéaire : il perd la position
 * des mots, et donc les tableaux. Or les informations les plus utiles d'un mandat sont justement
 * dans des tableaux :
 *
 * ```
 * Tarifs      1 tir     2 tirs
 * Adultes      9 €       16 €
 * Jeunes       7 €       12 €
 * ```
 *
 * Aplati en une ligne, cela donne « Adultes9 €16 € », dont on ne peut plus rien tirer : impossible
 * de savoir que 9 € correspond à un tir et 16 € à deux.
 *
 * ## L'approche retenue
 *
 * pdf.js ne rend pas seulement le texte, il donne aussi la **position de chaque fragment** sur la
 * page. On s'en sert pour reconstruire la structure en deux temps :
 *
 * 1. regrouper les fragments par ligne, selon leur hauteur sur la page ;
 * 2. à l'intérieur d'une ligne, mesurer les écarts horizontaux : un écart important trahit un
 *    changement de colonne, qu'on matérialise par un « | ».
 *
 * Le résultat, « Adultes | 9 € | 16 € », se laisse analyser sans ambiguïté par `mandat.js`.
 *
 * ## Les documents scannés
 *
 * Certains clubs publient une affiche scannée ou exportée en image. Le PDF ne contient alors
 * aucun texte. On détecte ces pages à leur vide, et on les passe à Tesseract, un moteur de
 * reconnaissance de caractères. C'est lent et imparfait, d'où deux précautions : on ne traite
 * que les pages concernées, et on conserve à part le texte ainsi obtenu pour que `mandat.js`
 * puisse marquer comme douteuses les valeurs qui en proviennent.
 */

import fs from "node:fs/promises";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/** Langue de reconnaissance de caractères : les mandats sont en français. */
const OCR_LANG = "fra";

/**
 * Dossier où Tesseract dépose ses données de langue, environ 15 Mo téléchargés une seule fois.
 * Il est exclu du dépôt par `.gitignore`.
 */
const OCR_CACHE = path.resolve(".tessdata");

/**
 * Résultat de la lecture d'un PDF.
 *
 * @typedef {object} TextePdf
 * @property {string} text        Texte complet, pages séparées par une ligne vide
 * @property {number} pages       Nombre de pages
 * @property {boolean} ocr        Vrai si au moins une page a dû passer par la reconnaissance de caractères
 * @property {number[]} ocr_pages Numéros de ces pages, à partir de 1
 * @property {string} ocr_text    Texte des seules pages reconnues, pour juger de la fiabilité en aval
 */

/**
 * Lit un PDF et en extrait le texte en préservant lignes et colonnes.
 *
 * Les pages presque vides de texte sont considérées comme scannées et envoyées à la
 * reconnaissance de caractères, page par page. Le seuil de 80 caractères hors espaces est
 * empirique : une page de mandat réellement rédigée en contient plusieurs centaines, tandis
 * qu'une page-image n'en produit qu'une poignée, venant d'un en-tête ou d'un pied de page.
 *
 * Le résultat de l'OCR n'est retenu que s'il est **plus fourni** que le texte natif : si la
 * reconnaissance échoue, on garde le peu qu'on avait plutôt que de le remplacer par du bruit.
 *
 * @param {string} file chemin du PDF
 * @param {object} [options]
 * @param {boolean} [options.ocr=true] passer les pages scannées à la reconnaissance de caractères.
 *   Mettre à `false` accélère beaucoup et évite le téléchargement de Tesseract, au prix des
 *   documents scannés qui resteront vides. Les tests s'en servent pour rester rapides.
 * @param {number} [options.minCharsPerPage=80] seuil en dessous duquel une page est jugée scannée
 * @returns {Promise<TextePdf>}
 */
export async function extractPdfText(file, { ocr = true, minCharsPerPage = 80 } = {}) {
  const buf = await fs.readFile(file);

  // `verbosity: 0` fait taire les avertissements de pdf.js sur les polices exotiques, fréquents
  // et sans conséquence. `useSystemFonts` améliore la lecture des PDF sans police embarquée.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0, useSystemFonts: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(layoutText(content.items));
  }
  // Libère la mémoire retenue par pdf.js. L'appel optionnel couvre les versions qui ne l'exposent pas.
  await doc.cleanup?.();

  // Repérage des pages sans texte exploitable : ce sont des images.
  const scannedPages = pages
    .map((t, i) => (t.replace(/\s/g, "").length < minCharsPerPage ? i : -1))
    .filter((i) => i >= 0);

  const ocrPages = [];
  const ocrOut = [];
  if (ocr && scannedPages.length) {
    const ocrTexts = await ocrPdf(file, scannedPages);
    for (const i of scannedPages) {
      const t = ocrTexts[i] || "";
      // On ne remplace que si la reconnaissance a produit davantage que ce qu'on avait déjà
      if (t.replace(/\s/g, "").length > pages[i].replace(/\s/g, "").length) {
        pages[i] = t;
        ocrPages.push(i + 1);
        ocrOut.push(t);
      }
    }
  }

  return {
    text: pages.join("\n\n"),
    pages: pages.length,
    ocr: ocrPages.length > 0,
    ocr_pages: ocrPages,
    ocr_text: ocrOut.join("\n\n"),
  };
}

/**
 * Reconstitue lignes et colonnes à partir des fragments positionnés d'une page.
 *
 * ## Ce que fournit pdf.js
 *
 * Chaque élément porte son texte et une matrice de transformation de six nombres, dont les deux
 * derniers donnent la position : `transform[4]` en abscisse, `transform[5]` en ordonnée. Attention,
 * **l'ordonnée croît vers le haut** dans un PDF, contrairement à un écran : le haut de la page a la
 * plus grande valeur. D'où les tris décroissants sur `y`.
 *
 * ## Regroupement en lignes
 *
 * Deux fragments appartiennent à la même ligne si leur écart vertical est inférieur à la moitié de
 * la hauteur de police. Cette tolérance est nécessaire : dans un même paragraphe, les fragments ne
 * sont pas parfaitement alignés, un accent ou un changement de casse suffit à décaler de un ou deux
 * points. Le plancher de 3 points protège les très petites polices, où la moitié de la hauteur
 * deviendrait trop stricte.
 *
 * L'ordonnée de la ligne est recalculée en moyenne au fur et à mesure. Sans cela, une ligne
 * légèrement penchée finirait par se scinder en deux : chaque nouveau fragment est comparé au
 * centre de gravité de la ligne, pas à son premier mot.
 *
 * ## Détection des colonnes
 *
 * Dans une ligne, on mesure l'espace entre la fin d'un mot et le début du suivant, et on le compare
 * à la taille de police :
 *
 * | Écart                        | Interprétation      | Rendu   |
 * | ---------------------------- | ------------------- | ------- |
 * | plus de 1,5 fois la police   | changement de colonne | ` \| ` |
 * | plus de 0,12 fois la police  | espace entre deux mots | ` `    |
 * | en dessous                   | mots collés           | rien    |
 *
 * Rapporter les seuils à la taille de police est essentiel : dans un titre en corps 24, un espace
 * ordinaire mesure déjà plus qu'un saut de colonne en corps 8. Un seuil en points absolus
 * découperait les titres en colonnes imaginaires.
 *
 * Le seuil bas de 0,12 peut surprendre par sa petitesse. Il est volontairement bas parce que pdf.js
 * découpe parfois un mot en plusieurs fragments jointifs, par exemple « 18 » puis « m » : le moindre
 * espace inséré à tort produirait « 18 m » et fausserait la détection des distances.
 *
 * @param {Array<{str: string, transform: number[], width: number, height?: number}>} items
 *        fragments renvoyés par `page.getTextContent()`
 * @returns {string} le texte de la page, une ligne par ligne, colonnes séparées par « | »
 */
export function layoutText(items) {
  // Normalisation : on ne garde que les fragments visibles, avec leur géométrie.
  // La hauteur manque parfois ; on se rabat alors sur l'échelle verticale de la matrice,
  // puis sur 8 points, une taille de corps de texte courante.
  const words = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: it.height || Math.abs(it.transform[3]) || 8,
    }));
  if (!words.length) return "";

  // Tri de haut en bas, puis de gauche à droite : les fragments arrivent dans l'ordre du flux
  // du document, qui ne correspond pas forcément à l'ordre de lecture.
  words.sort((a, b) => b.y - a.y || a.x - b.x);

  /** @type {{y: number, words: typeof words}[]} */
  const lines = [];
  for (const w of words) {
    const line = lines.find((l) => Math.abs(l.y - w.y) < Math.max(3, w.h * 0.5));
    if (line) {
      line.words.push(w);
      // Moyenne mobile de l'ordonnée : la ligne suit une éventuelle inclinaison
      line.y = (line.y * (line.words.length - 1) + w.y) / line.words.length;
    } else {
      lines.push({ y: w.y, words: [w] });
    }
  }
  // Les moyennes ont pu modifier l'ordre : on retrie du haut vers le bas
  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((l) => {
      l.words.sort((a, b) => a.x - b.x);
      let out = "";
      let prevEnd = null; // abscisse de fin du mot précédent
      for (const w of l.words) {
        if (prevEnd !== null) {
          const gap = w.x - prevEnd;
          const fontSize = w.h || 8;
          if (gap > fontSize * 1.5) out += " | ";
          else if (gap > fontSize * 0.12) out += " ";
          // en dessous : rien, les fragments sont jointifs
        }
        out += w.str;
        prevEnd = w.x + w.w;
      }
      // Une cellule vide produirait « | | » ; on la réduit à un seul séparateur
      return out.replace(/\s+\|\s+\|/g, " |").trim();
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Instance unique du moteur de reconnaissance, partagée par tout le processus.
 *
 * Démarrer un moteur Tesseract coûte plusieurs secondes et charge les données de langue en
 * mémoire. On la crée donc au premier besoin seulement, et on la réutilise ensuite pour tous les
 * mandats du relevé. La promesse est mémorisée plutôt que l'instance, ce qui évite que deux
 * appels simultanés lancent deux initialisations concurrentes.
 *
 * @type {Promise<import("tesseract.js").Worker>|null}
 */
let ocrWorkerPromise = null;

/**
 * Renvoie le moteur de reconnaissance, en le démarrant au premier appel.
 *
 * `tesseract.js` est importé dynamiquement : la bibliothèque est lourde, et la majorité des
 * relevés n'en a aucun besoin. L'import à la demande évite de la charger pour rien.
 *
 * @returns {Promise<import("tesseract.js").Worker>}
 */
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      await fs.mkdir(OCR_CACHE, { recursive: true });
      // Le second argument, 1, demande le moteur le plus précis. Le journal est réduit au silence.
      return createWorker(OCR_LANG, 1, { cachePath: OCR_CACHE, logger: () => {} });
    })();
  }
  return ocrWorkerPromise;
}

/**
 * Arrête le moteur de reconnaissance s'il tourne.
 *
 * **À appeler avant de terminer le programme** : le moteur maintient des processus de travail
 * qui empêcheraient Node de rendre la main. `analyse.js` s'en charge en fin de traitement.
 *
 * @returns {Promise<void>}
 */
export async function terminateOcr() {
  if (ocrWorkerPromise) {
    const w = await ocrWorkerPromise;
    await w.terminate();
    ocrWorkerPromise = null;
  }
}

/**
 * Rend les pages demandées en image puis les soumet à la reconnaissance de caractères.
 *
 * L'agrandissement à 2,5 fois est un compromis : en dessous, les petits caractères deviennent
 * illisibles pour Tesseract ; au-dessus, le temps de traitement grimpe sans gain de qualité.
 *
 * @param {string} file chemin du PDF
 * @param {number[]|null} [pageIndexes=null] indices des pages à traiter, à partir de 0.
 *   `null` traite toutes les pages.
 * @returns {Promise<string[]>} texte reconnu, indexé par numéro de page à partir de 0.
 *   Les pages non traitées laissent un trou dans le tableau.
 */
export async function ocrPdf(file, pageIndexes = null) {
  const { pdf } = await import("pdf-to-img");
  const worker = await getOcrWorker();
  const doc = await pdf(file, { scale: 2.5 });

  const out = [];
  let i = 0;
  // `pdf-to-img` expose les pages sous forme de flux asynchrone : le rendu est fait à la demande,
  // ce qui évite de charger toutes les images en mémoire d'un coup.
  for await (const image of doc) {
    if (!pageIndexes || pageIndexes.includes(i)) {
      const { data } = await worker.recognize(image);
      out[i] = data.text.trim();
    }
    i++;
  }
  return out;
}
