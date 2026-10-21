/**
 * @file Définitions des structures de données qui circulent dans le projet.
 *
 * Ce fichier ne contient aucun code exécutable : uniquement des `@typedef` JSDoc.
 * Il sert de dictionnaire central, référencé depuis les autres modules par
 * `@import` ou `@type`, et compris par les éditeurs pour l'autocomplétion.
 *
 * ## Vocabulaire du tir à l'arc, pour qui découvre le domaine
 *
 * - **Concours** : l'événement organisé par un club, un ou plusieurs jours.
 * - **Épreuve** : l'unité que publie la FFTA sur son calendrier. Un même concours physique
 *   apparaît souvent en plusieurs épreuves : une par jour, ou une par championnat
 *   (le tir à 18 m et le para-tir à 18 m d'un même après-midi sont deux épreuves).
 * - **Mandat** : le PDF d'invitation rédigé par le club organisateur. Il contient les horaires,
 *   les tarifs et les modalités d'inscription. Sa mise en page est libre, d'où la difficulté à le lire.
 * - **Départ** : un créneau de tir. Un concours en propose souvent deux ou trois
 *   (samedi après-midi, dimanche matin, dimanche après-midi), chacun avec ses horaires.
 * - **Greffe** : l'accueil, où l'archer se présente avant de tirer.
 * - **Blason** : la cible en papier. Sa taille dépend de la discipline et de la catégorie.
 * - **Jauge** : le nombre de places disponibles sur un départ.
 * - **TAE** : tir à l'arc extérieur, par opposition au tir en salle à 18 mètres.
 */

/**
 * Une compétition telle qu'on la produit : une épreuve du calendrier fédéral,
 * enrichie de sa fiche détaillée, de son mandat analysé et de données dérivées.
 *
 * @typedef {object} Competition
 * @property {string} id            Identifiant de l'épreuve sur ffta.fr, stable dans le temps
 * @property {string} url           Adresse de la fiche, `https://www.ffta.fr/epreuve/<id>`
 * @property {string} titre         Intitulé, par exemple « TIR 3D à LA GARNACHE »
 * @property {string} dates_texte   Dates telles qu'affichées, par exemple « Du 19 au 20 septembre 2026 »
 * @property {string|null} date_debut  Premier jour, `AAAA-MM-JJ`
 * @property {string|null} date_fin    Dernier jour, égal à `date_debut` pour un concours d'un jour
 * @property {string|null} statut   État brut de la liste, par exemple « valid »
 * @property {string|null} univers  Univers fédéral déduit de la couleur de la vignette
 * @property {string|null} discipline  Libellé de discipline, par exemple « Tir à 18m »
 * @property {DisciplineInfo|null} discipline_info  Discipline structurée, ajoutée par `completerCompetitions`
 * @property {string|null} type     « Individuel », « Équipes »…
 * @property {string|null} organisateur  Nom du club
 * @property {string|null} ville    Commune du club, entre parenthèses dans la liste
 * @property {Departement|null} departement  Département déduit de l'adresse ou du comité
 * @property {string|null} email    Adresse de contact affichée dans la liste
 * @property {string|null} site     Site web du club
 * @property {string|null} mandat_url  Lien du PDF d'invitation, absent tant que le club ne l'a pas publié
 * @property {string[]} pictos      Classes des pictogrammes de la vignette (label Exalto, etc.)
 * @property {Detail} [detail]      Contenu de la fiche détaillée
 * @property {Mandat} [mandat]      Mandat téléchargé et analysé
 * @property {Concours} [concours]  Regroupement des épreuves d'un même concours physique
 * @property {string} [epreuve_vue_le]  Date du relevé où l'épreuve est apparue pour la première fois
 * @property {string} [epreuve_maj_le]  Date du relevé où sa fiche a changé pour la dernière fois
 * @property {string} [epreuve_hash]    Empreinte du contenu de la fiche, base du suivi des modifications
 * @property {string} [detail_erreur]   Message si la fiche n'a pas pu être lue
 * @property {string} [mandat_erreur]   Message si le mandat n'a pas pu être téléchargé ou analysé
 */

/**
 * Contenu de la fiche détaillée `/epreuve/<id>`.
 *
 * @typedef {object} Detail
 * @property {string|null} dates_texte
 * @property {string|null} statut      Libellé lisible, par exemple « Validée »
 * @property {string|null} mandat_url
 * @property {Object<string,string>} champs  Couples « libellé : valeur » de la fiche, clés normalisées
 *   (`discipline`, `championnat`, `duels`, `comite_regional`, `comite_departemental`, `organisateur`, `lieu`)
 * @property {string[]} adresse        Lignes d'adresse du lieu de tir
 * @property {Object<string,string>} contacts  `tel`, `mail`, `site`
 * @property {{titre: string, url: string}[]} documents  Pièces jointes éventuelles
 */

/**
 * Département français, tel que le projet le manipule.
 *
 * @typedef {object} Departement
 * @property {string} code  Numéro officiel : « 44 », « 2A », « 974 »…
 * @property {string} nom   Nom, par exemple « Loire-Atlantique »
 */

/**
 * Discipline structurée, déduite du libellé affiché par la FFTA.
 *
 * @typedef {object} DisciplineInfo
 * @property {string} libelle  Libellé d'origine, par exemple « Para-tir à l'arc à 18m »
 * @property {number|null} id  Identifiant de taxonomie ffta.fr, utilisable comme filtre
 * @property {string} code     Code court stable de ce projet : `salle`, `tae`, `campagne`, `3d`…
 * @property {string} base     Libellé débarrassé de la mention para, par exemple « Tir à 18m »
 * @property {boolean} para    Vrai s'il s'agit d'une épreuve para-tir à l'arc
 */

/**
 * Mandat téléchargé, lu et analysé.
 *
 * @typedef {object} Mandat
 * @property {string} fichier      Chemin local relatif, par exemple `mandats/1105a3c640b89.pdf`
 * @property {number} pages        Nombre de pages du PDF
 * @property {boolean} ocr         Vrai si au moins une page a dû passer par la reconnaissance de caractères
 * @property {number[]} ocr_pages  Numéros de ces pages, à partir de 1
 * @property {string|null} [modifie_le]  Date de dernière modification annoncée par le serveur, en ISO
 * @property {string} [hash]       Empreinte du contenu du PDF, qui permet de reconnaître un mandat
 *                                 publié sous deux noms de fichier différents
 * @property {InfosMandat} infos   Informations extraites du texte
 * @property {string} texte        Texte intégral, mise en page conservée (colonnes séparées par « | »)
 * @property {string} texte_ocr    Texte des seules pages passées à l'OCR, sert à juger de la fiabilité
 */

/**
 * Informations tirées du texte d'un mandat par les heuristiques de `mandat.js`.
 *
 * @typedef {object} InfosMandat
 * @property {Tarifs} tarifs        Grille tarifaire, à différents degrés de raffinement
 * @property {Depart[]} departs     Créneaux de tir reconstitués
 * @property {boolean} departs_fiable  Faux si les départs sont douteux (OCR, horaires improbables)
 * @property {Jauge} jauge          Places et cibles
 * @property {Inscription} inscription  Comment s'inscrire
 * @property {string|null} date_limite_iso  Date limite d'inscription, `AAAA-MM-JJ` ou `AAAA-MM-JJTHH:MM`
 * @property {string} [date_limite_inscription]  La phrase d'origine, pour vérification humaine
 * @property {string[]} horaires    Lignes brutes contenant un horaire, filet de sécurité si `departs` est vide
 * @property {string[]} emails      Toutes les adresses trouvées dans le PDF
 * @property {string[]} telephones  Tous les numéros trouvés, chiffres uniquement
 * @property {string[]} urls        Tous les liens trouvés
 * @property {string[]} dates       Dates en toutes lettres rencontrées
 * @property {string} [arbitres]    Section « Arbitres : … » si elle existe
 * @property {string[]} distances   Distances de tir, par exemple « 18m », « 70m »
 * @property {string[]} [blasons]   Lignes mentionnant un blason
 * @property {boolean} buvette      Vrai si buvette, restauration ou sandwichs sont annoncés
 * @property {string} [adresse]     Première ligne contenant un code postal et une commune
 */

/**
 * Tarifs d'un mandat, du plus exploitable au plus brut.
 *
 * `grille` est la forme à utiliser ; `tableaux` et `lignes` servent de repli quand la
 * normalisation échoue, et permettent à un humain de vérifier ce qui a été lu.
 *
 * @typedef {object} Tarifs
 * @property {LigneTarif[]} grille   Forme normalisée : un prix adulte et un prix jeune par nombre de départs
 * @property {Object<string,string|number>[]} tableaux  Tableaux reconstitués tels quels, clé `categorie` en tête
 * @property {string[]} lignes       Lignes du PDF contenant un montant
 * @property {string[]} sources      Lignes qui ont réellement alimenté `tableaux`, et donc `grille`
 * @property {{adulte?: number, jeune?: number}|null} supplement  Prix d'un départ supplémentaire
 *   par public, quand le mandat l'exprime ainsi (« tir supplémentaire + 6 € »). La grille est
 *   déjà prolongée d'après cette règle jusqu'au nombre de départs proposés.
 * @property {boolean} [fiable]      Faux si les valeurs sont incohérentes ou proviennent de l'OCR
 */

/**
 * Prix **total** pour un nombre de départs, réduction multi-départs comprise : si un départ
 * coûte 10 € et deux 15 €, la ligne à deux départs vaut 15, pas 10 par départ.
 *
 * @typedef {object} LigneTarif
 * @property {number} nb_departs   Nombre de départs couverts par ce tarif : 1, 2, 3…
 * @property {number|null} adulte  Prix en euros pour un adulte (U21 et au-delà)
 * @property {number|null} jeune   Prix en euros pour un jeune (U11 à U18)
 */

/**
 * Un créneau de tir.
 *
 * @typedef {object} Depart
 * @property {string} nom                 Nom repris du mandat, ou « Départ N » à défaut
 * @property {string|null} date           `AAAA-MM-JJ`
 * @property {string|null} heure_greffe   Ouverture de l'accueil, `HH:MM`
 * @property {string|null} heure_echauffement
 * @property {string|null} heure_debut_tirs
 * @property {string|null} heure_debut    Heure de référence : greffe si connue, sinon échauffement, sinon tirs
 * @property {string|null} datetime       `date` et `heure_debut` réunis, prêt pour un formulaire
 * @property {number|null} jauge          Places sur ce départ
 * @property {number|null} cibles         Nombre de cibles
 * @property {boolean} [hors_epreuve]     Vrai si ce départ tombe en dehors des dates de l'épreuve courante,
 *                                        cas d'un mandat couvrant un week-end publié en deux épreuves
 */

/**
 * @typedef {object} Jauge
 * @property {number|null} places   Places par départ
 * @property {number|null} cibles   Nombre de cibles du parcours ou du pas de tir
 * @property {number|null} archers_par_cible
 * @property {string|null} texte    Phrase d'origine, pour vérification
 */

/**
 * @typedef {object} Inscription
 * @property {"url"|"mail"|"courrier"|null} mode  Moyen principal d'inscription
 * @property {string[]} urls    Liens d'inscription, URL courtes comprises
 * @property {string[]} emails  Adresses vers lesquelles envoyer les inscriptions
 * @property {string[]} texte   Phrases du mandat qui parlent d'inscription
 */

/**
 * Regroupement des épreuves correspondant à un même concours physique.
 *
 * @typedef {object} Concours
 * @property {string} id            Identifiant du groupe : le plus petit identifiant d'épreuve
 * @property {number} nb_epreuves   Nombre d'épreuves réunies
 * @property {EpreuveDuConcours[]} epreuves
 * @property {DepartDeConcours[]} departs  Départs de toutes les épreuves du groupe, dédoublonnés
 */

/**
 * @typedef {object} EpreuveDuConcours
 * @property {string} id
 * @property {string} titre
 * @property {string} dates_texte
 * @property {string|null} date_debut
 * @property {string|null} date_fin
 * @property {string|null} discipline
 * @property {boolean|null} para
 * @property {boolean} mandat  Vrai si cette épreuve a un mandat publié
 */

/**
 * @typedef {object} DepartDeConcours
 * @property {string} nom
 * @property {string|null} debut       Date et heure en ISO
 * @property {string|null} greffe
 * @property {string|null} echauffement
 * @property {string|null} tirs
 * @property {number|null} places
 * @property {string[]} epreuves       Identifiants des épreuves auxquelles ce départ appartient
 */

/**
 * Filtres résolus, prêts à être transformés en paramètres d'URL.
 *
 * @typedef {object} Filtres
 * @property {string[]} depIds   Identifiants ffta.fr des départements ; vide signifie « toute la France »
 * @property {Object<string,string>} params  Autres paramètres de requête (`start`, `end`, `discipline`…)
 * @property {object} description  Version lisible, écrite dans le JSON de sortie pour tracer l'origine
 */

// Ce fichier n'exporte que des types : l'export vide évite qu'un import le considère comme un script.
export {};
