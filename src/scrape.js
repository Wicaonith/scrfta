#!/usr/bin/env node
/**
 * @file Point d'entrée : collecte le calendrier fédéral et produit les fichiers de sortie.
 *
 * ## Pourquoi un navigateur plutôt que de simples requêtes
 *
 * `www.ffta.fr` est protégé par Cloudflare. Une requête HTTP ordinaire ne reçoit pas les données
 * mais une page « Just a moment… » contenant un défi JavaScript à résoudre. Seul un vrai moteur de
 * navigateur peut le franchir.
 *
 * On pilote donc un Chromium invisible avec Playwright. C'est plus lourd qu'un simple appel réseau,
 * mais c'est la seule voie praticable, et cela explique le poids du projet à l'installation.
 *
 * Bonne nouvelle en revanche : le serveur des mandats, `extranet.ffta.fr`, n'est pas protégé. Les
 * PDF se téléchargent normalement, sans navigateur.
 *
 * ## Déroulement
 *
 * ```
 * filtres → liste paginée → fiches détaillées → [fermeture du navigateur]
 *         → enrichissement → mandats → regroupement → JSON + CSV → archive + rapport
 * ```
 *
 * Le navigateur est fermé dès la fin de la collecte : l'analyse des mandats et l'écriture des
 * fichiers n'en ont pas besoin, et il consomme plusieurs centaines de méga-octets de mémoire.
 *
 * ## Codes de retour
 *
 * - `0` : tout s'est bien passé ;
 * - `1` : filtre invalide, ou **relevé suspect** — aucun concours trouvé, ou nombre divisé par plus
 *   de deux depuis le relevé précédent. C'est le signal d'alerte destiné à une exécution planifiée :
 *   le jour où la FFTA modifiera son site, la tâche échouera et enverra un courriel, au lieu de
 *   publier silencieusement des relevés vides.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { BASE_URL, LIST_PATH, DEFAULT_REGION, estInterne } from "./config.js";
import { resoudreFiltres, aideFiltres } from "./filtres.js";
import { parseDates } from "./dates.js";
import { analyseMandats } from "./analyse.js";
import { writeOutputs, completerCompetitions, chargerPrecedent, regrouperConcours } from "./output.js";
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
  --no-rapport         Ne pas archiver le relevé du jour ni régénérer output/rapport/index.html
  --zero-ok            Ne pas sortir en erreur si aucun concours n'est trouvé (filtres volontairement étroits)
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

  // ---------------------------------------------------------------- Alerte
  // Un scrapper casse silencieusement quand le site change : mieux vaut un code d'erreur
  // que dix relevés vides publiés sans que personne ne s'en aperçoive.
  const precedent = await chargerPrecedent(outDir);
  if (!args["zero-ok"] && !args.limit) {
    if (competitions.length === 0) {
      log("! ALERTE : aucun concours trouvé.");
      log("  Soit les filtres sont trop restrictifs, soit la structure du site a changé.");
      log("  Ajoutez --zero-ok si ce résultat est normal.");
      process.exitCode = 1;
    } else if (precedent.size >= 10 && competitions.length < precedent.size / 2) {
      log(`! ALERTE : ${competitions.length} concours trouvés, contre ${precedent.size} au relevé précédent.`);
      log("  Vérifiez le site avant d'utiliser ce relevé. Normal si vous avez changé de filtres.");
      log("  Ajoutez --zero-ok pour ignorer.");
      process.exitCode = 1;
    }
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
  completerCompetitions(selection, precedent);

  // ---------------------------------------------------------------- Mandats
  if (!args["no-mandats"]) {
    await analyseMandats(selection, { outDir, ocr: !args["no-ocr"], log });
  }

  regrouperConcours(selection);

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

/**
 * Ouvre une page et attend que Cloudflare ait rendu la main.
 *
 * Le défi anti-robot affiche d'abord une page intitulée « Just a moment… », puis redirige vers le
 * contenu réel une fois le calcul effectué, en général en deux à cinq secondes. On surveille donc
 * le titre de la page plutôt qu'un événement réseau, qui se déclencherait sur la page d'attente.
 *
 * Quarante-cinq secondes de patience : très au-delà du délai habituel, pour absorber une connexion
 * lente sans faire échouer un relevé de plusieurs minutes.
 *
 * @param {import("playwright").Page} page
 * @param {string} url
 * @returns {Promise<void>}
 * @throws {Error} si le défi n'est pas franchi dans le délai
 */
async function gotoAndWait(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const title = await page.title();
    if (!/just a moment|un instant/i.test(title)) return;
    await sleep(1000);
  }
  throw new Error("Bloqué par le challenge Cloudflare (essayez --headed ou --browser chrome)");
}

/**
 * Compose l'adresse d'une page de résultats.
 *
 * Les départements se transmettent en paramètres répétés `dep[]`, syntaxe des tableaux attendue par
 * Drupal, d'où l'usage de `append` et non de `set` pour cette clé.
 *
 * @param {string[]} depIds identifiants ffta.fr des départements ; vide signifie « toute la France »
 * @param {number} pageNum numéro de page, à partir de 0
 * @param {Object<string, string>} params autres filtres
 * @returns {string}
 */
function listUrl(depIds, pageNum, params) {
  const u = new URL(LIST_PATH, BASE_URL);
  depIds.forEach((d) => u.searchParams.append("dep[]", d));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("page", String(pageNum));
  return u.toString();
}

/**
 * Parcourt toutes les pages de résultats et en extrait les vignettes de concours.
 *
 * ## Pagination
 *
 * Le nombre total de pages n'est pas annoncé : on le déduit des liens de pagination présents en bas
 * de page, et on met à jour cette borne à chaque tour. On s'arrête aussi dès qu'une page ne renvoie
 * rien, garde-fou contre une boucle infinie si la pagination changeait de forme.
 *
 * ## Dédoublonnage
 *
 * Un ensemble d'identifiants déjà vus protège des doublons. Ils surviennent réellement : entre deux
 * requêtes, le site peut réordonner ses résultats, et une même épreuve se retrouve alors sur deux
 * pages consécutives.
 *
 * ## Politesse
 *
 * Trois cents millisecondes entre deux pages. Le relevé complet reste rapide, et la charge sur le
 * serveur fédéral reste négligeable.
 *
 * @param {import("playwright").Page} page
 * @param {string[]} depIds
 * @param {Object<string, string>} params
 * @returns {Promise<import("./types.js").Competition[]>} concours de toutes les pages, dédoublonnés
 */
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

    // Le code qui suit s'exécute **dans le navigateur**, pas dans Node : il n'a accès ni aux
    // variables de ce fichier ni aux modules du projet, et ne peut renvoyer que des données
    // sérialisables. D'où les fonctions utilitaires redéfinies sur place.
    const { items, maxPage } = await page.evaluate(() => {
      /** Texte d'un élément, espaces normalisés. */
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
      const items = [...document.querySelectorAll("article.competition_item")].map((a) => {
        const titleLink = a.querySelector(".competition_item__title a");
        const infos = a.querySelector(".competition_item__infos");

        // L'organisateur occupe le seul span sans sous-élément `.field` : les autres portent la
        // discipline et le type de championnat, qui ont leur propre balisage.
        const orgSpan = infos
          ? [...infos.querySelectorAll(":scope > span")].find((s) => !s.querySelector(".field"))
          : null;
        const ville = orgSpan?.querySelector("small");

        // Le statut n'est pas écrit : il est encodé dans une classe CSS, du type
        // `competition_item__head--valid`. On isole le suffixe.
        const head = a.querySelector(".competition_item__head");
        const statut =
          [...(head?.classList || [])]
            .find((c) => c.startsWith("competition_item__head--"))
            ?.replace("competition_item__head--", "") || null;

        // L'univers non plus n'est pas écrit : il se lit dans la variable CSS qui colore la
        // vignette, `--universColor: var(--traditionnel)`.
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
      // Numéro de la dernière page, lu dans les liens de pagination
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
      // Conversion des dates ici plutôt que dans le navigateur : `parseDates` est un module du
      // projet, inaccessible depuis le contexte de la page.
      const d = parseDates(it.dates_texte);
      all.push({ ...it, date_debut: d.debut, date_fin: d.fin });
      added++;
    }
    log(`  ${items.length} éléments, ${added} nouveaux`);

    if (items.length === 0) break; // garde-fou contre une boucle sans fin
    pageNum++;
    await sleep(300);
  } while (pageNum <= lastPage);

  return all;
}

/**
 * Lit la fiche détaillée d'une épreuve.
 *
 * La fiche apporte ce qui manque à la vignette : championnat de rattachement, comités régional et
 * départemental, adresse complète du lieu de tir, téléphone, et parfois un lien de mandat absent
 * de la liste.
 *
 * ## Une lecture volontairement générique
 *
 * Les informations sont présentées en paragraphes « Libellé : valeur ». Plutôt que de chercher des
 * libellés connus, on transforme chaque libellé rencontré en clé normalisée : « Comité régional »
 * devient `comite_regional`. Si la fédération ajoute un champ demain, il apparaîtra tout seul dans
 * les données au lieu d'être ignoré.
 *
 * Les paragraphes sans deux-points sont considérés comme des lignes d'adresse, ce qui correspond à
 * la mise en page du site.
 *
 * @param {import("playwright").Page} page
 * @param {string} url adresse de la fiche
 * @returns {Promise<import("./types.js").Detail>}
 */
async function scrapeDetail(page, url) {
  await gotoAndWait(page, url);
  await page.waitForSelector("article.competition_detail", { timeout: 30000 });

  // Exécuté dans le navigateur : voir la remarque dans `scrapeList`
  return page.evaluate(() => {
    /** Texte d'un élément, espaces normalisés. */
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);

    /** Transforme un libellé en clé exploitable : « Comité régional » → `comite_regional`. */
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
    // « Libellé : valeur » devient un champ ; le reste est traité comme une ligne d'adresse.
    // Le remplacement de `&apos;` corrige une entité HTML que le site laisse parfois échapper
    // dans ses adresses, du type « Jeu d&apos;arc ».
    for (const p of art.querySelectorAll(".competition_detail__infos p")) {
      const t = txt(p);
      const m = t.match(/^([^:]+?)\s*:\s*(.+)$/);
      if (m) out.champs[slug(m[1])] = m[2].trim();
      else if (t) out.adresse.push(t.replace(/&apos;/g, "'"));
    }

    // Contacts : le libellé précède le lien (« Tel » puis le numéro). On retire le préfixe
    // `mailto:` ou `tel:` pour ne garder que la valeur utile.
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

/**
 * Analyse les arguments de la ligne de commande.
 *
 * Deux formes acceptées : `--option valeur` donne la chaîne, `--option` seule donne `true`. Cela
 * suffit aux besoins du projet et évite d'ajouter une dépendance pour si peu.
 *
 * Tout ce qui ne commence pas par deux tirets est ignoré : il n'y a pas d'argument positionnel.
 *
 * @param {string[]} argv arguments, sans le nom du programme
 * @returns {Object<string, string|boolean>}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++; // la valeur est consommée, on ne la relit pas comme une option
    } else out[key] = true;
  }
  return out;
}

/**
 * Journalise une étape, horodatée.
 *
 * **Sur la sortie d'erreur, volontairement.** La sortie standard reste ainsi libre pour un usage
 * futur en tube, et sous cron le journal se sépare naturellement du résultat.
 *
 * @param {string} msg
 */
function log(msg) {
  console.error(`[${new Date().toLocaleTimeString("fr-FR")}] ${msg}`);
}

/**
 * Attend un délai donné.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
