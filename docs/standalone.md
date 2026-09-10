# Faire de ScrFta un logiciel autonome : intérêt et faisabilité

**Note d'analyse — 10 septembre 2026.** Ce document éclaire une décision, il ne la prend pas.
Aucun développement n'a été engagé dans cette direction.

## 1. La question posée

ScrFta s'utilise aujourd'hui en ligne de commande. Il faut installer Node.js et Git, cloner le dépôt,
lancer `npm install`, puis taper `npm run scrape`. Pour un développeur c'est trivial, pour un dirigeant de
club ce sont cinq occasions d'abandonner.

La question : peut-on livrer à la place un fichier à télécharger et à double-cliquer, comme n'importe quel
logiciel ? Et si oui, est-ce que ça vaut le coup ?

## 2. À qui cela servirait

Le besoin n'est réel que pour un profil précis : **une personne qui veut lancer ses propres relevés, sur son
propre périmètre, quand elle le décide.** Typiquement le responsable des compétitions d'un club d'une autre
région, qui veut la Bretagne et pas les Pays de la Loire, sur les dates qui l'arrangent.

Pour tous les autres usages, le standalone ne résout rien :

| Usage | Le standalone aide ? |
| --- | --- |
| Consulter les concours à venir de sa région | Non — une page web publiée suffit |
| Recevoir les nouveautés de la semaine | Non — un relevé automatique et un mail suffisent |
| Importer les données dans un autre site | Non — c'est un flux de fichiers, pas un logiciel de bureau |
| Lancer des relevés sur mesure, à la demande | **Oui** |

C'est la question centrale, et elle est stratégique plus que technique : combien de personnes veulent
réellement piloter leurs propres relevés ? Si la réponse est « une poignée », le rapport effort/bénéfice
penche fortement vers l'hébergement (section 6).

## 3. La contrainte qui commande tout

`www.ffta.fr` est protégé par un challenge Cloudflare. Une requête HTTP simple reçoit une page
« Just a moment… » à la place des données. Il faut un vrai navigateur, qui exécute le JavaScript du challenge.

Cette contrainte n'est pas contournable et détermine tout le reste : **le logiciel devra embarquer ou
télécharger un navigateur complet.** Tailles constatées sur le poste de développement :

| Composant | Taille sur disque |
| --- | --- |
| Chromium « headless shell » (mode invisible, celui utilisé en pratique) | 271 Mo |
| Chromium complet (nécessaire pour le mode visible, parade anti-Cloudflare) | 433 Mo |
| Binaire Node.js | 89 Mo |
| Dépendances du projet (`node_modules`) | 139 Mo |
| Données OCR françaises (Tesseract) | 1,2 Mo |
| **Code du projet lui-même** | **124 Ko, environ 2 100 lignes** |

Le code utile pèse un millième du reste. Tout le poids vient du moteur de navigation. À la compression,
un Chromium se ramène autour de 150 Mo de téléchargement, ce qui reste conséquent.

## 4. Les options techniques

### Option A — Exécutable Node autonome

Node.js sait produire un exécutable unique contenant le moteur et le code (fonctionnalité *Single Executable
Application*, encore marquée expérimentale). Des outils tiers font la même chose de façon plus établie
(`@yao-pkg/pkg`, ou `bun build --compile`).

- **Résultat** : un `ScrFta.exe` d'environ 100 à 120 Mo. Double-clic, une fenêtre de console s'ouvre, le
  navigateur est téléchargé au premier lancement dans le dossier de l'utilisateur.
- **Ce que ça règle** : plus besoin d'installer Node ni Git, plus de `npm install`.
- **Ce que ça ne règle pas** : l'utilisateur reste devant une console. Pour changer de région il faudra
  toujours taper des options, ou passer par un fichier de configuration.
- **Effort estimé** : 1 à 2 jours, dont la mise au point du téléchargement du navigateur au premier lancement.

### Option B — Application de bureau Electron

Une vraie fenêtre : listes déroulantes pour la région, la discipline et les dates, un bouton Lancer, une barre
de progression, et le rapport de suivi affiché directement dans l'application.

Une astuce évite de doubler le poids. Electron **embarque déjà Chromium**. Plutôt que d'ajouter celui de
Playwright et d'en trimballer deux, on fait le scraping avec la fenêtre d'Electron elle-même : elle charge
`ffta.fr` comme un vrai navigateur et passe le challenge de la même manière. Playwright disparaît alors des
dépendances, et il faut réécrire la couche de navigation, soit environ 250 lignes sur les 2 100 du projet.

- **Résultat estimé** : installeur de 90 à 120 Mo, environ 250 Mo installés.
- **Ce que ça règle** : c'est le seul scénario où l'outil devient utilisable par quelqu'un qui n'a jamais
  ouvert un terminal.
- **Effort estimé** : 3 à 5 jours pour une première version, sans compter la distribution (section 5).
- **Risque** : la couche de navigation réécrite doit repasser Cloudflare aussi bien que Playwright. À vérifier
  très tôt par un prototype d'une demi-journée, avant de s'engager sur le reste.

### Option C — Lanceur local

Un fichier `.bat` sous Windows qui lance le relevé puis ouvre la page de rapport. Node reste à installer.

- **Effort** : quelques heures.
- **Limite** : ce n'est pas un logiciel autonome, seulement un raccourci. Ne répond pas à la question posée,
  mais reste le meilleur rapport effort/résultat pour un utilisateur qui accepte d'installer Node une fois.

## 5. Ce qui coûte vraiment : la distribution

Le développement n'est pas le poste principal. Les frictions de distribution le sont, et elles sont
récurrentes, pas ponctuelles.

**Signature de code.** Un exécutable non signé téléchargé depuis Internet déclenche sous Windows
l'avertissement SmartScreen « Windows a protégé votre ordinateur ». Il faut cliquer sur « Informations
complémentaires » puis « Exécuter quand même » : beaucoup d'utilisateurs non techniques s'arrêtent là, et
c'est précisément le public visé. Un certificat de signature coûte de l'ordre de cent à quatre cents euros
par an. Sur macOS c'est plus strict encore : sans notarisation, Gatekeeper refuse purement et simplement
d'ouvrir l'application, et la notarisation suppose un compte développeur Apple payant à l'année.

**Faux positifs antivirus.** Les binaires produits par ce type d'empaquetage sont régulièrement signalés à
tort. Chaque signalement demande une déclaration auprès de l'éditeur concerné, et se reproduit à chaque
nouvelle version.

**Mises à jour.** C'est le point le plus important, et le plus sous-estimé. Un scrapper dépend de la structure
d'un site qu'il ne contrôle pas. Le jour où la FFTA modifie sa page, toutes les copies installées cessent de
fonctionner en même temps. Sans mécanisme de mise à jour automatique, chaque utilisateur reste bloqué sur sa
version et se tourne vers le mainteneur. Il faut donc prévoir dès le départ un système de mise à jour, ce qui
ajoute de l'ordre d'une journée de développement et une infrastructure d'hébergement des versions.

**Support.** Diffuser un logiciel, c'est accepter les retours d'installation sur des configurations qu'on ne
maîtrise pas. C'est un coût permanent, indépendant du code.

## 6. L'alternative : ne rien installer chez personne

Le projet dispose déjà de tout ce qu'il faut pour l'option inverse : `output/rapport/index.html` est une page
autonome, sans serveur ni base de données.

Le scénario : le relevé tourne une fois par semaine sur un petit serveur, et la page est publiée en ligne,
par exemple via GitLab Pages qui est gratuit pour un projet public.

| Critère | Standalone | Hébergé |
| --- | --- | --- |
| Installation par l'utilisateur | 100 à 350 Mo à télécharger | Aucune, un lien |
| Signature, notarisation, antivirus | À gérer et à payer | Sans objet |
| Mises à jour | À développer et à diffuser | Une seule installation à maintenir |
| Périmètre sur mesure par utilisateur | Oui | Non, périmètre fixé à l'avance |
| Effort initial | 3 à 5 jours + distribution | Une demi-journée |

L'hébergé perd exactement une chose : la possibilité pour chacun de choisir ses propres filtres. Tout le reste
lui est favorable.

## 7. Recommandation

**Commencer par l'hébergement, et ne considérer le standalone que si le besoin se confirme.**

Le raisonnement : l'hébergement se met en place en une demi-journée, ne coûte rien en frictions, et couvre
trois des quatre usages listés en section 2. Il permet surtout de **mesurer l'intérêt réel** avant d'investir.
Si, une fois la page publiée, plusieurs personnes demandent des périmètres différents, alors le besoin de
relevés à la demande est démontré et le standalone se justifie. Si personne ne le demande, on aura économisé
une semaine de développement et un coût annuel récurrent.

Dans l'hypothèse où le standalone serait décidé, l'option B (Electron avec sa propre fenêtre de navigation)
est la seule qui apporte un vrai gain d'usage. L'option A produit un exécutable qui reste une console, c'est
beaucoup d'inconvénients de distribution pour un confort marginal.

## 8. Si le standalone est décidé : ordre de marche

Trois jalons, avec une porte de sortie après chacun.

1. **Prototype de navigation (une demi-journée).** Vérifier qu'une fenêtre Electron passe le challenge
   Cloudflare et récupère la liste des concours. Si ce n'est pas le cas, l'option B s'effondre et il faut
   revenir à l'option A avec son Chromium séparé. **À faire avant tout engagement.**
2. **Version utilisable (3 à 4 jours).** Interface de choix des filtres, lancement, progression, affichage du
   rapport, export du CSV. Testée par une personne extérieure au projet, non technique.
3. **Distribution (2 jours et un budget annuel).** Empaquetage, signature, mise à jour automatique,
   page de téléchargement.

Le jalon 3 est celui qu'il ne faut pas sous-estimer : c'est lui qui transforme un projet personnel en logiciel
diffusé, avec les obligations qui vont avec.
