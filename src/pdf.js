import fs from "node:fs/promises";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const OCR_LANG = "fra";
const OCR_CACHE = path.resolve(".tessdata");

/**
 * Extrait le texte d'un PDF en respectant la mise en page :
 * les mots sont regroupés par ligne (coordonnée y) puis triés par x,
 * et les colonnes éloignées sont séparées par " | " pour reconstituer les tableaux.
 * Si le PDF contient trop peu de texte (document scanné), on bascule sur l'OCR.
 */
export async function extractPdfText(file, { ocr = true, minCharsPerPage = 80 } = {}) {
  const buf = await fs.readFile(file);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(layoutText(content.items));
  }
  await doc.cleanup?.();

  // Pages (quasi) vides de texte = pages scannées ou images : on les passe à l'OCR une par une
  const scannedPages = pages
    .map((t, i) => (t.replace(/\s/g, "").length < minCharsPerPage ? i : -1))
    .filter((i) => i >= 0);

  const ocrPages = [];
  const ocrOut = [];
  if (ocr && scannedPages.length) {
    const ocrTexts = await ocrPdf(file, scannedPages);
    for (const i of scannedPages) {
      const t = ocrTexts[i] || "";
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

/** Regroupe les items pdf.js en lignes puis en colonnes. */
function layoutText(items) {
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

  // Regroupement par ligne : deux mots sont sur la même ligne si |dy| < moitié de la hauteur
  words.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const w of words) {
    const line = lines.find((l) => Math.abs(l.y - w.y) < Math.max(3, w.h * 0.5));
    if (line) {
      line.words.push(w);
      line.y = (line.y * (line.words.length - 1) + w.y) / line.words.length;
    } else lines.push({ y: w.y, words: [w] });
  }
  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((l) => {
      l.words.sort((a, b) => a.x - b.x);
      let out = "";
      let prevEnd = null;
      for (const w of l.words) {
        if (prevEnd !== null) {
          const gap = w.x - prevEnd;
          const fontSize = w.h || 8;
          if (gap > fontSize * 1.5) out += " | "; // saut de colonne
          else if (gap > fontSize * 0.12) out += " ";
        }
        out += w.str;
        prevEnd = w.x + w.w;
      }
      return out.replace(/\s+\|\s+\|/g, " |").trim();
    })
    .filter(Boolean)
    .join("\n");
}

let ocrWorkerPromise = null;
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      await fs.mkdir(OCR_CACHE, { recursive: true });
      return createWorker(OCR_LANG, 1, { cachePath: OCR_CACHE, logger: () => {} });
    })();
  }
  return ocrWorkerPromise;
}

export async function terminateOcr() {
  if (ocrWorkerPromise) {
    const w = await ocrWorkerPromise;
    await w.terminate();
    ocrWorkerPromise = null;
  }
}

/**
 * Rend les pages demandées (indices 0-based, toutes si omis) en image puis les passe à Tesseract (français).
 * Retourne un tableau indexé par numéro de page.
 */
export async function ocrPdf(file, pageIndexes = null) {
  const { pdf } = await import("pdf-to-img");
  const worker = await getOcrWorker();
  const doc = await pdf(file, { scale: 2.5 });
  const out = [];
  let i = 0;
  for await (const image of doc) {
    if (!pageIndexes || pageIndexes.includes(i)) {
      const { data } = await worker.recognize(image);
      out[i] = data.text.trim();
    }
    i++;
  }
  return out;
}
