import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const LLM_MODEL = process.env.SCRFTA_LLM_MODEL || "claude-opus-5";

/** Structure calquée sur le formulaire de saisie d'un concours. */
export const MandatSchema = z.object({
  titre: z.string().nullable().describe("Intitulé du concours tel qu'écrit dans le mandat"),
  organisateur: z.string().nullable().describe("Nom du club organisateur"),
  discipline: z
    .enum(["salle", "tae", "campagne", "3d", "nature", "beursault", "run_archery", "para", "loisir", "autre"])
    .nullable()
    .describe("salle = tir en salle 18m, tae = tir à l'arc extérieur"),
  lieu: z
    .object({
      nom: z.string().nullable().describe("Nom du site (gymnase, terrain, jeu d'arc...)"),
      adresse: z.string().nullable(),
      code_postal: z.string().nullable(),
      ville: z.string().nullable(),
      gps: z.string().nullable(),
    })
    .describe("Lieu de la compétition"),
  dates: z.object({
    debut: z.string().nullable().describe("Premier jour, format YYYY-MM-DD"),
    fin: z.string().nullable().describe("Dernier jour, format YYYY-MM-DD"),
    texte: z.string().nullable().describe("Dates telles qu'écrites dans le mandat"),
  }),
  departs: z
    .array(
      z.object({
        nom: z.string().describe("Ex. « Départ 1 », « Samedi après-midi »"),
        date: z.string().nullable().describe("YYYY-MM-DD"),
        heure_greffe: z.string().nullable().describe("Ouverture du greffe, HH:MM"),
        heure_echauffement: z.string().nullable().describe("HH:MM"),
        heure_debut_tirs: z.string().nullable().describe("HH:MM"),
        heure_debut: z.string().nullable().describe("Heure de référence du départ (greffe si connue, sinon échauffement, sinon tirs), HH:MM"),
        jauge: z.number().int().nullable().describe("Nombre de places (archers) si indiqué"),
        cibles: z.number().int().nullable().describe("Nombre de cibles si indiqué"),
        archers_par_cible: z.number().int().nullable(),
        categories: z.string().nullable().describe("Catégories ou arcs réservés à ce départ, si précisé"),
      })
    )
    .describe("Un élément par départ (créneau de tir). Liste vide si non précisé."),
  tarifs: z
    .array(
      z.object({
        nb_departs: z.number().int().describe("Nombre de départs (tirs) couverts par ce tarif : 1, 2, 3..."),
        adulte: z.number().nullable().describe("Prix en euros pour un adulte (U21 et plus / seniors)"),
        jeune: z.number().nullable().describe("Prix en euros pour un jeune (U11 à U18), null si non précisé"),
        detail: z.string().nullable().describe("Précisions : catégories exactes, tarif dégressif, etc."),
      })
    )
    .describe("Grille tarifaire par nombre de départs. Liste vide si non précisé."),
  autres_tarifs: z.array(z.string()).describe("Repas, tarif découverte, tarif club, etc."),
  inscription: z.object({
    mode: z.enum(["url", "mail", "courrier", "sur_place", "autre"]).nullable(),
    url: z.string().nullable().describe("Lien d'inscription en ligne, y compris URL courte"),
    email: z.string().nullable(),
    adresse_postale: z.string().nullable(),
    contact_nom: z.string().nullable(),
    contact_telephone: z.string().nullable(),
    date_limite: z.string().nullable().describe("YYYY-MM-DD, ou YYYY-MM-DDTHH:MM si une heure est donnée"),
    date_limite_texte: z.string().nullable(),
    paiement: z.string().nullable().describe("Modalités de paiement (chèque, virement, HelloAsso, sur place...)"),
    consignes: z.string().nullable().describe("Consignes particulières : priorité régionale, remboursement, etc."),
  }),
  rythme: z.string().nullable().describe("Rythme de tir : AB/CD, ABC, 1 archer par cible..."),
  distances: z.array(z.string()).describe("Distances de tir mentionnées, ex. « 18m », « 30m U13 »"),
  blasons: z.array(z.string()).describe("Blasons mentionnés, ex. « 40cm », « trispot sur demande »"),
  arbitres: z.array(z.string()).describe("Noms des arbitres, l'arbitre responsable en premier"),
  selectif: z.boolean().nullable().describe("Sélectif / qualificatif pour un championnat"),
  championnat_support: z.string().nullable().describe("Ex. « Championnat départemental de Vendée »"),
  duels: z.boolean().nullable(),
  restauration: z.string().nullable().describe("Buvette, repas, sandwichs et leurs prix"),
  hebergement: z.string().nullable(),
  informations_complementaires: z
    .string()
    .nullable()
    .describe("Tout ce qui est utile à un club inscrivant ses archers et qui n'entre pas dans les champs précédents. 5 lignes maximum."),
});

const SYSTEM_PROMPT = `Tu extrais les informations d'un mandat de concours de tir à l'arc (document diffusé par un club organisateur, fédération FFTA) pour pré-remplir la fiche d'un club qui veut y inscrire ses archers.

Consignes :
- Ne renseigne que ce qui est écrit dans le document. Utilise null ou une liste vide quand l'information est absente. N'invente rien.
- Le texte peut provenir d'un tableau aplati : les colonnes sont séparées par « | » et une ligne d'en-tête précède les valeurs. Reconstitue les tableaux (tarifs par nombre de tirs, horaires par départ).
- Le texte peut provenir d'un OCR bruité : ignore le bruit, ne le recopie pas.
- « 1 tir » / « 2 tirs » = nombre de départs. Adulte = U21 et plus ; jeune = U11 à U18.
- Les pénalités (désistement facturé, absence facturée) ne sont pas des tarifs d'inscription : mets-les dans inscription.consignes.
- Dates au format ISO (YYYY-MM-DD). Si l'année n'est pas écrite, déduis-la du contexte fourni. Heures au format HH:MM.
- Un départ = un créneau de tir avec ses propres horaires. Si plusieurs jours ont les mêmes horaires, crée un départ par jour.`;

/** Renvoie un client Anthropic ou null si aucune authentification n'est disponible. */
export function createLlmClient() {
  try {
    return new Anthropic();
  } catch (e) {
    return null;
  }
}

/**
 * Structure un mandat via Claude (sortie JSON validée par le schéma).
 * Le résultat est mis en cache sur disque (clé = hash du texte + modèle) pour ne pas payer deux fois.
 */
export async function structureMandat(client, texte, contexte, { cacheDir } = {}) {
  const key = crypto
    .createHash("sha256")
    .update(LLM_MODEL + "\n" + JSON.stringify(contexte) + "\n" + texte)
    .digest("hex")
    .slice(0, 24);
  const cacheFile = cacheDir ? path.join(cacheDir, `${key}.json`) : null;
  if (cacheFile) {
    try {
      return JSON.parse(await fs.readFile(cacheFile, "utf8"));
    } catch {}
  }

  const userContent = `Contexte connu (fiche ffta.fr) :
${JSON.stringify(contexte, null, 2)}

Texte du mandat :
<<<
${texte}
>>>`;

  const response = await client.messages.parse({
    model: LLM_MODEL,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(MandatSchema), effort: "medium" },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Refus du modèle : ${response.stop_details?.explanation || "sans explication"}`);
  }
  if (!response.parsed_output) {
    throw new Error(`Réponse non conforme au schéma (stop_reason=${response.stop_reason})`);
  }

  const result = {
    modele: LLM_MODEL,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
    ...response.parsed_output,
  };
  if (cacheFile) {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(result, null, 2));
  }
  return result;
}
