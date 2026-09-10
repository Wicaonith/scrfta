// Mandats synthétiques reproduisant les mises en page réellement rencontrées sur les PDF de la FFTA.
// Clubs, adresses et contacts sont inventés : aucune donnée personnelle réelle dans les tests.
// Le format imite la sortie de src/pdf.js : les colonnes d'un tableau sont séparées par « | ».

/** Horaires et tarifs en colonnes, un départ par colonne, dates dans l'en-tête (style tir 3D sur deux jours). */
export const colonnes = {
  contexte: { date_debut: "2026-10-17", date_fin: "2026-10-18" },
  texte: `LES ARCHERS DE TESTVILLE
ont le plaisir de vous inviter à leur concours de
TIR 3D
Samedi 17 et Dimanche 18 octobre 2026
Parc des Sports, 44000 TESTVILLE
HORAIRES
DEPART 1 - 17/10 | DEPART 2 - 18/10 | DEPART 3 - 18/10
Ouverture du greffe | 13h00-13h30 | 07h45-08h15 | 13h00-13h30
Échauffement | 13h00-13h45 | 07h45-08h30 | 13h00-13h45
Début des tirs | 14h00 | 08h45 | 14h00
ENGAGEMENTS
1 DEPART | 2 DEPARTS | 3 DEPARTS
U21 à Senior 3 | 10,00 € | 16,00 € | 22,00 €
Jeunes de U13 à U18 | 8,00 € | 12,00 € | 16,00 €
Inscriptions limitées à 96 archers par départ.
Les inscriptions sont à renvoyer par mail avant le mercredi 14 octobre 2026 à concours@archers-testville.fr
Buvette et restauration sur place toute la journée.`,
};

/** Tarifs en colonnes « Adulte | Jeune », lignes « 1 tir » et « 2 tirs » (style tir extérieur sur un jour). */
export const tarifsAdulteJeune = {
  contexte: { date_debut: "2026-09-20", date_fin: "2026-09-20" },
  texte: `COMPAGNIE D'ARC DE TESTVILLE
Concours TAE de septembre
Dimanche 20 septembre 2026
Horaires :
1er départ | 2e départ
Ouverture du greffe | 8 h 30 | 13 h 15
Inspection du matériel | 9 h | 13 h 45
Échauffement | 9 h 15 | 14 h
Début des tirs | À l'issue des 3 volées d'échauffement
Tarifs des inscriptions :
Adulte | Jeune
1 tir | 9 € | 7 €
2 tirs | 16 € | 12 €
Tir au rythme AB/CD sur blason de 122 cm à 70m.
Les inscriptions sont à envoyer avant le mardi 15 septembre 2026 par courrier à la compagnie.`,
};

/** Départs décrits ligne par ligne, jauge par départ (style beursault). */
export const lignes = {
  contexte: { date_debut: "2026-09-13", date_fin: "2026-09-13" },
  texte: `COMPAGNIE D'ARC DE TESTBOURG
CHAMPIONNAT REGIONAL BEURSAULT
Dimanche 13 Septembre 2026
1er départ | Accueil greffe | 8H00
Dimanche matin | Inspection du matériel / Début de l'échauffement | 8H30
Début des tirs - Dès la fin de l'échauffement -
2 ème départ | Accueil greffe | 13H30
Dimanche après midi | Inspection du matériel / Début de l'échauffement | 14H00
Début des tirs - Dès la fin de l'échauffement -
15 Places maximum par départ - Tir uniquement dans le Jeu d'Arc
Tarifs | 1 tir | 2 tirs
Adultes | 9 € | 16 €
Jeunes | 7 € | 12 €
Les inscriptions sont à adresser au plus tard le 09 Septembre 2026 à :
Contact Testbourg, 72000 TESTBOURG
Sur place : buvette, sandwichs.`,
};

/** Tarifs rédigés en phrases, inscription par URL courte, deux départs sur la même ligne (style 3D). */
export const enLigne = {
  contexte: { date_debut: "2026-09-13", date_fin: "2026-09-13" },
  texte: `L'ARC NATURE DE TESTVILLE
Est heureux de vous inviter à son concours
TIR SUR CIBLES 3D
13 septembre 2026
24 CIBLES - 2 DÉPARTS SIMULTANÉS
Greffe : 07h30 - 08h30 | Greffe : 12h45 - 13h30
Début des tirs 09h00 | Début des tirs 14h00
1 départ : Adultes : 12 € - Jeunes 7 €
2 départs : Adultes : 18 € - Jeunes 12 €
Clôture des inscriptions le 06 septembre 2026
INSCRIPTION EN LIGNE : https://urlz.fr/aBcDeF
GRILLADES et BOISSONS disponibles sur place.`,
};

/** Piège : une pénalité de désistement ne doit être ni un tarif ni la date limite d'inscription. */
export const piegePenalite = {
  contexte: { date_debut: "2026-10-24", date_fin: "2026-10-24" },
  texte: `LE TOURNOI DE TESTVILLE
Samedi 24 octobre 2026
Ouverture du greffe | 13h30
Echauffement | 14h10
Début des tirs | Fin de l'échauffement
Les inscriptions seront faites dans l'ordre d'arrivée et à concurrence des places disponibles.
Tout désistement non signalé avant le jeudi 22 octobre 12h sera facturé 5€.
Toute absence non justifiée par un certificat médical sera également facturée 5€.
Inscriptions avant le mercredi 21 octobre 2026 par mail à tournoi@archers-testville.fr`,
};

/** Tarifs incohérents (le jeune plus cher que l'adulte) : la grille doit être marquée non fiable. */
export const tarifsIncoherents = {
  contexte: { date_debut: "2026-11-07", date_fin: "2026-11-07" },
  texte: `CLUB DE TESTVILLE
Samedi 7 novembre 2026
Ouverture du greffe | 8h00
Début des tirs | 9h00
Tarifs | 1 tir
Adultes | 7 €
Jeunes | 12 €`,
};
