// Rejoue l'extraction sur le texte des mandats d'un export et n'en garde que les champs dérivés.
//
// Aucune donnée personnelle n'est conservée : ni adresse mail, ni téléphone, ni nom d'arbitre.
// Seuls des nombres, des dates et des libellés techniques, qui suffisent à détecter une régression.
import { reextractInfos } from "../../src/mandat.js";

export function deriver(competitions) {
  return competitions
    .filter((c) => c.mandat?.texte)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((c) => {
      const i = reextractInfos(c.mandat.texte, {
        date_debut: c.date_debut,
        date_fin: c.date_fin,
        texte_ocr: c.mandat.texte_ocr,
      });
      return {
        id: String(c.id),
        titre: c.titre,
        ocr: !!c.mandat.ocr,
        tarifs: i.tarifs.grille,
        tarifs_fiable: !!i.tarifs.fiable,
        departs: i.departs.map((d) => ({
          nom: d.nom,
          debut: d.datetime,
          places: d.jauge ?? null,
          hors_epreuve: !!d.hors_epreuve,
        })),
        departs_fiable: !!i.departs_fiable,
        places: i.jauge.places,
        cibles: i.jauge.cibles,
        date_limite: i.date_limite_iso,
        inscription_mode: i.inscription.mode,
        // On compte les contacts sans les enregistrer
        nb_urls_inscription: i.inscription.urls.length,
        nb_emails_inscription: i.inscription.emails.length,
        distances: i.distances,
        blasons: i.blasons ?? [],
        buvette: i.buvette,
      };
    });
}
