#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { BASE_URL, LIST_PATH, REGIONS, DEPARTEMENTS, DEFAULT_REGION } from "./config.js";
import { parseDates } from "./dates.js";
import { analyseMandats } from "./analyse.js";
import { writeOutputs } from "./output.js";

// ---------------------------------------------------------------- CLI
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node src/scrape.js [options]

  --region "<nom>"     Région à filtrer (défaut : "${DEFAULT_REGION}").
                       Régions : ${Object.keys(REGIONS).join(", ")}
  --dep 45,50          Ids ffta.fr de départements (remplace --region)
  --start YYYY-MM-DD   Date de début (défaut : aujourd'hui)
  --end YYYY-MM-DD     Date de fin (défaut : +1 an)
  --discipline <id>    Id de discipline ffta.fr (103 = 18m, 102 = TAE, 107 = campagne, 108 = 3D, 109 = nature, 110 = beursault...)
  --limit N            Ne traiter que N compétitions (debug)
  --no-details         Ne pas visiter les fiches /epreuve/<id>
  --no-mandats         Ne pas télécharger ni analyser les mandats PDF
  --no-ocr             Ne pas passer les pages scannées des mandats à l'OCR (Tesseract)
  --llm                Structurer chaque mandat avec Claude (nécessite ANTHROPIC_API_KEY)
  --headed            Lancer le navigateur visible (utile si Cloudflare bloque le mode headless)
  --browser <name>     chromium (défaut) | chrome | msedge
  --out <dir>          Dossier de sortie (défaut : output)
`);
  process.exit(0);
}

const outDir = path.resolve(args.out || "output");
await fs.mkdir(path.join(outDir, "mandats"), { recursive: true });

const regionName = args.region || DEFAULT_REGION;
const depIds = args.dep ? String(args.dep).split(",") : REGIONS[regionName];
if (!depIds) {
  console.error(`Région inconnue : ${regionName}. Régions disponibles : ${Object.keys(REGIONS).join(", ")}`);
  process.exit(1);
}

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
  const competitions = await scrapeList(page, depIds, args);
  log(`${competitions.length} compétitions trouvées`);

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

  // ---------------------------------------------------------------- Mandats
  if (!args["no-mandats"]) {
    await analyseMandats(selection, { outDir, ocr: !args["no-ocr"], llm: !!args.llm, log });
  }

  // ---------------------------------------------------------------- Sorties
  const files = await writeOutputs(
    outDir,
    { region: args.dep ? null : regionName, departements: depIds.map((d) => DEPARTEMENTS[d] || d) },
    selection
  );
  log(`Écrit : ${files.jsonFile}`);
  log(`Écrit : ${files.csvFile}`);
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

function listUrl(depIds, pageNum, args) {
  const u = new URL(LIST_PATH, BASE_URL);
  depIds.forEach((d) => u.searchParams.append("dep[]", d));
  if (args.start) u.searchParams.set("start", args.start);
  if (args.end) u.searchParams.set("end", args.end);
  if (args.discipline) u.searchParams.set("discipline", args.discipline);
  u.searchParams.set("page", String(pageNum));
  return u.toString();
}

async function scrapeList(page, depIds, args) {
  const all = [];
  const seen = new Set();
  let pageNum = 0;
  let lastPage = 0;
  do {
    const url = listUrl(depIds, pageNum, args);
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
