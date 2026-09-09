// Vérifie que le module LLM se charge et que le schéma se compile, sans appel réseau.
import { MandatSchema, LLM_MODEL, createLlmClient } from "../src/llm.js";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
const fmt = zodOutputFormat(MandatSchema);
console.log("modèle :", LLM_MODEL);
console.log("format :", fmt.type, "| propriétés :", Object.keys(fmt.schema.properties).length);
console.log("client :", createLlmClient() ? "OK (identifiants trouvés)" : "aucun identifiant");
