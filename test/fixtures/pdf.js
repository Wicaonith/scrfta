// Fabrique un PDF minimal mais valide, pour tester la lecture sans embarquer de fichier binaire
// dans le dépôt. Chaque mot est posé à une position choisie, ce qui permet de vérifier la
// reconstitution des lignes et des colonnes de bout en bout.

/** Échappe les caractères qui ont un sens dans une chaîne PDF. */
const echapper = (s) => String(s).replace(/([\\()])/g, "\\$1");

/**
 * @param {Array<Array<{texte: string, x: number, y: number, taille?: number}>>} pages
 *        Un tableau par page, contenant les mots à poser (origine en bas à gauche).
 * @returns {Buffer} le PDF prêt à être écrit sur disque
 */
export function creerPdf(pages) {
  const n = pages.length;
  const idPolice = 3 + 2 * n;
  const objets = [];

  objets[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objets[1] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${n} >>`;

  pages.forEach((_, i) => {
    objets[2 + i] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${3 + n + i} 0 R` +
      ` /Resources << /Font << /F1 ${idPolice} 0 R >> >> >>`;
  });

  pages.forEach((lignes, i) => {
    const contenu = lignes
      .map((l) => `BT /F1 ${l.taille || 12} Tf ${l.x} ${l.y} Td (${echapper(l.texte)}) Tj ET`)
      .join("\n");
    objets[2 + n + i] = `<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`;
  });

  objets[2 + 2 * n] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  // Assemblage avec une table de références croisées correctement positionnée
  let pdf = "%PDF-1.4\n";
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const positionXref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) pdf += `${String(p).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${positionXref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

/** Un mandat d'une page, en deux colonnes, suffisamment fourni pour ne pas être pris pour un scan. */
export const mandatSimple = [
  [
    { texte: "LES ARCHERS DE TESTVILLE", x: 60, y: 760, taille: 14 },
    { texte: "Concours en salle du 17 octobre 2026", x: 60, y: 735 },
    { texte: "Gymnase municipal, 44000 TESTVILLE", x: 60, y: 715 },
    { texte: "Ouverture du greffe", x: 60, y: 680 },
    { texte: "8h30", x: 400, y: 680 },
    { texte: "Debut des tirs", x: 60, y: 660 },
    { texte: "9h15", x: 400, y: 660 },
    { texte: "Tarifs : Adultes : 9 EUR - Jeunes 7 EUR", x: 60, y: 620 },
    { texte: "Inscriptions avant le 12 octobre 2026 par mail", x: 60, y: 600 },
    { texte: "a concours@archers-testville.fr", x: 60, y: 580 },
    { texte: "Buvette et sandwichs sur place toute la journee.", x: 60, y: 560 },
  ],
];
