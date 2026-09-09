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

## Installation

```bash
npm install
```

(le `postinstall` télécharge Chromium pour Playwright)

## Utilisation

```bash
npm run scrape            # scrape + mandats (texte, OCR, heuristiques)
npm run reparse           # ré-analyse les mandats d'un output existant sans re-scraper
```

Sans option, le scrapper prend les Pays de la Loire sur les 12 prochains mois. Tous les filtres de la page
ffta.fr/competitions sont disponibles (`node src/scrape.js --help`, `--list-filters` pour les valeurs acceptées) :

| Filtre | Description |
| --- | --- |
| `--region "<nom>"` | Une ou plusieurs régions séparées par des virgules (`"Bretagne, Pays de la Loire"`), ou `france` pour tout le calendrier |
| `--dep 44,49` | Numéros de départements (`2A`, `974`… acceptés), remplace `--region` |
| `--start` / `--end` | Bornes de dates `YYYY-MM-DD` (défaut : aujourd'hui → +1 an) |
| `--discipline <code>` | `salle`, `tae`, `campagne`, `3d`, `nature`, `beursault`, `run_archery`, `jeunes`, `poussin`, `loisir`… ou libellé ffta.fr |
| `--univers <code>` | `cibles`, `parcours`, `para`, `run_archery`, `beursault` |
| `--search "<texte>"` | Recherche libre du site (titre, club, ville) |
| `--restreint [0|1]` | Calendrier restreint uniquement (1) ou exclu (0) |
| `--sort desc` | Ordre décroissant de date |

Exemples :

```bash
node src/scrape.js                                        # Pays de la Loire, 12 mois
node src/scrape.js --region "Bretagne, Pays de la Loire"  # deux régions
node src/scrape.js --dep 44,85 --discipline salle         # salle en 44 et 85
node src/scrape.js --region france --univers para --start 2027-01-01 --end 2027-03-31
```

Options de traitement :

| Option | Description |
| --- | --- |
| `--limit N` | Ne traiter que N compétitions |
| `--no-details` | Ne pas visiter les fiches détaillées |
| `--inclure-internes` | Garder les concours internes à un club (« INTERNE » dans le titre), exclus par défaut |
| `--no-mandats` | Ne pas télécharger / analyser les mandats |
| `--no-ocr` | Désactiver l'OCR des pages scannées |
| `--headed` | Navigateur visible (si Cloudflare bloque le headless) |
| `--browser chrome` | Utiliser Chrome / Edge installé plutôt que le Chromium de Playwright |
| `--out <dir>` | Dossier de sortie (défaut `output`) |

Options de `node src/reparse.js` : `--out`, `--no-ocr`, `--inclure-internes`, `--force` (ré-extrait même si déjà analysé),
`--id 24876,26477` (ne traiter que ces épreuves).

## Sorties

- `output/competitions.json` : toutes les données (liste + fiche + mandat avec texte intégral).
- `output/competitions.csv` : une ligne par compétition (séparateur `;`, UTF-8 BOM, ouvrable dans Excel).
  Si le fichier est verrouillé (ouvert dans Excel), une copie horodatée est écrite à côté.
- `output/mandats/*.pdf` : les mandats téléchargés (non retéléchargés s'ils existent déjà).

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
    "texte": "… texte intégral du PDF (mise en page conservée) …"
  }
}
```

Dans le CSV, une ligne par compétition. Colonnes notables :

| Colonne | Contenu |
| --- | --- |
| `id` | Identifiant d'épreuve ffta.fr, stable |
| `date_debut` / `date_fin` | ISO ; `date_fin` = `date_debut` pour un concours d'un jour |
| `discipline`, `discipline_code`, `discipline_id`, `discipline_base`, `para` | Libellé ffta.fr, code court stable du projet (`salle`, `tae`, `campagne`, `3d`, `nature`, `beursault`…), id de taxonomie ffta.fr, libellé sans la mention para, `para` oui/non |
| `departement` / `departement_nom` | Déduits du code postal de l'adresse, sinon du comité départemental |
| `epreuve_vue_le` / `epreuve_maj_le` / `epreuve_hash` | Première apparition dans un export, dernière modification constatée de la fiche (comparaison d'empreinte avec l'export précédent), empreinte |
| `mandat_modifie_le` | `Last-Modified` du PDF côté serveur ; le PDF est retéléchargé s'il change |
| `mandat_departs_json` | `[{"nom","debut","greffe","echauffement","tirs","places","cibles"}]` |
| `mandat_tarifs_json` | `[{"departs":1,"public":"adulte","montant_cents":1200}, …]` |
| `mandat_departs_fiable` / `mandat_tarifs_fiable` | oui/non : valeurs plausibles et cohérentes, aucune ligne source issue de l'OCR |
| `mandat_departs`, `mandat_tarifs`, `mandat_inscription_*`, `mandat_date_limite_iso`… | Versions lisibles des mêmes informations |

## Limites

- Les mandats sont des documents libres : les heuristiques couvrent les mises en page courantes (tableaux
  d'horaires et de tarifs, mentions d'inscription), pas les affiches purement graphiques.
- L'OCR ne peut rien contre des affiches très graphiques (texte sur image de fond, polices décoratives).
- Un même PDF partagé par plusieurs épreuves (concours sur deux jours) n'est analysé qu'une fois par exécution.
