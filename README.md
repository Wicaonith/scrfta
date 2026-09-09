# ScrFta – scrapper des compétitions FFTA

Récupère les compétitions à venir publiées sur <https://www.ffta.fr/competitions>, leur fiche détaillée
(`/epreuve/<id>`) et leur mandat (PDF hébergé sur `extranet.ffta.fr`), filtrées par région
(par défaut **Pays de la Loire** : 44, 49, 53, 72, 85).

## Fonctionnement

- `www.ffta.fr` est protégé par un challenge Cloudflare : les requêtes HTTP simples renvoient une page
  « Just a moment… ». Le scrapper pilote donc un Chromium headless via **Playwright**, qui passe le challenge.
- La liste est une vue Drupal filtrable par paramètres GET (`dep[]`, `start`, `end`, `discipline`, `page`).
  Le mapping région → identifiants de départements est dans [src/config.js](src/config.js)
  (repris de `drupalSettings.ffta_regions` du site).
- Les PDF de mandat sont téléchargés directement (pas de Cloudflare sur l'extranet) puis analysés en trois couches :
  1. **Texte positionnel** ([src/pdf.js](src/pdf.js)) : les mots sont regroupés par ligne et par colonne avec
     pdf.js, les colonnes étant séparées par ` | `. Les tableaux (« Adultes | 9 € | 16 € ») sont ainsi conservés.
  2. **OCR** : toute page (quasi) vide de texte est rendue en image et passée à **Tesseract** (français) via
     `tesseract.js`. Les données de langue sont téléchargées une fois dans `.tessdata/`.
  3. **Heuristiques** ([src/mandat.js](src/mandat.js)), sans aucun appel réseau ni token :
     - grille tarifaire normalisée (adulte / jeune par nombre de départs), quelle que soit l'orientation du tableau ;
     - **départs** reconstitués à partir des lignes « Ouverture du greffe | 13h00 | 8h30 | 13h30 »,
       « Échauffement | … », « Début des tirs | … » : un départ par colonne, nom et date pris dans l'en-tête
       (« Samedi après-midi », « DEPART 2 - 20/09 ») ou déduits (jour suivant quand l'heure repart en arrière),
       avec `datetime` ISO prêt pour un formulaire ;
     - jauge (« 96 archers par départ », « 3 x 48 places », « limité à 120 tireurs ») et nombre de cibles ;
     - moyen d'inscription (lien, URL courte, mail, courrier), date limite en texte et en ISO (`date_limite_iso`) ;
     - arbitres, blasons, distances, contacts, buvette.
     Quand un mandat couvre un week-end alors que l'épreuve ffta.fr ne fait qu'un jour, les départs de l'autre
     jour sont marqués `hors_epreuve`.
  4. **Optionnel, LLM** ([src/llm.js](src/llm.js)) : le texte du mandat est envoyé à Claude avec un schéma de
     sortie strict calqué sur un formulaire de saisie (départs, tarifs, inscription, lieu, rythme…). Résultat
     mis en cache dans `output/llm-cache/` pour ne jamais payer deux fois le même mandat.

## Installation

```bash
npm install
```

(le `postinstall` télécharge Chromium pour Playwright)

Pour l'analyse LLM, définir une clé API Anthropic :

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

Le modèle utilisé est `claude-opus-5` (modifiable avec la variable `SCRFTA_LLM_MODEL`).

## Utilisation

```bash
npm run scrape            # scrape + mandats (texte, OCR, heuristiques)
npm run scrape:llm        # idem + structuration par Claude
npm run reparse           # ré-analyse les mandats d'un output existant sans re-scraper
npm run reparse:llm       # idem avec Claude
```

Options de `node src/scrape.js` (`--help`) :

| Option | Description |
| --- | --- |
| `--region "<nom>"` | Région (défaut `Pays de la Loire`) |
| `--dep 45,50` | Identifiants ffta.fr de départements (remplace `--region`) |
| `--start` / `--end` | Bornes de dates `YYYY-MM-DD` (défaut : aujourd'hui → +1 an) |
| `--discipline <id>` | 103 = 18 m, 102 = TAE, 107 = campagne, 108 = 3D, 109 = nature, 110 = beursault… |
| `--limit N` | Ne traiter que N compétitions |
| `--no-details` | Ne pas visiter les fiches détaillées |
| `--no-mandats` | Ne pas télécharger / analyser les mandats |
| `--no-ocr` | Désactiver l'OCR des pages scannées |
| `--llm` | Structurer chaque mandat avec Claude |
| `--headed` | Navigateur visible (si Cloudflare bloque le headless) |
| `--browser chrome` | Utiliser Chrome / Edge installé plutôt que le Chromium de Playwright |
| `--out <dir>` | Dossier de sortie (défaut `output`) |

Options de `node src/reparse.js` : `--out`, `--llm`, `--no-ocr`, `--force` (ré-extrait même si déjà analysé),
`--id 24876,26477` (ne traiter que ces épreuves).

## Sorties

- `output/competitions.json` : toutes les données (liste + fiche + mandat avec texte intégral et structure LLM).
- `output/competitions.csv` : une ligne par compétition (séparateur `;`, UTF-8 BOM, ouvrable dans Excel).
  Si le fichier est verrouillé (ouvert dans Excel), une copie horodatée est écrite à côté.
- `output/mandats/*.pdf` : les mandats téléchargés (non retéléchargés s'ils existent déjà).
- `output/llm-cache/*.json` : réponses de Claude, clé = hash du texte du mandat.

Structure d'une compétition dans le JSON :

```jsonc
{
  "id": "24879",
  "url": "https://www.ffta.fr/epreuve/24879",
  "titre": "TIR 3D à LA GARNACHE",
  "dates_texte": "Du 19 au 20 septembre 2026",
  "date_debut": "2026-09-19", "date_fin": "2026-09-20",
  "statut": "valid", "univers": "parcours",
  "discipline": "Tir 3d", "type": "Individuel",
  "organisateur": "LES GARNA'ARCHERS", "ville": "LA GARNACHE",
  "email": "...", "site": "...", "mandat_url": "https://extranet.ffta.fr/medias/documents_epreuves/....pdf",
  "detail": {
    "statut": "Validée",
    "champs": { "discipline", "championnat", "duels", "comite_regional", "comite_departemental", "organisateur", "lieu" },
    "adresse": ["Zone de loisirs de l'équaizière", "85710 LA GARNACHE", "FRANCE"],
    "contacts": { "tel", "mail", "site" },
    "documents": []
  },
  "mandat": {
    "fichier": "mandats/....pdf", "pages": 3, "ocr": false, "ocr_pages": [],
    "infos": {
      "tarifs": {
        "grille": [{ "nb_departs": 1, "adulte": 10, "jeune": 8 }, { "nb_departs": 2, "adulte": 16, "jeune": 12 }],
        "tableaux": [ /* tableaux bruts reconstitués */ ],
        "lignes": [ /* lignes contenant un montant */ ]
      },
      "departs": [{ "nom": "DEPART 1", "date": "2026-09-19", "heure_greffe": "13:00", "heure_echauffement": "13:00",
                    "heure_debut_tirs": "14:00", "heure_debut": "13:00", "datetime": "2026-09-19T13:00", "jauge": null, "cibles": null }],
      "jauge": { "places": null, "cibles": null, "archers_par_cible": null, "texte": "..." },
      "date_limite_iso": "2026-09-16",
      "inscription": { "mode": "mail", "urls": [], "emails": ["..."], "texte": ["Les inscriptions sont à ..."] },
      "horaires": ["Ouverture du greffe | 13h00-13h30 | 07h45-08h15", "..."],
      "date_limite_inscription": "...", "emails": [], "telephones": [], "urls": [],
      "dates": [], "arbitres": "...", "distances": [], "blasons": [], "buvette": true, "adresse": "..."
    },
    "llm": {            // présent avec --llm
      "modele": "claude-opus-5", "usage": { "input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0 },
      "titre", "organisateur", "discipline", "lieu": { "nom", "adresse", "code_postal", "ville", "gps" },
      "dates": { "debut", "fin", "texte" },
      "departs": [{ "nom", "date", "heure_greffe", "heure_echauffement", "heure_debut_tirs", "heure_debut", "jauge", "cibles", "archers_par_cible", "categories" }],
      "tarifs": [{ "nb_departs", "adulte", "jeune", "detail" }], "autres_tarifs": [],
      "inscription": { "mode", "url", "email", "adresse_postale", "contact_nom", "contact_telephone", "date_limite", "date_limite_texte", "paiement", "consignes" },
      "rythme", "distances", "blasons", "arbitres", "selectif", "championnat_support", "duels",
      "restauration", "hebergement", "informations_complementaires"
    },
    "texte": "… texte intégral du PDF (mise en page conservée) …"
  }
}
```

Dans le CSV, les colonnes `mandat_*` utilisent les heuristiques (`mandat_departs`, `mandat_nb_departs`,
`mandat_depart1_datetime`, `mandat_jauge`, `mandat_tarifs`, `mandat_date_limite_iso`…) et la structure LLM
quand elle existe.

## Limites

- Les mandats sont des documents libres : les heuristiques couvrent les mises en page courantes, l'analyse LLM
  est nettement plus fiable pour les cas atypiques (tableaux complexes, texte OCR bruité).
- L'OCR ne peut rien contre des affiches très graphiques (texte sur image de fond, polices décoratives).
- Un même PDF partagé par plusieurs épreuves (concours sur deux jours) n'est analysé qu'une fois par exécution.
