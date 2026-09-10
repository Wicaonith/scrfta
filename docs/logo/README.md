# Pistes de logo

Trois propositions pour l'avatar du projet, à comparer dans [comparaison.png](comparaison.png) qui les montre
en grand puis aux tailles réelles d'affichage sur GitLab (64, 40 et 24 pixels).

| Fichier | Idée | Verdict |
| --- | --- | --- |
| `a-calendrier.svg` | Une page de calendrier avec une flèche plantée en diagonale | Dit ce que fait l'outil : le calendrier des concours |
| `b-cible.svg` | Une cible classique traversée par une flèche | Le plus lisible en petit, lecture immédiate |
| `c-cible-tableau.svg` | Une cible dont les anneaux sont des lignes de tableau | L'idée disparaît en dessous de 128 pixels, à écarter |

Chaque `.svg` a son `.png` exporté en 256 × 256, la taille conseillée pour un avatar GitLab.
Pour régénérer les PNG après modification d'un SVG :

```bash
node scripts/logo-export.mjs
```

Pour poser l'avatar : **Settings → General → Project avatar → Upload**, puis choisir le `.png`.

## Palette

| Rôle | Couleur |
| --- | --- |
| Fond | `#12385F` bleu nuit |
| Or de la cible, flèche | `#F2B705` |
| Bleu de la cible | `#2E77C4` |
| Aplats clairs | `#FFFFFF`, `#9FBBD6`, `#CBD8E5` |

L'or et le bleu sont les couleurs de blason internationales : elles disent « tir à l'arc » sans appartenir à
personne. Le projet n'étant pas officiel, ces dessins évitent volontairement le logo, la typographie et
l'identité visuelle de la FFTA, pour qu'aucune confusion ne soit possible.
