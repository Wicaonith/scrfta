#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { BASE_URL, LIST_PATH, DEFAULT_REGION, estInterne } from "./config.js";
import { resoudreFiltres, aideFiltres } from "./filtres.js";
import { parseDates } from "./dates.js";
import { analyseMandats } from "./analyse.js";
import { writeOutputs, completerCompetitions, chargerPrecedent } from "./output.js";
import { archiver } from "./historique.js";
import { genererRapport } from "./rapport.js";

// ---------------------------------------------------------------- CLI
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node src/scrape.js [options]

Filtres de la page ffta.fr/competitions :
  --region "<nom>"     Une ou plusieurs régions séparées par des virgules (défaut : "${DEFAULT_REGION}"),
                       ou "france" pour tout le calendrier
  --dep 44,49          Numéros de départements (remplace --region)
  --start YYYY-MM-DD   Date de début (défaut : aujourd'hui)
  --end YYYY-MM-DD     Date de fin (défaut : +1 an)
  --discipline <code>  salle, tae, campagne, 3d, nature, beursault, run_archery, jeunes, loisir… (ou libellé ffta.fr)
  --univers <code>     cibles, parcours, para, run_archery, beursault
  --search "<texte>"   Recherche libre (titre, club, ville)
  --restreint [0|1]    Calendrier restreint uniquement (1) ou exclu (0)
  --sort desc          Ordre décroissant de date
  --list-filters       Affiche toutes les valeurs acceptées et quitte

Traitement :
  --limit N            Ne traiter que N compétitions (debug)
  --no-details         Ne pas visiter les fiches /epreuve/<id>
  --inclure-internes   Garder les concours internes (« INTERNE » dans le titre), exclus par défaut
  --no-mandats         Ne pas télécharger ni analyser les mandats PDF
  --no-ocr             Ne pas passer les pages scannées des mandats à l'OCR (Tesseract)
  --no-rapport         Ne pas archiver le snapshot du jour ni régénérer output/rapport/index.html
  --headed            Lancer le navigateur visible (utile si Cloudflare bloque le mode headless)
  --browser <name>     chromium (défaut) | chrome | msedge
  --out <dir>          Dossier de sortie (défaut : output)
`);
  process.exit(0);
}
if (args["list-filters"]) {
  console.log(aideFiltres());
  process.exit(0);
}

const outDir = path.resolve(args.out || "output");
await fs.mkdir(path.join(outDir, "mandats"), { recursive: true });

let filtres;
try {
  filtres = resoudreFiltres(args);
} catch (e) {
  console.error(e.message);
  console.error("Utilisez --list-filters pour voir les valeurs acceptées.");
  process.exit(1);
}
const { depIds, params } = filtres;
log(`Filtres : ${JSON.stringify(filtres.description)}`);

// ---------------------------------------------------------------- Navigateur
const browser = await chromium.launch({
  headless: !args.headed,
  channel: args.browser && args.browser !== "chromium" ? args.browser : undefined,
});
const context = await browser.newContext({
  locale: "fr-FR",
  viewport: { width: 1280, height: 900 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
});
// On bloque les ressources inutiles pour aller plus vite
await context.route(/\.(png|jpe?g|gif|svg|woff2?|css)(\?.*)?$/, (r) => r.abort());
const page = await context.newPage();

try {
  // ---------------------------------------------------------------- Liste
  let competitions = await scrapeList(page, depIds, params);
  log(`${competitions.length} compétitions trouvées`);
  if (!args["inclure-internes"]) {
    const internes = competitions.filter(estInterne);
    competitions = competitions.filter((c) => !estInterne(c));
    if (internes.length) log(`${internes.length} concours internes exclus : ${internes.map((c) => c.id).join(", ")}`);
  }

  const selection = args.limit ? competitions.slice(0, Number(args.limit)) : competitions;

  // ---------------------------------------------------------------- Détails
  if (!args["no-details"]) {
    for (const [i, c] of selection.entries()) {
      log(`[${i + 1}/${selection.length}] détail ${c.id} - ${c.titre}`);
      try {
        c.detail = await scrapeDetail(page, c.url);
        if (!c.mandat_url && c.detail.mandat_url) c.mandat_url = c.detail.mandat_url;
      } catch (e) {
        c.detail_erreur = String(e.message || e);
        log(`  ! erreur détail : ${c.detail_erreur}`);
      }
      await sleep(300);
    }
  }

  await browser.close();
  completerCompetitions(selection, await chargerPrecedent(outDir));

  // ---------------------------------------------------------------- Mandats
  if (!args["no-mandats"]) {
    await analyseMandats(selection, { outDir, ocr: !args["no-ocr"], log });
  }

  // ---------------------------------------------------------------- Sorties
  const files = await writeOutputs(
    outDir,
    { filtres: filtres.description, parametres: { dep: depIds, ...params } },
    selection
  );
  log(`Écrit : ${files.jsonFile}`);
  log(`Écrit : ${files.csvFile}`);

  // ---------------------------------------------------------------- Historique et rapport
  if (!args["no-rapport"] && !args.limit && files.jsonFile.endsWith("competitions.json")) {
    log(`Snapshot : ${await archiver(outDir)}`);
    await genererRapport(outDir, log);
  }
} finally {
  await browser.close().catch(() => {});
}

// ================================================================ Fonctions

async function gotoAndWait(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Challenge Cloudflare : on attend que le contenu réel apparaisse
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const title = await page.title();
    if (!/just a moment|un instant/i.test(title)) return;
    await sleep(1000);
  }
  throw new Error("Bloqué par le challenge Cloudflare (essayez --headed ou --browser chrome)");
}

function listUrl(depIds, pageNum, params) {
  const u = new URL(LIST_PATH, BASE_URL);
  depIds.forEach((d) => u.searchParams.append("dep[]", d));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("page", String(pageNum));
  return u.toString();
}

async function scrapeList(page, depIds, params) {
  const all = [];
  const seen = new Set();
  let pageNum = 0;
  let lastPage = 0;
  do {
    const url = listUrl(depIds, pageNum, params);
    log(`liste page ${pageNum + 1}${lastPage ? "/" + (lastPage + 1) : ""} : ${url}`);
    await gotoAndWait(page, url);
    await page.waitForSelector("article.competition_item, .view-empty, .view-competitions", { timeout: 30000 });

    const { items, maxPage } = await page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
      const items = [...document.querySelectorAll("article.competition_item")].map((a) => {
        const titleLink = a.querySelector(".competition_item__title a");
        const infos = a.querySelector(".competition_item__infos");
        const orgSpan = infos
          ? [...infos.querySelectorAll(":scope > span")].find((s) => !s.querySelector(".field"))
          : null;
        const ville = orgSpan?.querySelector("small");
        const head = a.querySelector(".competition_item__head");
        const statut =
          [...(head?.classList || [])]
            .find((c) => c.startsWith("competition_item__head--"))
            ?.replace("competition_item__head--", "") || null;
        const univers = (a.getAttribute("style") || "").match(/var\(--([\w-]+)\)/)?.[1] || null;
        const mail = a.querySelector('a[href^="mailto:"]');
        const site = [...a.querySelectorAll(".competition_item__infos a[href^='http']")].find(
          (l) => l.textContent.trim() === "Site"
        );
        const mandat = a.querySelector(".competition_item__mandat_btn");
        return {
          id: (titleLink?.getAttribute("href") || "").match(/\d+/)?.[0] || null,
          url: titleLink ? new URL(titleLink.getAttribute("href"), location.origin).href : null,
          titre: txt(titleLink),
          dates_texte: txt(a.querySelector(".competition_item__dates")),
          statut,
          univers,
          discipline: txt(a.querySelector(".field--name-field-discipline")),
          type: txt(a.querySelector(".field--name-field-type-championnat")),
          organisateur: orgSpan ? orgSpan.childNodes[0]?.textContent.trim() : null,
          ville: txt(ville)?.replace(/^\(|\)$/g, "") || null,
          email: mail ? mail.getAttribute("href").replace("mailto:", "") : null,
          site: site ? site.getAttribute("href") : null,
          mandat_url: mandat ? mandat.getAttribute("href") : null,
          pictos: [...a.querySelectorAll(".competition_item__pictos *")].map(
            (p) => p.getAttribute("title") || p.className
          ),
        };
      });
      const pages = [...document.querySelectorAll(".pager__item a")]
        .map((l) => Number((l.getAttribute("href") || "").match(/page=(\d+)/)?.[1]))
        .filter((n) => !Number.isNaN(n));
      return { items, maxPage: pages.length ? Math.max(...pages) : 0 };
    });

    lastPage = maxPage;
    let added = 0;
    for (const it of items) {
      if (!it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      const d = parseDates(it.dates_texte);
      all.push({ ...it, date_debut: d.debut, date_fin: d.fin });
      added++;
    }
    log(`  ${items.length} éléments, ${added} nouveaux`);
    if (items.length === 0) break;
    pageNum++;
    await sleep(300);
  } while (pageNum <= lastPage);
  return all;
}

async function scrapeDetail(page, url) {
  await gotoAndWait(page, url);
  await page.waitForSelector("article.competition_detail", { timeout: 30000 });
  return page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
    const slug = (s) =>
      s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
    const art = document.querySelector("article.competition_detail");
    const out = {
      dates_texte: txt(art.querySelector(".competition_detail__dates")),
      statut: txt(art.querySelector(".competition_detail__badge")),
      mandat_url: art.querySelector(".competition_detail__mandat_btn")?.getAttribute("href") || null,
      champs: {},
      adresse: [],
      contacts: {},
      documents: [],
    };
    for (const p of art.querySelectorAll(".competition_detail__infos p")) {
      const t = txt(p);
      const m = t.match(/^([^:]+?)\s*:\s*(.+)$/);
      if (m) out.champs[slug(m[1])] = m[2].trim();
      else if (t) out.adresse.push(t.replace(/&apos;/g, "'"));
    }
    for (const div of art.querySelectorAll(".competition_detail__links > div")) {
      const a = div.querySelector("a");
      const label = slug(div.childNodes[0]?.textContent || txt(div));
      if (a) out.contacts[label] = a.getAttribute("href").replace(/^(mailto|tel):/, "");
    }
    for (const a of art.querySelectorAll(".associated-documents a[href], .associated-components a[href]")) {
      out.documents.push({ titre: txt(a), url: new URL(a.getAttribute("href"), location.origin).href });
    }
    return out;
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

function log(msg) {
  console.error(`[${new Date().toLocaleTimeString("fr-FR")}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
