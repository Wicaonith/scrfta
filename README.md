# ScrFta – les concours de tir à l'arc FFTA dans un tableur

ScrFta récupère automatiquement les compétitions publiées sur le calendrier fédéral
<https://www.ffta.fr/competitions>, lit la fiche de chaque concours et son mandat (le PDF d'invitation du club
organisateur), puis range le tout dans un fichier CSV ouvrable dans Excel ou LibreOffice.

Par défaut, il prend les concours des **Pays de la Loire** (44, 49, 53, 72, 85) sur les 12 prochains mois.
Toute autre région, tout département ou toute la France sont possibles (voir [Choisir ce qu'on récupère](#choisir-ce-quon-récupère)).

Pour chaque concours, on obtient : dates, discipline, club organisateur, lieu, contacts, lien vers la fiche
et vers le mandat, et quand le mandat est publié : les départs (horaires), les tarifs adulte / jeune, la date
limite et le moyen d'inscription, la jauge.

Dépôt : <https://gitlab.com/wicaonith/scrfta>

---

## 1. Installation

### Prérequis

- **Node.js** version 20 ou plus : <https://nodejs.org> (prendre la version « LTS », installation par défaut).
- **Git** : <https://git-scm.com/downloads> (installation par défaut).

Pour vérifier, ouvrir un terminal (sous Windows : menu Démarrer, taper `PowerShell`) et lancer :

```bash
node --version
```

Une ligne du type `v22.x.x` doit s'afficher.

### Récupérer et installer le projet

Dans le terminal, ligne par ligne :

```bash
git clone https://gitlab.com/wicaonith/scrfta.git
```

```bash
cd scrfta
```

```bash
npm install
```

La dernière commande télécharge les bibliothèques et un navigateur Chromium (environ 150 Mo). Elle peut prendre
une à trois minutes. C'est normal, et ce n'est fait qu'une fois.

---

## 2. Premier lancement

Toujours dans le dossier `scrfta` :

```bash
npm run scrape
```

Ce qui se passe, dans l'ordre :

1. Le navigateur (invisible) ouvre le calendrier FFTA et parcourt les pages de résultats.
2. Chaque fiche de concours est visitée. Compter environ une seconde par concours, donc 3 à 4 minutes pour
   200 concours.
3. Les mandats PDF sont téléchargés puis analysés. Au tout premier lancement, un fichier de langue pour la
   reconnaissance de texte (OCR, environ 15 Mo) est téléchargé.
4. Les fichiers de résultat sont écrits, et la dernière ligne affichée indique où.

Le terminal affiche la progression. Rien à faire pendant ce temps.

### Où est le résultat ?

Dans le dossier `output/` du projet :

| Fichier | Contenu |
| --- | --- |
| `output/competitions.csv` | Le tableau, une ligne par concours. À ouvrir dans Excel ou LibreOffice. |
| `output/competitions.json` | Les mêmes données en détail, pour un usage informatique. |
| `output/mandats/` | Les mandats PDF téléchargés. |
| `output/historique/` | Un relevé daté par lancement, pour le suivi des changements. |
| `output/rapport/index.html` | La page de suivi des changements (voir plus bas). |

### Ouvrir le CSV dans Excel

Le fichier est prêt pour Excel en français : un double-clic suffit, les colonnes et les accents sont corrects.
Si les accents apparaissent mal, passer par « Données → À partir d'un fichier texte/CSV » et choisir
l'encodage « UTF-8 » et le séparateur « point-virgule ».

Astuce : fermer le fichier dans Excel avant de relancer le scrapper. Sinon, le nouveau résultat est écrit dans
une copie horodatée à côté (`competitions.2026-09-10T....csv`) et le message le signale.

### Relancer plus tard

Relancer `npm run scrape` autant de fois que nécessaire. Les mandats déjà téléchargés ne sont repris que s'ils
ont changé sur le serveur, et les colonnes `epreuve_maj_le` indiquent quelles fiches ont bougé depuis
le dernier passage.

### Suivre les changements d'une semaine sur l'autre

Chaque lancement archive un relevé daté dans `output/historique/` (`2026-09-10.json`, un par jour, le dernier
du jour écrase les précédents) et régénère une page `output/rapport/index.html`. Cette page s'ouvre dans
n'importe quel navigateur, sans serveur ni connexion, et propose trois onglets :

- **Changements** : pour la période choisie dans le menu (d'un relevé au suivant), les nouveaux concours, ceux
  retirés du calendrier, les fiches modifiées (avant / après pour chaque champ), les mandats publiés avec leurs
  départs et tarifs, et les mandats modifiés (tarifs, départs, date limite…).
- **Calendrier actuel** : tous les concours du dernier relevé, avec un filtre texte.
- **Historique** : le nombre de concours et de mandats à chaque relevé.

Pour l'ouvrir dans le navigateur :

```bash
npm run voir
```

(ou double-cliquer sur `output/rapport/index.html`). Il faut au moins deux relevés pour voir des changements.
`npm run rapport` régénère la page sans rien télécharger. `--no-rapport` désactive l'archivage et le rapport
pour un lancement donné.

### Un concours, plusieurs épreuves FFTA

La FFTA publie souvent un même concours en plusieurs épreuves : une par jour (un week-end de campagne devient
« samedi » et « dimanche »), ou une par championnat (le tir à 18 m et le para-tir à 18 m du même club, au même
endroit, le même jour). Le CSV garde une ligne par épreuve, c'est l'unité du site, mais les regroupe :

| Colonne | Contenu |
| --- | --- |
| `concours_id` | Identifiant du concours physique : le plus petit id des épreuves regroupées |
| `concours_nb_epreuves` / `concours_epreuves` | Nombre et liste des épreuves du groupe |
| `concours_nb_departs` / `concours_departs_json` | Tous les départs du concours, avec pour chacun les épreuves concernées (`epreuves`) |

Deux épreuves sont regroupées si elles ont le même organisateur, le même lieu et les mêmes dates, ou si elles
partagent le même mandat (même contenu PDF, même publié sous deux noms). Dans le JSON, `concours.epreuves`
donne le détail de chaque épreuve du groupe (discipline, para, dates).

### Lancement automatique hebdomadaire (serveur Linux)

Sur un VPS Debian ou Ubuntu : installer Node.js 20+, Git, cloner le projet, puis `npm install` et
`npx playwright install --with-deps chromium` (bibliothèques système du navigateur). Une ligne dans `crontab -e`
lance le relevé chaque lundi à 6 h :

```
0 6 * * 1 cd /chemin/vers/scrfta && npm run scrape >> scrape.log 2>&1
```

La page `output/rapport/index.html` peut être servie telle quelle par nginx ou Caddy, avec un mot de passe
HTTP si elle doit rester privée. Si Cloudflare bloque le navigateur invisible depuis le serveur, lancer avec
`xvfb-run node src/scrape.js --headed`.

---

## 3. Choisir ce qu'on récupère

Sans option, c'est Pays de la Loire, 12 mois à venir. Pour autre chose, on ajoute des options après
`node src/scrape.js` (et non après `npm run scrape`). Exemples :

```bash
node src/scrape.js --region "Bretagne"
```

```bash
node src/scrape.js --region "Bretagne, Pays de la Loire"
```

```bash
node src/scrape.js --dep 44,85 --discipline salle
```

```bash
node src/scrape.js --region france --univers para --start 2027-01-01 --end 2027-03-31
```

Les options disponibles :

| Option | Rôle |
| --- | --- |
| `--region "<nom>"` | Une ou plusieurs régions séparées par des virgules, ou `france` pour tout le calendrier |
| `--dep 44,49` | Numéros de départements (`2A`, `974`… acceptés). Remplace `--region` |
| `--start` / `--end` | Dates de début et de fin au format `AAAA-MM-JJ` (défaut : aujourd'hui → +1 an) |
| `--discipline <code>` | `salle`, `tae` (extérieur), `campagne`, `3d`, `nature`, `beursault`, `run_archery`, `jeunes`, `poussin`, `loisir`… |
| `--univers <code>` | `cibles`, `parcours`, `para`, `run_archery`, `beursault` |
| `--search "<texte>"` | Recherche libre du site (titre, club, ville) |
| `--restreint 1` | Calendrier restreint uniquement (`0` pour l'exclure) |
| `--sort desc` | Du plus lointain au plus proche |
| `--out <dossier>` | Écrire les résultats ailleurs que dans `output/` |
| `--list-filters` | Afficher toutes les valeurs acceptées (régions avec leurs départements, disciplines, univers) |

Une valeur inconnue arrête le programme avec un message qui indique les valeurs possibles.

Les concours **internes** à un club (mot « INTERNE » dans le titre, réservés aux adhérents du club) sont écartés
d'office. `--inclure-internes` les garde.

Si vous suivez plusieurs périmètres (par exemple deux régions séparément), utilisez un dossier par périmètre
avec `--out`, sinon le suivi des modifications mélangera les deux.

Autres options, rarement utiles : `--limit N` (ne traiter que N concours, pour un essai rapide),
`--no-details`, `--no-mandats`, `--no-ocr`, `--headed` (navigateur visible), `--browser chrome`.

### Ré-analyser sans retourner sur le site

```bash
npm run reparse
```

Relit les mandats déjà téléchargés et régénère les fichiers de sortie, sans visiter ffta.fr. Utile après une
mise à jour du programme. Options : `--force` (ré-extraire même ce qui l'a déjà été), `--id 24876,26477`
(seulement ces concours), `--out`, `--no-ocr`, `--inclure-internes`.

---

## 4. En cas de problème

| Symptôme | Cause probable et solution |
| --- | --- |
| `node` ou `npm` : commande introuvable | Node.js n'est pas installé, ou le terminal a été ouvert avant l'installation. Installer Node.js, puis fermer et rouvrir le terminal. |
| `Bloqué par le challenge Cloudflare` | Le site a refusé le navigateur invisible. Relancer avec `node src/scrape.js --headed` (le navigateur s'affiche) ou `--browser chrome` si Chrome est installé. |
| `competitions.csv est verrouillé` | Le fichier est ouvert dans Excel. Le résultat a été écrit dans une copie horodatée à côté. Fermer Excel et relancer pour mettre à jour le fichier principal. |
| Le premier lancement semble figé au début | Téléchargement de Chromium (`npm install`) ou des données OCR (premier `npm run scrape`). Attendre. |
| `0 compétitions trouvées` | Les filtres ne correspondent à rien (par exemple des dates passées). Vérifier avec `--list-filters` et les exemples ci-dessus. |
| Colonnes `mandat_*` vides pour un concours | Le club n'a pas encore publié son mandat sur ffta.fr. Relancer plus tard. |
| `mandat_tarifs_fiable` ou `mandat_departs_fiable` à `non` | Le mandat a été lu, mais les valeurs sont douteuses (document scanné, mise en page inhabituelle). Ouvrir le PDF dans `output/mandats/` pour vérifier. |

---

## 5. Les colonnes du CSV

Une ligne par concours. Les colonnes `mandat_*` ne sont remplies que si le club a publié son mandat.

### Le concours

| Colonne | Contenu |
| --- | --- |
| `id` | Numéro du concours sur ffta.fr, stable dans le temps |
| `titre` | Nom du concours |
| `date_debut` / `date_fin` | Au format `AAAA-MM-JJ` ; identiques pour un concours d'un jour |
| `dates_texte` | Dates telles qu'affichées sur le site |
| `statut` | « Validée » en général |
| `discipline` | Libellé ffta.fr (« Tir à 18m », « Para-tir à l'arc à 18m »…) |
| `discipline_code` | Code court stable : `salle`, `tae`, `campagne`, `3d`, `nature`, `beursault`, `run_archery`, `loisir_*`… |
| `discipline_id` | Identifiant de la discipline sur ffta.fr |
| `discipline_base` | Libellé sans la mention para |
| `para` | `oui` si concours para-tir à l'arc |
| `championnat` | Championnat auquel le concours est rattaché |
| `type` | Individuel, équipes… |
| `duels` | Oui / Non |
| `organisateur` | Club organisateur |
| `departement` / `departement_nom` | Numéro et nom du département, déduits de l'adresse ou du comité |
| `ville`, `lieu`, `adresse` | Localisation |
| `comite_regional` / `comite_departemental` | Comités FFTA |
| `email`, `telephone`, `site` | Contacts du club |
| `url` | Lien vers la fiche ffta.fr |
| `concours_id`, `concours_nb_epreuves`, `concours_epreuves`, `concours_nb_departs`, `concours_departs_json` | Regroupement des épreuves d'un même concours physique (voir plus haut) |
| `epreuve_vue_le` | Date de la première fois où ce concours est apparu dans un export |
| `epreuve_maj_le` | Date du dernier changement constaté sur la fiche |
| `epreuve_hash` | Empreinte de la fiche (usage technique) |

### Le mandat

| Colonne | Contenu |
| --- | --- |
| `mandat_url` / `mandat_fichier` | Lien du PDF et copie locale |
| `mandat_modifie_le` | Date de dernière modification du PDF sur le serveur |
| `mandat_ocr` | `oui` si au moins une page a dû être lue par reconnaissance de texte (document scanné) |
| `mandat_departs` | Départs lisibles : « Samedi après-midi 2026-10-10 14:00 (48 pl.) \| Dimanche matin … » |
| `mandat_departs_json` | Les mêmes départs en JSON : `[{"nom","debut","greffe","echauffement","tirs","places","cibles"}]` |
| `mandat_departs_fiable` | `oui` si chaque départ a une date et une heure plausibles, sans passer par l'OCR |
| `mandat_nb_departs`, `mandat_depart1_datetime` | Nombre de départs, date et heure du premier |
| `mandat_jauge`, `mandat_cibles` | Places par départ et nombre de cibles, quand ils sont écrits |
| `mandat_tarifs` | Tarifs lisibles : « 1 départ : adulte 9 € / jeune 7 € \| 2 départs : … » |
| `mandat_tarifs_json` | Les mêmes en JSON : `[{"departs":1,"public":"adulte","montant_cents":900}, …]` |
| `mandat_tarifs_fiable` | `oui` si montants plausibles et cohérents, sans passer par l'OCR |
| `mandat_inscription_mode` | `url`, `mail` ou `courrier` |
| `mandat_inscription_url` / `mandat_inscription_email` | Lien ou adresse d'inscription |
| `mandat_date_limite_iso` / `mandat_date_limite` | Date limite d'inscription, en date et en texte d'origine |
| `mandat_distances`, `mandat_blasons`, `mandat_arbitres`, `mandat_buvette` | Détails pratiques |
| `mandat_emails`, `mandat_telephones` | Tous les contacts trouvés dans le PDF |

Le fichier `competitions.json` contient en plus le texte intégral de chaque mandat et le détail de chaque départ.

---

## 6. Limites à connaître

- Les mandats sont des documents libres. L'analyse couvre les mises en page courantes (tableaux d'horaires et
  de tarifs, mentions d'inscription), pas les affiches purement graphiques. Les colonnes `*_fiable` disent
  quand se méfier.
- L'OCR ne peut rien contre du texte posé sur une image de fond ou en police décorative.
- Les concours internes ne sont reconnus que par le mot « INTERNE » dans leur titre, seul marqueur disponible
  sur le site.
- Un même PDF partagé par plusieurs concours (week-end publié en deux épreuves) est analysé une fois, et seuls
  les départs du jour concerné sont attribués à chaque épreuve.

---

## 7. Pour les développeurs : fonctionnement interne

- `www.ffta.fr` est protégé par un challenge Cloudflare : les requêtes HTTP simples renvoient une page
  « Just a moment… ». Le scrapper pilote donc un Chromium headless via **Playwright**, qui passe le challenge.
- La liste est une vue Drupal filtrable par paramètres GET (`dep[]`, `start`, `end`, `discipline`, `univers`,
  `inter`, `search`, `page`). La conversion des options CLI vers ces paramètres est dans
  [src/filtres.js](src/filtres.js). Le mapping région → identifiants de départements, la table des
  départements, des disciplines et des univers sont dans [src/config.js](src/config.js) (repris de
  `drupalSettings.ffta_regions` et des `<select>` du formulaire du site).
- Les PDF de mandat sont téléchargés directement (pas de Cloudflare sur `extranet.ffta.fr`), avec vérification
  du `Last-Modified` pour ne retélécharger que ce qui a changé, puis analysés en trois couches :
  1. **Texte positionnel** ([src/pdf.js](src/pdf.js)) : les mots sont regroupés par ligne et par colonne avec
     pdf.js, les colonnes étant séparées par ` | `. Les tableaux (« Adultes | 9 € | 16 € ») sont ainsi conservés.
  2. **OCR** : toute page (quasi) vide de texte est rendue en image et passée à **Tesseract** (français) via
     `tesseract.js`. Les données de langue sont téléchargées une fois dans `.tessdata/`.
  3. **Heuristiques** ([src/mandat.js](src/mandat.js)), sans aucun appel réseau :
     - grille tarifaire normalisée (adulte / jeune par nombre de départs), quelle que soit l'orientation du tableau ;
     - départs reconstitués à partir des lignes « Ouverture du greffe | 13h00 | 8h30 | 13h30 »,
       « Échauffement | … », « Début des tirs | … » : un départ par colonne, nom et date pris dans l'en-tête
       (« Samedi après-midi », « DEPART 2 - 20/09 ») ou déduits (jour suivant quand l'heure repart en arrière) ;
     - jauge (« 96 archers par départ », « 3 x 48 places », « limité à 120 tireurs ») et nombre de cibles ;
     - moyen d'inscription (lien, URL courte, mail, courrier), date limite en texte et en ISO ;
     - arbitres, blasons, distances, contacts, buvette ;
     - indicateurs de fiabilité : cohérence des valeurs et absence de bruit OCR à la source.
- Le suivi des modifications ([src/output.js](src/output.js)) compare une empreinte de chaque fiche avec
  l'export précédent du même dossier.

Structure d'une compétition dans `competitions.json` :

```jsonc
{
  "id": "24879",
  "url": "https://www.ffta.fr/epreuve/24879",
  "titre": "TIR 3D à LA GARNACHE",
  "dates_texte": "Du 19 au 20 septembre 2026",
  "date_debut": "2026-09-19", "date_fin": "2026-09-20",
  "statut": "valid", "univers": "parcours",
  "discipline": "Tir 3d", "discipline_info": { "id": 108, "code": "3d", "base": "Tir 3D", "para": false },
  "type": "Individuel",
  "organisateur": "LES GARNA'ARCHERS", "ville": "LA GARNACHE",
  "departement": { "code": "85", "nom": "Vendée" },
  "email": "...", "site": "...", "mandat_url": "https://extranet.ffta.fr/medias/documents_epreuves/....pdf",
  "epreuve_vue_le": "...", "epreuve_maj_le": "...", "epreuve_hash": "...",
  "detail": {
    "statut": "Validée",
    "champs": { "discipline", "championnat", "duels", "comite_regional", "comite_departemental", "organisateur", "lieu" },
    "adresse": ["Zone de loisirs de l'équaizière", "85710 LA GARNACHE", "FRANCE"],
    "contacts": { "tel", "mail", "site" },
    "documents": []
  },
  "mandat": {
    "fichier": "mandats/....pdf", "pages": 3, "ocr": false, "ocr_pages": [], "modifie_le": "...",
    "infos": {
      "tarifs": {
        "grille": [{ "nb_departs": 1, "adulte": 10, "jeune": 8 }, { "nb_departs": 2, "adulte": 16, "jeune": 12 }],
        "tableaux": [ /* tableaux bruts reconstitués */ ],
        "lignes": [ /* lignes contenant un montant */ ],
        "fiable": true
      },
      "departs": [{ "nom": "DEPART 1", "date": "2026-09-19", "heure_greffe": "13:00", "heure_echauffement": "13:00",
                    "heure_debut_tirs": "14:00", "heure_debut": "13:00", "datetime": "2026-09-19T13:00", "jauge": null, "cibles": null }],
      "departs_fiable": true,
      "jauge": { "places": null, "cibles": null, "archers_par_cible": null, "texte": "..." },
      "date_limite_iso": "2026-09-16",
      "inscription": { "mode": "mail", "urls": [], "emails": ["..."], "texte": ["Les inscriptions sont à ..."] },
      "horaires": ["Ouverture du greffe | 13h00-13h30 | 07h45-08h15", "..."],
      "date_limite_inscription": "...", "emails": [], "telephones": [], "urls": [],
      "dates": [], "arbitres": "...", "distances": [], "blasons": [], "buvette": true, "adresse": "..."
    },
    "texte": "… texte intégral du PDF (mise en page conservée) …",
    "texte_ocr": "… texte des pages passées à l'OCR …"
  }
}
```

Fichiers du projet :

| Fichier | Rôle |
| --- | --- |
| `src/scrape.js` | Point d'entrée : navigateur, liste, fiches, puis mandats et sorties |
| `src/reparse.js` | Ré-analyse des mandats à partir d'un `competitions.json` existant |
| `src/filtres.js` | Options CLI → paramètres de la vue ffta.fr |
| `src/config.js` | Régions, départements, disciplines, univers, détection des concours internes |
| `src/analyse.js` | Téléchargement et analyse des mandats, un PDF partagé n'étant traité qu'une fois |
| `src/mandat.js` | Heuristiques d'extraction sur le texte du mandat |
| `src/pdf.js` | Extraction du texte positionnel et OCR |
| `src/dates.js` | Analyse des dates en français |
| `src/output.js` | Département, discipline, suivi des modifications, écriture JSON et CSV |
| `src/historique.js` | Archivage des relevés et comparaison entre deux relevés |
| `src/ouvrir.js` | Ouvre la page de suivi dans le navigateur par défaut (`npm run voir`) |
| `src/rapport.js` | Génération de la page HTML autonome de suivi |
| `scripts/apercu-rapport.mjs` | Ouvre la page dans Chromium headless, vérifie les erreurs JS, capture d'écran |
