/**
 * @file Téléchargement des mandats et extraction des informations qu'ils contiennent.
 *
 * ## Ce qu'est un mandat, et pourquoi c'est difficile
 *
 * Le mandat est l'invitation qu'un club rédige pour annoncer son concours : horaires, tarifs,
 * modalités d'inscription, plan d'accès. La FFTA le publie tel quel, sans imposer de forme.
 *
 * Résultat : deux mandats ne se ressemblent pas. Les mêmes tarifs s'écrivent au choix
 *
 * ```
 * Tarifs | 1 tir | 2 tirs        Adulte | Jeune         1 départ : Adultes : 12 € - Jeunes 7 €
 * Adultes |  9 € |  16 €         1 tir | 9 € | 7 €      2 départs : Adultes : 18 € - Jeunes 12 €
 * Jeunes  |  7 € |  12 €         2 tirs | 16 € | 12 €
 * ```
 *
 * Il n'existe donc pas de règle unique, seulement un faisceau d'heuristiques, chacune traitant une
 * mise en page rencontrée dans la réalité. Le fichier `test/fixtures/mandats.js` reproduit ces
 * mises en page, et les tests documentent ce qui est censé être compris.
 *
 * ## Principes de conception
 *
 * 1. **Ne jamais inventer.** Une information absente vaut `null`, pas une valeur plausible. Un tarif
 *    faux dans un import automatique coûte plus cher qu'un tarif manquant, parce qu'il ne se voit pas.
 *
 * 2. **Toujours conserver la source.** À côté de la grille tarifaire normalisée, on garde les
 *    tableaux bruts et les lignes d'origine ; à côté des départs, les lignes d'horaires. Un humain
 *    peut ainsi vérifier, et un cas mal compris reste rattrapable sans relire le PDF.
 *
 * 3. **Signaler le doute.** Les indicateurs `tarifs.fiable` et `departs_fiable` disent quand les
 *    valeurs sont incohérentes ou proviennent d'une reconnaissance de caractères. Une application
 *    peut alors demander une vérification humaine plutôt que d'afficher un chiffre douteux.
 *
 * ## Organisation du fichier
 *
 * 1. téléchargement du PDF et gestion du cache ;
 * 2. `extractInfos`, chef d'orchestre de l'analyse ;
 * 3. les extracteurs spécialisés : fiabilité, départs, jauge, inscription, tarifs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { extractPdfText } from "./pdf.js";
import { parseDateFr, addDays } from "./dates.js";

/**
 * Identité déclarée au serveur des mandats.
 *
 * Un agent utilisateur de navigateur évite les refus des configurations qui filtrent les clients
 * automatisés. Le serveur des mandats est bien plus permissif que le site principal, mais autant
 * ne pas se signaler inutilement.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/**
 * Résultat d'un téléchargement de mandat.
 *
 * @typedef {object} MandatTelecharge
 * @property {string} file            Chemin du PDF sur le disque
 * @property {string|null} modifie_le Date de dernière modification annoncée par le serveur, en ISO
 * @property {boolean} retelecharge   Vrai si le fichier existait déjà et a été remplacé par une version plus récente
 * @property {string} [hash]          Empreinte SHA-1 du contenu
 */

/**
 * Télécharge le mandat, ou réutilise la copie locale si elle est à jour.
 *
 * ## Pourquoi ce n'est pas un simple téléchargement
 *
 * Un relevé hebdomadaire repasse sur les mêmes mandats semaine après semaine. Les retélécharger
 * tous serait long et inutilement lourd pour le serveur fédéral. On interroge donc d'abord
 * l'en-tête `Last-Modified` par une requête `HEAD`, qui ne transfère rien, et on ne récupère le
 * fichier que s'il a changé.
 *
 * Un effet de bord précieux : quand un club corrige son mandat, on le détecte, et la comparaison
 * entre relevés peut signaler « tarifs modifiés » à l'utilisateur.
 *
 * ## À propos de l'empreinte
 *
 * On calcule aussi une empreinte SHA-1 du contenu. Elle sert à reconnaître **le même mandat publié
 * sous deux noms de fichier différents**, ce que fait la FFTA quand un concours d'un week-end est
 * découpé en deux épreuves : chacune reçoit son PDF, au contenu identique mais à l'adresse
 * distincte. `regrouperConcours` s'appuie sur cette empreinte pour réunir les deux épreuves.
 *
 * Un fichier de métadonnées `<nom>.pdf.json` accompagne chaque PDF et conserve date et empreinte
 * entre deux exécutions.
 *
 * @param {string} url adresse du PDF sur `extranet.ffta.fr`
 * @param {string} destDir dossier de destination, créé au préalable par l'appelant
 * @returns {Promise<MandatTelecharge>}
 * @throws {Error} si la réponse n'est pas un succès HTTP ou n'est pas un PDF
 */
export async function downloadMandat(url, destDir) {
  const name = path.basename(new URL(url).pathname);
  const dest = path.join(destDir, name);
  const meta = dest + ".json";

  // Le PDF est-il déjà là ? Les métadonnées peuvent manquer si le fichier vient d'une version
  // antérieure du programme : on repart alors d'un objet vide plutôt que d'échouer.
  let existing = null;
  try {
    await fs.access(dest);
    existing = JSON.parse(await fs.readFile(meta, "utf8").catch(() => "{}"));
  } catch {}

  let lastModified = null;
  if (existing) {
    // Requête sans corps, uniquement pour comparer les dates. Une panne réseau ici n'est pas
    // bloquante : on laisse `lastModified` à null, ce qui fait conserver la copie locale.
    try {
      const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
      lastModified = toIso(head.headers.get("last-modified"));
    } catch {}

    // Serveur muet sur la date, ou date inchangée : rien à retélécharger
    if (!lastModified || lastModified === existing.modifie_le) {
      // Le fichier vient peut-être d'une version antérieure, qui ne calculait pas d'empreinte :
      // on la calcule depuis le disque et on l'enregistre pour les fois suivantes.
      if (!existing.hash) {
        existing.hash = sha1(await fs.readFile(dest));
        await fs.writeFile(meta, JSON.stringify(existing, null, 2));
      }
      return { file: dest, modifie_le: existing.modifie_le || lastModified, retelecharge: false, hash: existing.hash };
    }
  }

  // Téléchargement, soit parce que le fichier est nouveau, soit parce qu'il a changé
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);

  // Contrôle du type : un lien mort renvoie parfois une page HTML d'erreur avec un code 200,
  // qu'il vaut mieux refuser tout de suite que tenter d'analyser comme un PDF.
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("pdf")) throw new Error(`Type inattendu (${ct}) pour ${url}`);

  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);

  const modifie_le = toIso(res.headers.get("last-modified"));
  const hash = sha1(buf);
  await fs.writeFile(meta, JSON.stringify({ url, modifie_le, hash, telecharge_le: new Date().toISOString() }, null, 2));

  return { file: dest, modifie_le, retelecharge: !!existing, hash };
}

/**
 * Empreinte du contenu d'un fichier.
 *
 * SHA-1 suffit largement ici : il ne s'agit pas de sécurité mais de comparer deux PDF, et sa
 * rapidité est appréciable sur des fichiers de plusieurs centaines de kilo-octets.
 *
 * @param {Buffer} buf
 * @returns {string} empreinte en hexadécimal, quarante caractères
 */
function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/**
 * Convertit une date d'en-tête HTTP en date ISO.
 *
 * @param {string|null} httpDate par exemple « Sun, 02 Aug 2026 17:24:39 GMT »
 * @returns {string|null} date ISO, ou `null` si l'en-tête est absent ou illisible
 */
function toIso(httpDate) {
  if (!httpDate) return null;
  const d = new Date(httpDate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Lit un mandat de bout en bout : extraction du texte, puis analyse.
 *
 * Le texte issu de la reconnaissance de caractères est conservé séparément dans `texte_ocr`. Ce
 * n'est pas un doublon : `extractInfos` s'en sert pour savoir quelles informations proviennent
 * d'un document scanné, et donc lesquelles marquer comme douteuses.
 *
 * @param {string} file chemin du PDF
 * @param {object} [options]
 * @param {boolean} [options.ocr=true] autoriser la reconnaissance de caractères sur les pages scannées
 * @param {{date_debut?: string|null, date_fin?: string|null}} [options.contexte]
 *        dates du concours, indispensables pour dater les départs et la limite d'inscription
 * @returns {Promise<import("./types.js").Mandat>}
 */
export async function parseMandat(file, { ocr = true, contexte = {} } = {}) {
  const { text: raw, pages, ocr: ocrUsed, ocr_pages, ocr_text } = await extractPdfText(file, { ocr });
  const text = normalize(raw);
  const texte_ocr = ocrUsed ? normalize(ocr_text) : "";
  return {
    fichier: path.basename(file),
    pages,
    ocr: ocrUsed,
    ocr_pages,
    infos: extractInfos(text, { ...contexte, texte_ocr }),
    texte: text,
    texte_ocr,
  };
}

/**
 * Rejoue l'analyse sur un texte déjà extrait, sans rouvrir le PDF.
 *
 * Deux usages, tous deux importants :
 *
 * - **Un mandat partagé par plusieurs épreuves** doit être analysé une fois par épreuve, parce que
 *   les dates du concours changent d'une épreuve à l'autre et que les départs en dépendent. Lire le
 *   PDF une seule fois puis rejouer l'analyse évite un travail inutile.
 * - **La commande `reparse`** ré-analyse tous les mandats après une amélioration des heuristiques,
 *   sans retourner sur le site ni retélécharger quoi que ce soit.
 *
 * @param {string} texte texte du mandat, mise en page conservée
 * @param {{date_debut?: string|null, date_fin?: string|null, texte_ocr?: string}} [contexte]
 * @returns {import("./types.js").InfosMandat}
 */
export function reextractInfos(texte, contexte = {}) {
  return extractInfos(texte, contexte);
}

/**
 * Met le texte du PDF sous une forme régulière avant analyse.
 *
 * Les heuristiques raisonnent ligne par ligne et comptent les espaces : sans cette normalisation,
 * chaque motif devrait tolérer des variations d'espacement, ce qui les rendrait illisibles.
 *
 * Quatre nettoyages successifs : suppression des retours chariot Windows, réduction des suites
 * d'espaces à un seul, suppression des espaces en bord de ligne, réduction des enfilades de lignes
 * vides à une seule. La classe de la deuxième expression contient aussi l'espace insécable, très
 * fréquent dans les documents produits par un traitement de texte français.
 *
 * @param {string} t texte brut sorti de `extractPdfText`
 * @returns {string} texte normalisé
 */
function normalize(t) {
  return t
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Dédoublonne un tableau en conservant l'ordre d'apparition.
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
const uniq = (arr) => [...new Set(arr)];

/**
 * Découpe un texte en lignes.
 * @param {string} text
 * @returns {string[]}
 */
const lines = (text) => text.split("\n");

/**
 * Raccourcisseurs d'adresses les plus répandus dans les mandats.
 *
 * Un club qui met un lien d'inscription le raccourcit souvent pour l'écrire lisiblement sur son
 * affiche. L'adresse résultante ne contient alors aucun mot reconnaissable : `https://urlz.fr/v5I5`
 * ne dit pas qu'il s'agit d'une inscription. Sans cette liste, ces liens passeraient inaperçus.
 */
const SHORT_URL_HOSTS =
  /(urlz\.fr|bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|lc\.cx|shorturl\.at|is\.gd|rb\.gy|ow\.ly|tiny\.cc|frama\.link|s\.42l\.fr|u\.nu|v\.gd)/i;
/**
 * Marqueurs d'une adresse d'inscription en ligne.
 *
 * Mêle des mots génériques (« inscription », « formulaire ») et les noms des plateformes que les
 * clubs utilisent réellement : HelloAsso pour le paiement, Inscriptarc spécialisé tir à l'arc,
 * Sportsregions pour les sites de clubs, ainsi que les formulaires Google et Framaforms.
 */
const INSCRIPTION_URL =
  /inscript|inscriptarc|helloasso|forms|docs\.google|framaforms|sportsregions|arc-en-ligne|compet|formulaire|typeform|weezevent|billetweb/i;

/**
 * Analyse le texte d'un mandat et en tire toutes les informations exploitables.
 *
 * C'est le chef d'orchestre : il appelle les extracteurs spécialisés dans un ordre qui compte,
 * certains dépendant du résultat des précédents. La jauge est ainsi calculée avant les départs,
 * parce que chaque départ reprend le nombre de places.
 *
 * @param {string} text texte normalisé du mandat
 * @param {{date_debut?: string|null, date_fin?: string|null, texte_ocr?: string}} [contexte]
 *        dates du concours, et texte issu de la reconnaissance de caractères s'il y en a
 * @returns {import("./types.js").InfosMandat}
 */
function extractInfos(text, contexte = {}) {
  const lower = text.toLowerCase();
  /** @type {any} construit champ par champ, typé en sortie */
  const infos = {};
  // Repère de dates transmis aux extracteurs. Un concours d'un jour n'a pas de date de fin
  // distincte : on retombe alors sur la date de début.
  const ref = { debut: contexte.date_debut || null, fin: contexte.date_fin || contexte.date_debut || null };

  infos.emails = uniq(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map((e) => e.replace(/[.,;:]+$/, ""));
  infos.telephones = uniq(
    (text.match(/(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}/g) || []).map((t) => t.replace(/[\s.-]/g, ""))
  );
  infos.urls = uniq(text.match(/(?:https?:\/\/|www\.)[^\s|)>\]"']+/g) || []).map((u) => u.replace(/[.,;]+$/, ""));

  // ---- Inscription : mode (mail / url / courrier), destinataires, phrases d'origine
  infos.inscription = extractInscription(text, infos);
  infos.inscription_urls = infos.inscription.urls;

  // ---- Tarifs : tableaux reconstitués, puis grille normalisée
  infos.tarifs = extractTarifs(text);

  // ---- Horaires bruts : filet de sécurité si la reconstitution des départs échoue.
  // On retient les lignes qui portent une heure ET un mot du vocabulaire de planning, en écartant
  // les pénalités de désistement, qui mentionnent souvent une heure limite sans être un horaire.
  infos.horaires = uniq(
    lines(text).filter(
      (l) =>
        /\b\d{1,2}\s?[hH:]\s?\d{0,2}\b/.test(l) &&
        /(d[ée]part|greffe|échauffement|echauffement|ouverture|tir|inscription|remise|début|debut|fin|matin|après-midi|apres-midi|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|résultat|resultat)/i.test(
          l
        ) &&
        !/factur|pénalit|penalit/i.test(l)
    )
  );

  // ---- Dates en toutes lettres
  infos.dates = uniq(
    text.match(
      /\b\d{1,2}(?:er)?\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+\d{4})?/gi
    ) || []
  );

  // ---- Arbitres : la section « Arbitres : … » jusqu'à la première ligne vide.
  // Le motif `\n(?!\n)` prolonge la capture sur les lignes suivantes tant qu'elles ne sont pas vides,
  // la liste des arbitres tenant souvent sur deux ou trois lignes.
  const arb = text.match(/arbitres?\s*(?:responsable)?\s*:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i);
  if (arb) infos.arbitres = arb[1].trim();

  // ---- Distances et blasons, utiles pour savoir à quoi s'attendre sur le pas de tir
  infos.distances = uniq(text.match(/\b\d{1,3}\s?m(?:ètres|etres)?\b/gi) || []).map((d) => d.replace(/\s/g, ""));
  const blasons = text.match(/blasons?[^\n]*/gi);
  if (blasons) infos.blasons = uniq(blasons.map((b) => b.trim()));

  // ---- Date limite d'inscription
  //
  // Le piège principal : un mandat contient plusieurs phrases de la forme « avant le … », et une
  // seule concerne l'inscription. Les autres parlent de désistement facturé, de commande de
  // sandwichs ou de priorité régionale. Trois filtres successifs les écartent :
  //   1. la ligne doit contenir un mot-clé de délai ET une date ;
  //   2. elle ne doit contenir aucun mot signalant un autre sujet ;
  //   3. à égalité, on préfère celle dont le contexte parle explicitement d'inscription.
  //
  // Cas réel qui a motivé ce soin : « Tout désistement non signalé avant le jeudi 22 octobre sera
  // facturé 5 € » précédait « Inscriptions avant le mercredi 21 octobre ». Sans filtre, on retenait
  // le 22 au lieu du 21.
  const DATE_RE = /\d{1,2}\/\d{1,2}|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre/i;
  const ls = lines(text);
  const candidats = ls
    .map((l, i) => ({ l: l.trim(), ctx: (ls[i - 1] || "") + " " + l }))
    .filter(
      ({ l }) =>
        /(date limite|clôture|cloture|jusqu'au|jusqu’au|avant le|au plus tard)/i.test(l) &&
        DATE_RE.test(l) &&
        !/factur|pénalit|penalit|désistement|desistement|sandwich|repas|commande|prioritaire/i.test(l)
    );
  // On préfère une ligne qui parle explicitement d'inscription
  const limite = candidats.find(({ ctx }) => /inscri/i.test(ctx)) || candidats[0];
  infos.date_limite_iso = null;
  if (limite) {
    infos.date_limite_inscription = limite.l;
    // On ne garde que la partie après le mot-clé pour ne pas attraper une autre date de la phrase
    const apres = limite.l.split(/date limite|clôture|cloture|jusqu'au|jusqu’au|avant le|au plus tard/i).pop();
    const { date, heure } = parseDateFr(apres, { ...ref, limite: true });
    infos.date_limite_iso = date ? (heure ? `${date}T${heure}` : date) : null;
  }

  // ---- Départs et jauge. L'ordre compte : chaque départ reprend le nombre de places.
  infos.jauge = extractJauge(text);
  infos.departs = extractDeparts(text, ref, infos.jauge);

  // ---- Tarifs exprimés en « + X € par départ supplémentaire » : la grille est prolongée jusqu'au
  // nombre de départs réellement proposés, maintenant qu'on le connaît.
  etendreGrille(infos.tarifs, infos.departs.length);

  // ---- Fiabilité : cohérence des valeurs, et provenance du texte.
  //
  // Une information tirée d'une page reconnue par OCR est suspecte : la reconnaissance confond
  // volontiers 8 et B, 0 et O, ce qui suffit à fausser un tarif. On compare donc chaque ligne
  // source au texte reconnu pour savoir d'où elle vient.
  //
  // Les deux côtés doivent être aplatis de la même façon avant comparaison : les lignes de tarifs
  // ont vu leurs séparateurs de colonnes remplacés par des espaces, le texte OCR non. Sans cette
  // précaution la comparaison échouait toujours, et le contrôle ne servait à rien. Ce défaut a
  // été trouvé par un test, et le test correspondant est resté.
  const aplatir = (s) => String(s || "").replace(/\s*\|\s*/g, " ").trim();
  const ocrTxt = aplatir(contexte.texte_ocr);
  const vientDeOcr = (l) => !!ocrTxt && !!l && ocrTxt.includes(aplatir(l));
  infos.tarifs.fiable = fiabiliteTarifs(infos.tarifs, vientDeOcr);
  infos.departs_fiable = fiabiliteDeparts(infos.departs, vientDeOcr, text);

  // ---- Buvette : information banale mais toujours demandée par les archers
  infos.buvette = /buvette|restauration|sandwich|repas/.test(lower);

  // ---- Adresse : première occurrence d'un code postal suivi d'une commune.
  // La commune commence forcément par une majuscule, ce qui évite de capturer un numéro isolé.
  const adresse = text.match(/\b\d{5}\s+[A-ZÉÈÀ][A-ZÉÈÀa-zéèàêôûïç' -]+/);
  if (adresse) infos.adresse = adresse[0].trim();

  return infos;
}

// ---------------------------------------------------------------- Fiabilité

/**
 * Décide si la grille tarifaire mérite confiance.
 *
 * Le but n'est pas de vérifier que les prix sont justes, c'est impossible, mais de repérer les
 * grilles manifestement mal lues. Une application qui importe ces données peut alors demander
 * une vérification humaine plutôt que d'afficher un tarif faux.
 *
 * Cinq contrôles, dont quatre relèvent du bon sens tarifaire des concours de tir à l'arc :
 *
 * 1. **Grille non vide.** Rien à valider signifie rien de fiable.
 * 2. **Montants plausibles, entre 2 et 60 €.** En dessous, on a probablement lu un numéro de départ
 *    ou une distance ; au-dessus, un code postal, une année ou un total additionné par erreur.
 *    Les concours de tir à l'arc se situent en pratique entre 6 et 25 €.
 * 3. **Le jeune ne paie pas plus que l'adulte.** L'inverse est constant dans la discipline ; une
 *    grille qui l'enfreint trahit deux colonnes interverties.
 * 4. **Le prix croît avec le nombre de départs.** Tirer deux fois ne coûte jamais moins qu'une.
 * 5. **Aucune ligne ayant alimenté la grille ne vient de l'OCR**, dont les confusions de chiffres
 *    sont fréquentes. Les autres lignes du document n'entrent pas en compte.
 *
 * @param {import("./types.js").Tarifs} tarifs la grille et ses sources
 * @param {(ligne: string) => boolean} vientDeOcr dit si une ligne provient d'une page reconnue
 * @returns {boolean}
 */
function fiabiliteTarifs(tarifs, vientDeOcr) {
  const g = tarifs.grille;
  if (!g.length) return false;

  // 2. Ordres de grandeur
  const vals = g.flatMap((t) => [t.adulte, t.jeune]).filter((v) => v !== null);
  if (!vals.length || vals.some((v) => v < 2 || v > 60)) return false;

  // 3. Le tarif jeune est toujours inférieur ou égal au tarif adulte
  for (const t of g) if (t.adulte !== null && t.jeune !== null && t.jeune > t.adulte) return false;

  // 4. Croissance avec le nombre de départs, publics comparés séparément
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1], b = g[i];
    if (a.adulte !== null && b.adulte !== null && b.adulte < a.adulte) return false;
    if (a.jeune !== null && b.jeune !== null && b.jeune < a.jeune) return false;
  }

  // 5. Provenance du texte. On ne regarde que les lignes qui ont réellement alimenté la grille :
  //    une page annexe passée à l'OCR, un plan d'accès par exemple, produit du bruit contenant
  //    parfois un symbole €, qui ne doit pas discréditer un tableau lu sur une page de texte natif.
  if (tarifs.sources.some(vientDeOcr)) return false;

  return true;
}

/**
 * Décide si les départs reconstitués méritent confiance.
 *
 * Trois contrôles :
 *
 * 1. **Au moins un départ**, sinon il n'y a rien à qualifier.
 * 2. **Chaque départ a une date et une heure**, faute de quoi il est inutilisable dans un
 *    formulaire ou un calendrier.
 * 3. **L'heure tombe entre 6 h et 20 h.** Un concours ne commence ni à 3 h du matin ni à 23 h ;
 *    une heure hors de cette plage signale une confusion, typiquement une durée ou un montant
 *    pris pour un horaire.
 *
 * S'y ajoute le contrôle de provenance : si une ligne d'horaire vient d'une page reconnue par OCR,
 * l'ensemble est marqué douteux.
 *
 * @param {import("./types.js").Depart[]} departs
 * @param {(ligne: string) => boolean} vientDeOcr
 * @param {string} text le texte du mandat, pour retrouver les lignes d'horaires
 * @returns {boolean}
 */
function fiabiliteDeparts(departs, vientDeOcr, text) {
  if (!departs.length) return false;

  for (const d of departs) {
    if (!d.datetime) return false;
    const h = Number(d.heure_debut.slice(0, 2));
    if (h < 6 || h > 20) return false;
  }

  const horaires = lines(text).filter((l) => ROW_LABELS.some(([, re]) => re.test(l)) && HEURE.test(l));
  if (horaires.some(vientDeOcr)) return false;

  return true;
}

// ---------------------------------------------------------------- Départs

/**
 * Reconnaît une heure sous toutes ses écritures : « 8h », « 8h30 », « 08:30 », « 8 heures 30 ».
 * Les minutes sont facultatives et forment le second groupe de capture.
 */
const HEURE = /(\d{1,2})\s?(?:h|H|:|heures?)\s?(\d{2})?\b/;

/** Même motif en recherche globale, pour compter plusieurs heures sur une ligne. */
const HEURE_G = new RegExp(HEURE.source, "g");

/**
 * Les trois moments d'un départ, avec le vocabulaire qui les désigne dans les mandats.
 *
 * L'ordre reflète le déroulement réel : on se présente au greffe, on s'échauffe, on tire. Il compte
 * aussi pour le choix de l'heure de référence d'un départ, qui prend la première renseignée.
 *
 * Le motif du greffe contient une exception qui mérite explication : `l'après-midi 11h30`. Un club
 * du Mans décrit ses deux départs par « Ouverture du greffe 7 h 30 » puis « L'après-midi 11h30 »,
 * sans répéter le mot greffe. Sans cette alternative, son second départ était perdu.
 *
 * @type {[string, RegExp][]}
 */
const ROW_LABELS = [
  ["greffe", /greffe|^\W*l['’]?apr[eè]s[- ]midi\s+\d/i],
  ["echauffement", /échauffement|echauffement|entra[iî]nement/i],
  ["tirs", /(d[ée]but|d[ée]part)\s+(des\s+)?tirs?|^tirs?\b/i],
];

/**
 * Met en forme une heure capturée par `HEURE`.
 * @param {RegExpMatchArray} m résultat de la correspondance
 * @returns {string} `HH:MM`, les minutes absentes valant 00
 */
const fmtHeure = (m) => `${m[1].padStart(2, "0")}:${m[2] || "00"}`;

/**
 * Convertit `HH:MM` en minutes depuis minuit, pour comparer deux horaires.
 * @param {string|null} h
 * @returns {number|null}
 */
const minutes = (h) => (h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3)) : null);

/**
 * Reconstitue les départs à partir des lignes d'horaires du mandat.
 *
 * C'est l'extraction la plus délicate du fichier, parce que les clubs présentent leurs horaires de
 * quatre façons différentes, et qu'il faut en plus deviner les dates.
 *
 * ## Les quatre mises en page reconnues
 *
 * **1. En colonnes**, la plus fréquente. Une colonne par départ, une ligne par moment :
 * ```
 * DEPART 1 - 19/09     | DEPART 2 - 20/09 | DEPART 3 - 20/09
 * Ouverture du greffe  | 13h00-13h30      | 07h45-08h15      | 13h00-13h30
 * Échauffement         | 13h00-13h45      | 07h45-08h30      | 13h00-13h45
 * Début des tirs       | 14h00            | 08h45            | 14h00
 * ```
 *
 * **2. En cellules répétées**, où le libellé est repris dans chaque colonne :
 * ```
 * Greffe : 07h30 - 08h30 | Greffe : 12h45 - 13h30
 * ```
 *
 * **3. En lignes**, un bloc par départ :
 * ```
 * 1er départ     | Accueil greffe                | 8H00
 * Dimanche matin | Début de l'échauffement       | 8H30
 * ```
 *
 * **4. En texte courant**, sans tableau :
 * ```
 * Ouverture du greffe 7 h 30 et fermeture 8 h 15
 * ```
 *
 * ## Comment les dates sont déduites
 *
 * Par ordre de préférence :
 * 1. **L'en-tête du tableau**, s'il porte une date (`DEPART 2 - 20/09`) ou un jour de semaine
 *    (`Dimanche matin`), résolu dans la période du concours.
 * 2. **Le premier jour du concours** à défaut.
 * 3. **Le lendemain** dès que les horaires repartent en arrière : un départ à 8 h 30 qui suit un
 *    départ à 14 h ne peut pas être le même jour. Cette règle simple résout à elle seule la plupart
 *    des concours de week-end.
 *
 * Les départs qui tombent en dehors des dates de l'épreuve reçoivent `hors_epreuve`. Ce cas se
 * produit quand la FFTA publie un week-end en deux épreuves partageant le même mandat : chaque
 * épreuve ne doit afficher que ses propres départs, mais on conserve les autres pour que
 * `regrouperConcours` puisse reconstituer le concours entier.
 *
 * @param {string} text texte normalisé du mandat
 * @param {{debut: string|null, fin: string|null}} ref dates de l'épreuve courante
 * @param {import("./types.js").Jauge} jaugeGlobale places et cibles, recopiées sur chaque départ
 * @returns {import("./types.js").Depart[]} les départs, dans l'ordre chronologique du document
 */
function extractDeparts(text, ref, jaugeGlobale) {
  const ls = lines(text);

  /**
   * Départs en cours de construction, indexés par position : `cols[0]` est le premier départ.
   * Chaque entrée se remplit au fil des lignes du mandat.
   * @type {{nom: string|null, date: string|null, greffe: string|null, echauffement: string|null, tirs: string|null}[]}
   */
  const cols = [];

  /** Indice de la première ligne d'horaires trouvée : sert à borner la recherche d'en-tête. */
  let firstRow = -1;

  /** Mise en page détectée ; empêche de mélanger deux stratégies sur un même document. */
  let rowMode = null; // "colonnes" | "lignes"

  /**
   * Renvoie le départ numéro `k`, en le créant au besoin.
   * @param {number} k index à partir de 0
   */
  const ensure = (k) => (cols[k] ||= { nom: null, date: null, greffe: null, echauffement: null, tirs: null });

  // ---------------------------------------------------------------- Mise en page 3 : en lignes
  // « 1er départ | Accueil greffe | 8H00 », puis les lignes suivantes complètent le même départ.
  // Testée en premier parce qu'elle est reconnaissable sans ambiguïté : une ligne qui commence par
  // un numéro de départ et contient une heure ne peut être qu'un début de bloc.
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/^(\d{1,2})\s*(?:er|ème|eme|e)?\s*d[ée]part\b/i);
    if (!m || !HEURE.test(ls[i])) continue;
    rowMode = "lignes";
    if (firstRow < 0) firstRow = i;
    // Le numéro écrit dans le mandat est en base 1, notre tableau en base 0
    const k = Number(m[1]) - 1;
    const c = ensure(k);
    c.nom = `Départ ${k + 1}`;

    /**
     * Verse dans le départ courant l'heure et la date éventuelles d'une ligne.
     * Le `!c[key]` protège la première valeur rencontrée : si le mandat répète un horaire,
     * on garde celui du haut, plus proche du titre du départ.
     * @param {string} line
     */
    const setFrom = (line) => {
      const h = line.match(HEURE);
      if (!h) return;
      for (const [key, re] of ROW_LABELS) if (re.test(line) && !c[key]) c[key] = fmtHeure(h);
      const d = parseDateFr(line, ref).date;
      if (d && !c.date) c.date = d;
    };
    setFrom(ls[i]);

    // Les deux lignes suivantes décrivent en général le même départ (échauffement, début des tirs).
    // On s'arrête net si l'une annonce un autre départ.
    for (let j = i + 1; j <= i + 2 && j < ls.length; j++) {
      if (/^\d{1,2}\s*(?:er|ème|eme|e)?\s*d[ée]part\b/i.test(ls[j])) break;
      setFrom(ls[j]);
    }
  }

  // ---------------------------------------------------------------- Mises en page 1, 2 et 4
  // Traitées ensemble : dans les trois cas, une ligne porte un libellé de moment et une ou
  // plusieurs heures, chacune correspondant à un départ.
  if (!rowMode) {
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];

      // La ligne parle-t-elle d'un moment du départ ? On regarde d'abord la première cellule,
      // qui porte le libellé dans un tableau ordinaire, puis la ligne entière pour la mise en
      // page 2, où le libellé est répété dans chaque cellule.
      const label = ROW_LABELS.find(([, re]) => re.test(l.split("|")[0]) || (l.includes("|") && re.test(l)));
      if (!label) continue;

      const cells = l.split("|").map((c) => c.trim());
      const first = cells.findIndex((c) => HEURE.test(c));
      if (first < 0) continue;

      // Deux dispositions possibles des heures :
      //  - « Greffe : 07h30 | Greffe : 12h45 » : chaque cellule porte libellé et heure, on les prend toutes ;
      //  - « Ouverture du greffe | 13h00 | 8h30 » : la première cellule est le libellé, on prend la suite.
      const timeCells = cells[0].match(HEURE) && cells.every((c) => label[1].test(c) || !c) ? cells : cells.slice(first);
      const times = timeCells.map((c) => {
        const h = c.match(HEURE);
        return h ? fmtHeure(h) : null;
      });
      if (!times.some(Boolean)) continue;

      if (firstRow < 0) firstRow = i;

      // Un mandat mentionne le greffe à plusieurs endroits : dans le tableau des horaires, mais
      // aussi dans le bulletin d'inscription, le plan d'accès ou le droit à l'image. Le vrai
      // tableau est compact ; au-delà d'une douzaine de lignes du début, on est ailleurs.
      if (i - firstRow > 12) continue;

      rowMode = "colonnes";
      const key = label[0];

      // Certains mandats décrivent le samedi puis le dimanche dans deux tableaux successifs.
      // Si tous les départs connus ont déjà cette information, la ligne en décrit de nouveaux :
      // on les ajoute à la suite plutôt que d'écraser les précédents.
      const offset = cols.length && cols.every((c) => c[key]) ? cols.length : 0;
      times.forEach((t, k) => {
        if (t) ensure(offset + k)[key] = t;
      });
    }
  }

  if (!cols.length) return [];

  // ---- En-tête (au-dessus de la première ligne d'horaires) : noms de départs, jours, dates
  // ---------------------------------------------------------------- Noms et dates depuis l'en-tête
  //
  // Fenêtre élargie de trois jours : le mandat d'un week-end mentionne « Samedi » et « Dimanche »
  // alors que l'épreuve courante ne dure qu'un jour. Chercher le samedi dans les seules dates de
  // l'épreuve échouerait. On élargit donc pour résoudre, quitte à marquer ensuite hors épreuve.
  const refLarge = ref.debut ? { debut: addDays(ref.debut, -3), fin: addDays(ref.fin || ref.debut, 3) } : ref;

  if (rowMode === "colonnes" && firstRow > 0) {
    // L'en-tête se trouve juste au-dessus du tableau, rarement plus haut que quatre lignes
    for (let i = Math.max(0, firstRow - 4); i < firstRow; i++) {
      const cells = ls[i].split("|").map((c) => c.trim()).filter(Boolean);

      // Cellules qui ressemblent à un intitulé de départ. La limite de 40 caractères écarte les
      // phrases entières : un titre de colonne est court, une consigne ne l'est pas.
      const infoCells = cells.filter(
        (c) => c.length <= 40 && /d[ée]part\s*\d|samedi|dimanche|vendredi|lundi|mardi|mercredi|jeudi|matin|après|apres|\d{1,2}\/\d{1,2}/i.test(c)
      );

      // Exigence stricte d'une cellule par colonne d'horaires : sans elle, une ligne quelconque
      // contenant « samedi » serait prise pour un en-tête et décalerait tous les noms.
      if (infoCells.length !== cols.length) continue;

      infoCells.forEach((c, k) => {
        const col = cols[k];
        // « DEPART 2 - 20/09 » devient « DEPART 2 » : la date est extraite à part, pas dans le nom
        col.nom ||= c.replace(/\s*[-–]\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?/, "").trim();
        col.date ||= parseDateFr(c, refLarge).date;
      });
      break; // le premier en-tête valable suffit
    }
  }

  // ---------------------------------------------------------------- Dates encore manquantes
  //
  // On part du premier jour du concours et on avance d'un jour chaque fois que l'horaire repart en
  // arrière : après un départ à 14 h, un départ à 8 h 30 est forcément le lendemain. La garde
  // `date < ref.fin` empêche de déborder au-delà de la fin du concours.
  let date = ref.debut;
  let prev = null; // heure du départ précédent, en minutes depuis minuit
  for (const c of cols) {
    const h = c.greffe || c.echauffement || c.tirs;
    if (!c.date) {
      if (prev !== null && minutes(h) !== null && minutes(h) < prev && date && (!ref.fin || date < ref.fin)) {
        date = addDays(date, 1);
      }
      c.date = date;
    } else {
      // Date connue par l'en-tête : elle fait autorité et sert de base aux départs suivants
      date = c.date;
    }
    prev = minutes(h);
  }

  // ---------------------------------------------------------------- Mise en forme finale
  return cols.map((c, k) => {
    // Heure de référence : le greffe est ce qui intéresse l'archer, c'est l'heure à laquelle il
    // doit être sur place. À défaut, l'échauffement, puis le début des tirs.
    const heure = c.greffe || c.echauffement || c.tirs;
    // Départ situé en dehors des dates de l'épreuve : conservé, mais signalé
    const hors = !!(ref.debut && c.date && (c.date < ref.debut || c.date > (ref.fin || ref.debut)));
    return {
      nom: c.nom || `Départ ${k + 1}`,
      date: c.date,
      heure_greffe: c.greffe,
      heure_echauffement: c.echauffement,
      heure_debut_tirs: c.tirs,
      heure_debut: heure,
      datetime: c.date && heure ? `${c.date}T${heure}` : null,
      jauge: jaugeGlobale.places,
      cibles: jaugeGlobale.cibles,
      ...(hors && { hors_epreuve: true }),
    };
  });
}

/**
 * Cherche combien d'archers peuvent s'inscrire, et sur combien de cibles.
 *
 * Information précieuse pour un club qui veut savoir s'il reste de la place, mais rarement écrite,
 * et jamais deux fois de la même façon. Quatre tournures sont reconnues, dans cet ordre de
 * précision décroissante :
 *
 * | Tournure du mandat                  | Interprétation           |
 * | ----------------------------------- | ------------------------ |
 * | « 96 archers par départ »           | explicite, la meilleure  |
 * | « limité à 120 tireurs »            | explicite aussi          |
 * | « 3 Départs (3 x 48 places) »       | places par départ        |
 * | « 15 places maximum »               | sans précision de départ |
 *
 * Le `else if` compte : dès qu'une tournure explicite est trouvée, on s'arrête. Les suivantes sont
 * moins sûres et risqueraient d'écraser une bonne valeur par une moins bonne.
 *
 * Si aucune ne donne le nombre de places mais qu'on connaît les cibles et le nombre d'archers par
 * cible, on multiplie : c'est ainsi que se calcule une jauge en tir sur cibles.
 *
 * La phrase d'origine est conservée dans `texte`, tronquée à 160 caractères, pour qu'un humain
 * puisse vérifier d'où vient le chiffre.
 *
 * @param {string} text texte normalisé du mandat
 * @returns {import("./types.js").Jauge}
 */
function extractJauge(text) {
  const j = { places: null, cibles: null, archers_par_cible: null, texte: null };
  // Analyse sur une seule ligne : ces tournures sont souvent coupées par un retour à la ligne
  const t = text.replace(/\s+/g, " ");
  let m;

  if ((m = t.match(/(\d{1,3})\s*(?:places?|archers?)\s*(?:maximum|max\.?)?\s*(?:par|\/)\s*d[ée]part/i))) j.places = Number(m[1]);
  else if ((m = t.match(/limit[ée]e?s?\s*(?:à|:)?\s*(\d{1,3})\s*(?:archers?|places?|tireurs?|comp[ée]titeurs?)/i))) j.places = Number(m[1]);
  else if ((m = t.match(/\d\s*x\s*(\d{1,3})\s*places/i))) j.places = Number(m[1]);
  else if ((m = t.match(/(\d{1,3})\s*places\s*(?:maximum|max\.?|disponibles)/i))) j.places = Number(m[1]);

  if ((m = t.match(/(\d{1,3})\s*cibles/i))) j.cibles = Number(m[1]);
  if ((m = t.match(/(\d)\s*(?:archers?|tireurs?)\s*(?:par|\/)\s*cible/i))) j.archers_par_cible = Number(m[1]);

  // Calcul de repli : une jauge se déduit du nombre de cibles multiplié par les archers par cible
  if (!j.places && j.cibles && j.archers_par_cible) j.places = j.cibles * j.archers_par_cible;

  // Phrase source, bornée par les points, pour vérification humaine
  const src = t.match(/[^.]*\b(places?|archers? par|cibles)\b[^.]*/i);
  if (src) j.texte = src[0].trim().slice(0, 160);

  return j;
}

/**
 * Détermine comment s'inscrire au concours.
 *
 * Trois moyens coexistent dans la discipline, et un même mandat en propose parfois plusieurs :
 * un formulaire en ligne, un courriel, ou un envoi postal avec chèque.
 *
 * ## Deux passes complémentaires
 *
 * **La première** examine toutes les adresses du document et retient celles qui ressemblent à un
 * lien d'inscription, soit par leur contenu (`inscription`, `helloasso`…), soit parce qu'elles
 * passent par un raccourcisseur. Cette seconde condition est indispensable : `https://urlz.fr/v5I5`
 * ne contient aucun indice, et sans elle le lien d'inscription du concours de Vallet passait
 * inaperçu.
 *
 * **La seconde** parcourt les lignes parlant d'inscription et y cherche des coordonnées. Elle
 * regarde aussi les deux lignes suivantes, car les clubs écrivent couramment « Les inscriptions
 * sont à adresser à : » puis le nom et l'adresse en dessous.
 *
 * ## Choix du mode
 *
 * Par ordre de commodité pour l'archer : un formulaire en ligne l'emporte sur un courriel, qui
 * l'emporte sur un envoi postal. C'est le moyen le plus direct qui est retenu quand plusieurs
 * sont proposés.
 *
 * @param {string} text texte normalisé du mandat
 * @param {{urls: string[]}} infos les adresses déjà relevées dans le document
 * @returns {import("./types.js").Inscription}
 */
function extractInscription(text, infos) {
  const ls = lines(text);
  const result = { mode: null, urls: [], emails: [], texte: [] };

  // Première passe : les adresses reconnaissables comme liens d'inscription
  const urlsInscription = infos.urls.filter((u) => INSCRIPTION_URL.test(u) || SHORT_URL_HOSTS.test(u));
  result.urls.push(...urlsInscription);

  // Seconde passe : les lignes qui parlent d'inscription et les coordonnées qu'elles portent
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (!/inscri/i.test(l)) continue;
    // La ligne et les deux suivantes : les coordonnées sont souvent écrites en dessous de la phrase
    const ctx = [l, ls[i + 1], ls[i + 2]].filter(Boolean).join(" ");
    const mails = ctx.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
    const urls = ctx.match(/(?:https?:\/\/|www\.)[^\s|)>\]"']+/g) || [];
    if (mails.length || urls.length || /par (mail|courriel|courrier|internet|e-mail)|en ligne|auprès de|aupres de/i.test(l)) {
      result.texte.push(l.trim());
      result.emails.push(...mails.map((e) => e.replace(/[.,;:]+$/, "")));
      result.urls.push(...urls.map((u) => u.replace(/[.,;]+$/, "")));
    }
  }
  result.urls = uniq(result.urls);
  result.emails = uniq(result.emails);
  result.texte = uniq(result.texte);

  // Mode retenu : du plus direct au moins direct pour l'archer
  const joined = result.texte.join(" ").toLowerCase();
  if (result.urls.length || /en ligne|internet|inscriptarc/.test(joined)) result.mode = "url";
  else if (result.emails.length || /mail|courriel/.test(joined)) result.mode = "mail";
  else if (/courrier|adresser|envoyer à|à l'ordre de/.test(joined)) result.mode = "courrier";

  return result;
}

// ---------------------------------------------------------------- Tarifs
//
// Le prix dépend presque toujours du nombre de départs, avec une réduction pour qui en tire
// plusieurs : 10 € pour un départ, 15 € pour deux et non 20 €. La grille produite donne donc le
// **prix total** pour chaque nombre de départs, réduction comprise, jamais un prix unitaire à
// multiplier. C'est la forme qu'attend un formulaire d'inscription « tarif selon le nombre de
// départs choisis ».
//
// Les clubs expriment cette réduction de deux façons, toutes deux prises en charge :
//   - un prix par nombre de départs : « 1 tir 9 € | 2 tirs 16 € | 3 tirs 23 € » ;
//   - un prix de base et un supplément : « 1 tir 7 € / tir supplémentaire + 6 € ». La grille est
//     alors complétée pour chaque départ réellement proposé par le concours (voir `etendreGrille`).

/**
 * Libellés de la cellule d'angle d'un tableau tarifaire, ou cellule vide.
 * Le deux-points final est toléré : « TARIFS: », « ENGAGEMENT : ».
 */
const CORNER = /^(tarifs?|engagements?|inscriptions?|cat[ée]gories?|droits? d.inscriptions?)?\s*:?$/i;

/**
 * Mots qui peuvent figurer en tête de colonne d'un tableau tarifaire.
 *
 * Deux familles : ceux qui désignent une **quantité** (« 1 tir », « 2 départs ») et ceux qui
 * désignent un **public** (« Adultes », « Jeunes », « U18 », « S.1 », « Licence A »). Selon
 * l'orientation du tableau, l'une ou l'autre se trouve en tête de colonne.
 */
const HEADER_WORD = /tirs?\b|d[ée]parts?|concours|adultes?|jeunes?|s[ée]niors?|\bU\d{2}\b|\bS\.?\s?[123]\b|tarif|montant|prix|unique|licences?/i;

/**
 * Vrai si la cellule peut appartenir à une ligne d'en-tête de tableau tarifaire.
 * @param {string} c
 */
const estEnTete = (c) => CORNER.test(c) || HEADER_WORD.test(c);

/**
 * Reconnaît un montant en euros : « 9 € », « 12,50 € », « 15 euros », « 9.00 €uros ».
 * Le premier groupe capture le nombre, virgule décimale française comprise.
 */
const MONTANT = /(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)/i;

/** Même motif en recherche globale, pour relever tous les montants d'une ligne. */
const MONTANT_G = new RegExp(MONTANT.source, "gi");

/**
 * Cellule réduite à un nombre, sans symbole : « 6,00 ».
 *
 * Admise comme montant **uniquement dans un tableau déjà identifié par son en-tête**, où il ne
 * peut s'agir que d'un prix. Hors de ce contexte, un nombre isolé peut être n'importe quoi : une
 * distance, un nombre de cibles, un numéro de départ.
 */
const NOMBRE_SEUL = /^(\d{1,3}(?:[,.]\d{1,2})?)$/;

/** Convertit « 12,50 » en 12.5. */
const enNombre = (s) => Number(String(s).replace(",", "."));

/**
 * Découpe une ligne de tableau en cellules.
 *
 * Quand pdf.js a détecté des colonnes, elles sont séparées par « | ». Certains clubs alignent
 * pourtant leurs prix avec des points de conduite, sans vraie colonne :
 *
 * ```
 * Licences adultes ...............9 € ..............16 € ..............23 €
 * ```
 *
 * On reconstitue alors les cellules en coupant sur les montants : le libellé, puis chaque prix.
 *
 * @param {string} ligne
 * @returns {string[]}
 */
function cellulesDe(ligne) {
  if (ligne.includes("|")) return ligne.split("|").map((c) => c.trim());
  const montants = [...ligne.matchAll(MONTANT_G)];
  if (!montants.length) return [ligne.trim()];
  const libelle = ligne.slice(0, montants[0].index).replace(/[.…:\s]+$/, "").trim();
  return [libelle, ...montants.map((m) => m[0])];
}

/**
 * Public désigné par un libellé : jeune, adulte, tarif unique, ou inconnu.
 *
 * ## Pourquoi le public jeune est testé en premier
 *
 * Les catégories fédérales se recouvrent dans les libellés. Beaucoup de clubs regroupent les
 * jeunes sous « U11 à U21 » : ce libellé contient U21, qui ailleurs désigne un adulte. Tester
 * d'abord les marqueurs jeunes (le mot « jeune », une catégorie U11 à U18) règle l'ambiguïté :
 * « U11 à U21 » est jeune, « U21 à Senior 3 » est adulte.
 *
 * Les seniors s'écrivent « S1 », « S 1 » ou « S.1 » selon les clubs ; « Licence A » et
 * « Licence J » désignent les types de licence adulte et jeune. Les anciennes catégories (cadet,
 * minime, benjamin, poussin) figurent encore dans beaucoup de mandats et sont reconnues.
 *
 * @param {string} label
 * @returns {"adulte"|"jeune"|"tous"|null}
 */
function publicDe(label) {
  if (/jeunes?|\bU1[0-8]\b|cadets?|minimes?|benjamins?|poussins?|licences?\s*j\b/i.test(label)) return "jeune";
  if (/adultes?|s[ée]niors?|\bU21\b|\bS\.?\s?[123]\b|licences?\s*a\b/i.test(label)) return "adulte";
  if (/unique|tous|tout public/i.test(label)) return "tous";
  return null;
}

/**
 * Public d'une ligne qui n'en mentionne qu'un seul.
 *
 * Utilisé par la lecture des tarifs en ligne, qui attribue tous les prix de la ligne à ce public.
 * Une ligne citant à la fois adultes et jeunes, comme « 1 départ : Adultes 12 € - Jeunes 7 € »,
 * relève d'une autre stratégie et renvoie `null` ici.
 *
 * @param {string} ligne
 * @returns {"adulte"|"jeune"|null}
 */
function publicUnique(ligne) {
  const jeune = /jeunes?|\bU1[0-8]\b|cadets?|minimes?|benjamins?|poussins?|licences?\s*j\b/i.test(ligne);
  const adulte = /adultes?|s[ée]niors?|\bS\.?\s?[123]\b|licences?\s*a\b/i.test(ligne);
  if (jeune === adulte) return null;
  return jeune ? "jeune" : "adulte";
}

/**
 * Extrait les tarifs du mandat, sous plusieurs formes de plus en plus exploitables.
 *
 * ## Ce qui est produit
 *
 * - `lignes` : toutes les lignes contenant un montant, telles quelles. Rien n'est perdu.
 * - `tableaux` : les tarifs reconstitués, dans leur orientation d'origine.
 * - `grille` : la forme normalisée `{ nb_departs, adulte, jeune }`, prix total réduction
 *   comprise. La seule à utiliser dans une application. Voir `normaliserGrille`.
 * - `supplement` : le prix d'un départ supplémentaire par public, quand le mandat l'exprime
 *   ainsi, ou `null`.
 *
 * ## Les trois stratégies
 *
 * **1. Les tableaux.** On repère une ligne d'en-tête (plusieurs cellules, aucun montant, que des
 * mots de tarification), puis on lit les lignes suivantes tant qu'elles portent des prix :
 *
 * ```
 * CATÉGORIE | 1 TIR | 2 TIRS           Jeunes | Adultes
 * Jeunes (U11 à U21) | 6 € | 10 €      1 Tir  | 6,00 | 8,00
 * ```
 *
 * À gauche une cellule d'angle occupe la première colonne ; à droite l'en-tête commence
 * directement par un public. `hasCorner` distingue les deux, faute de quoi les valeurs seraient
 * décalées d'une colonne. Dans un tableau ainsi identifié, un nombre sans symbole € est accepté
 * comme prix. Une ligne parasite isolée (« -Blason unique ou trispot Vegas. ») est enjambée ;
 * deux lignes sans prix d'affilée terminent le tableau.
 *
 * **2. Les phrases à deux publics** : « 1 départ : Adultes : 12 € - Jeunes 7 € », ou « Adulte :
 * 13 € » suivi de « Jeune : 9 € ». On y suit un compteur de départs, incrémenté quand le mandat ne
 * le précise pas.
 *
 * **3. Les lignes à un seul public**, où le nombre de départs accompagne chaque prix :
 *
 * ```
 * Adultes : 1 tir 9.00 €uros 2 tirs 15 €uros | 6 € par départ supplémentaire
 * Licence A : 9,00 € (1 tir) | 16,00 € (2 tirs)
 * Jeunes 1 tir 7€ / tir supplémentaire + 6€
 * ```
 *
 * C'est aussi là qu'est relevé le supplément par départ.
 *
 * Les pénalités de désistement sont exclues des lignes brutes : « sera facturé 5 € » ressemble à
 * un tarif mais n'en est pas un.
 *
 * @param {string} text texte normalisé du mandat
 * @returns {import("./types.js").Tarifs}
 */
function extractTarifs(text) {
  const ls = lines(text);
  const tableaux = [];
  const bruts = [];
  /** Lignes du mandat qui ont réellement alimenté les tableaux : base du contrôle de provenance. */
  const sources = [];

  // ---- Stratégie 1 : les tableaux
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    // Un en-tête a plusieurs cellules et ne contient aucun montant : les prix sont en dessous
    if (!l.includes("|") || MONTANT.test(l)) continue;
    const cells = l.split("|").map((c) => c.trim());
    // Toutes les cellules doivent appartenir au vocabulaire tarifaire, sinon c'est une ligne
    // ordinaire qui contient par hasard un séparateur
    if (cells.length < 2 || !cells.every(estEnTete)) continue;

    // Cellule d'angle présente ou non : détermine à quelle colonne correspond la première valeur
    const hasCorner = CORNER.test(cells[0]);
    const colonnes = hasCorner ? cells.slice(1) : cells;

    let derniere = i; // dernière ligne consommée par ce tableau
    let manques = 0; // lignes sans prix rencontrées d'affilée
    let libelleEnAttente = null; // libellé écrit sur la ligne au-dessus de ses prix
    // Les lignes de valeurs suivent l'en-tête de près ; dix lignes suffisent largement
    for (let j = i + 1; j < ls.length && j <= i + 10; j++) {
      const row = cellulesDe(ls[j]);
      // Premier prix de la ligne. Un nombre sans symbole n'est admis qu'après le libellé :
      // en première position, ce serait plutôt un numéro de départ.
      const firstVal = row.findIndex((c, k) => MONTANT.test(c) || (k > 0 && NOMBRE_SEUL.test(c)));
      if (row.length < 2 || firstVal < 0) {
        // Certains clubs écrivent le libellé seul, puis les prix sur la ligne suivante :
        // « Catégories adulte » puis « 9 € | 16 € ». Une ligne sans prix qui nomme un public
        // ou un nombre de départs est retenue pour qualifier la ligne de prix qui suit.
        const brut = ls[j].trim();
        if (publicDe(brut) || nbDepartsDe(brut)) {
          libelleEnAttente = brut;
          continue;
        }
        // Une ligne parasite isolée peut s'intercaler ; deux d'affilée ferment le tableau
        if (++manques > 1) break;
        continue;
      }
      manques = 0;

      // Tout ce qui précède le premier prix constitue le libellé de la ligne ; à défaut, le
      // libellé lu sur la ligne précédente
      const libelle = row.slice(0, firstVal).join(" ").trim() || libelleEnAttente || `ligne ${j - i}`;
      libelleEnAttente = null;
      const entry = { categorie: libelle };
      row.slice(firstVal).forEach((c, k) => {
        const m = c.match(MONTANT) || c.match(NOMBRE_SEUL);
        if (m) entry[colonnes[k] || `col${k + 1}`] = enNombre(m[1]);
      });
      tableaux.push(entry);
      sources.push(ls[j]);
      derniere = j;
    }
    // On saute les lignes consommées, pour ne pas les relire comme un nouvel en-tête
    i = derniere;
  }

  // ---- Lignes brutes, hors pénalités qui ressemblent à des tarifs sans en être
  for (const l of ls) {
    if (MONTANT.test(l) && !/factur|pénalit|penalit/i.test(l)) bruts.push(l.replace(/\s*\|\s*/g, " ").trim());
  }

  // ---- Stratégie 2 : les phrases à deux publics
  // `nbCourant` suit le nombre de départs : indiqué quand le mandat le précise, incrémenté sinon,
  // en supposant que les tarifs sont énoncés dans l'ordre croissant, ce qui est l'usage.
  let nbCourant = 1;
  for (const l of bruts) {
    const nb = l.match(/(\d)\s*(?:er|ème|e)?\s*(?:tirs?|d[ée]parts?|concours)\b/i);
    if (nb) nbCourant = Number(nb[1]);
    const adulte = l.match(/adultes?[^\d€]{0,12}(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)/i);
    const jeune = l.match(/jeunes?[^\d€]{0,12}(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)/i);
    if (adulte || jeune) {
      const last = tableaux[tableaux.length - 1];
      // Cas du tarif éclaté sur deux lignes : « Adulte : 13 € » puis « Jeune : 9 € » désignent le
      // même nombre de départs. On complète l'entrée précédente au lieu d'en créer une nouvelle,
      // sans quoi on obtenait deux tarifs à un départ au lieu d'un seul tarif complet.
      if (!nb && last?.categorie.endsWith("(déduit)") && ((adulte && !("Adulte" in last)) || (jeune && !("Jeune" in last)))) {
        if (adulte) last.Adulte = enNombre(adulte[1]);
        if (jeune) last.Jeune = enNombre(jeune[1]);
        continue;
      }
      tableaux.push({
        categorie: nb ? `${nbCourant} départ${nbCourant > 1 ? "s" : ""}` : `${nbCourant} départ (déduit)`,
        ...(adulte && { Adulte: enNombre(adulte[1]) }),
        ...(jeune && { Jeune: enNombre(jeune[1]) }),
      });
      sources.push(l);
      if (!nb) nbCourant++;
    }
  }

  // ---- Stratégie 3 : les lignes à un seul public, et le supplément par départ
  /** @type {{adulte?: number, jeune?: number}} */
  const supplement = {};
  for (const l of bruts) {
    const pub = publicUnique(l);
    if (!pub) continue;

    const entry = { categorie: pub === "adulte" ? "Adulte" : "Jeune" };
    let trouves = 0;
    // « 2 tirs 15 € » : le nombre de départs précède le prix
    for (const m of l.matchAll(/(\d)\s*(?:tirs?|d[ée]parts?)\s*:?\s*(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)/gi)) {
      entry[`${m[1]} tir`] ??= enNombre(m[2]);
      trouves++;
    }
    // « 16,00 € (2 tirs) » : le prix précède le nombre de départs, entre parenthèses
    for (const m of l.matchAll(/(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)\s*\(\s*(\d)\s*(?:tirs?|d[ée]parts?)\s*\)/gi)) {
      entry[`${m[2]} tir`] ??= enNombre(m[1]);
      trouves++;
    }
    if (trouves) {
      tableaux.push(entry);
      sources.push(l);
    }

    // « tir supplémentaire + 6 € » ou « 6 € par départ supplémentaire »
    // Deux recherches séparées plutôt qu'une alternative : dans « 7 € / tir supplémentaire + 6 € »,
    // une alternative unique trouverait d'abord « 7 € / tir suppl… » et prendrait le prix de base
    // pour le supplément. La barre oblique sépare ici le prix de base de la règle, elle ne veut
    // pas dire « par ». Erreur réelle, attrapée par le test de non-régression sur Pornic.
    const sup =
      l.match(/(?:tirs?|d[ée]parts?)\s*suppl[ée]mentaires?\s*:?\s*\+?\s*(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)/i) ||
      l.match(/(\d+(?:[,.]\d{1,2})?)\s?(?:€|euros?)\s*par\s*(?:tir|d[ée]part)\s*suppl/i);
    if (sup) supplement[pub] ??= enNombre(sup[1]);
  }

  return {
    tableaux,
    grille: normaliserGrille(tableaux),
    lignes: uniq(bruts),
    sources: uniq(sources),
    supplement: Object.keys(supplement).length ? supplement : null,
  };
}

/**
 * Extrait un nombre de départs d'un libellé : « 2 tirs » donne 2, « 1er départ » donne 1.
 * @param {string} label
 * @returns {number|null}
 */
function nbDepartsDe(label) {
  const m = label.match(/(\d)\s*(?:er|ème|e)?\s*(tirs?|d[ée]parts?|concours)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Complète la grille à partir du prix d'un départ supplémentaire.
 *
 * « 1 tir 7 € / tir supplémentaire + 6 € » ne donne explicitement que le prix d'un départ. Le prix
 * de deux départs, 13 €, en découle pourtant sans ambiguïté : ce n'est pas une invention, c'est la
 * règle énoncée par le club, appliquée.
 *
 * La grille n'est prolongée **que jusqu'au nombre de départs réellement proposés** par le concours.
 * Calculer un tarif pour un troisième départ qui n'existe pas n'aurait aucun sens. Si les départs
 * n'ont pas pu être lus, la grille reste en l'état et la règle reste disponible dans `supplement`.
 *
 * Une valeur déjà présente n'est jamais écrasée : un prix écrit en toutes lettres dans le mandat
 * l'emporte toujours sur un prix déduit.
 *
 * @param {import("./types.js").Tarifs} tarifs modifiés en place
 * @param {number} nbDeparts nombre de départs du concours
 */
function etendreGrille(tarifs, nbDeparts) {
  const sup = tarifs.supplement;
  if (!sup || nbDeparts < 2) return;

  const grille = new Map(tarifs.grille.map((t) => [t.nb_departs, { ...t }]));
  for (const pub of /** @type {const} */ (["adulte", "jeune"])) {
    if (sup[pub] == null) continue;
    for (let n = 2; n <= nbDeparts; n++) {
      const precedent = grille.get(n - 1)?.[pub];
      if (precedent == null) break; // rien sur quoi s'appuyer
      const ligne = grille.get(n) || { nb_departs: n, adulte: null, jeune: null };
      // Arrondi au centime : 0,1 + 0,2 ne fait pas exactement 0,3 en virgule flottante
      ligne[pub] ??= Math.round((precedent + sup[pub]) * 100) / 100;
      grille.set(n, ligne);
    }
  }
  tarifs.grille = [...grille.values()].sort((a, b) => a.nb_departs - b.nb_departs);
}

/**
 * Ramène les tableaux, quelle que soit leur orientation, à une grille unique et exploitable.
 *
 * ## Le problème
 *
 * Les tableaux reconstitués gardent l'orientation choisie par le club. Selon les mandats, le nombre
 * de départs se lit en tête de ligne ou en tête de colonne, et le public à l'inverse. Une
 * application qui consommerait ces tableaux devrait gérer les deux cas.
 *
 * ## La solution
 *
 * On ne présume rien de l'orientation. Pour chaque valeur du tableau, on cherche le nombre de
 * départs **et** le public, indifféremment dans le libellé de ligne ou dans le titre de colonne.
 * L'opérateur `??` essaie l'un puis l'autre. Une valeur dont on ne parvient à déterminer ni l'un
 * ni l'autre est ignorée : mieux vaut une grille incomplète qu'une grille fausse.
 *
 * Le public `tous`, pour les tarifs uniques, renseigne les deux colonnes à la fois.
 *
 * L'affectation `??=` protège la première valeur rencontrée. Les mandats répètent parfois leurs
 * tarifs, dans un tableau puis dans le bulletin d'inscription ; le premier est le bon.
 *
 * @param {Object<string, string|number>[]} tableaux tableaux reconstitués
 * @returns {import("./types.js").LigneTarif[]} grille triée par nombre de départs croissant
 */
function normaliserGrille(tableaux) {
  const grille = new Map();
  for (const t of tableaux) {
    for (const [col, val] of Object.entries(t)) {
      if (col === "categorie") continue;
      const nb = nbDepartsDe(t.categorie) ?? nbDepartsDe(col);
      const aud = publicDe(t.categorie) ?? publicDe(col);
      if (nb === null || aud === null) continue;
      const g = grille.get(nb) || { nb_departs: nb, adulte: null, jeune: null };
      if (aud === "tous") {
        g.adulte ??= val;
        g.jeune ??= val;
      } else g[aud] ??= val;
      grille.set(nb, g);
    }
  }
  return [...grille.values()].sort((a, b) => a.nb_departs - b.nb_departs);
}
