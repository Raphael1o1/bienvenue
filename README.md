# Livret d'accueil

Page d'accueil des voyageurs, ouverte par le QR code du présentoir.

- `index.html` : l'interface (publique, sans contenu personnel).
- `contenu.enc` : le contenu du livret, **chiffré** (AES-GCM). Il ne se lit qu'avec la clé contenue dans le lien du QR code.
- `img/` : schéma du four et notice.
- `outils/construire.mjs` : chiffre le contenu et génère les QR codes.

Le dossier `prive/` (texte en clair, clé, lien complet, QR codes) n'est jamais publié.

## Changer l'adresse du livret

Le livret est servi par GitHub Pages (`raphael1o1.github.io/bienvenue`). Deux façons d'avoir une adresse plus soignée, au choix. Le site n'a rien à modifier : tous ses fichiers sont chargés par chemins relatifs, il fonctionne tel quel à la racine d'une autre adresse. Seul le lien des QR codes change.

### A. Hébergement gratuit avec un nom choisi (nom.netlify.app ou nom.pages.dev)

Le même dépôt est publié sur une plateforme gratuite ; GitHub Pages reste en place et sert d'**ancienne adresse** (voir plus bas). Aucun domaine à acheter. Éviter `workers.dev` (l'adresse contient le nom du compte Cloudflare) et, de préférence, `.dev`, jugé moins convivial.

**Netlify** (`https://<nom>.netlify.app`) :
1. *Add new site* → *Import an existing project* → GitHub → dépôt `bienvenue` (autoriser son accès si demandé).
2. Le fichier `netlify.toml` du dépôt règle déjà la publication (aucun build, la racine est publiée telle quelle) : laisser *Build command* et *Publish directory* tels que Netlify les remplit, puis *Deploy*.
3. *Site configuration* → *Change site name* : le nom choisi. Il peut être changé plus tard, mais l'ancien nom est alors libéré (les liens qui l'utilisent s'arrêtent).
4. L'offre gratuite fonctionne par crédits : 300 par mois, partagés par **tous les sites du compte**, plafond strict. Une publication coûte 15 crédits, 20 par Go de trafic et 2 par tranche de 10 000 requêtes. Un livret ouvert quelques centaines de fois par mois en consomme quelques-uns : ce sont surtout les publications des autres sites du compte qui comptent. Au-delà de 300, **tous** les sites du compte sont suspendus jusqu'au mois suivant. `netlify.toml` évite de republier le livret pour un simple changement du README ou des outils. À surveiller de temps en temps dans *Billing*.

**Cloudflare Pages** (`https://<nom>.pages.dev`, trafic statique illimité et gratuit) : *Workers & Pages* → *Create* → onglet *Pages* → *Import an existing Git repository* → dépôt `bienvenue` ; *Production branch* `main`, *Build command* vide, *Build output directory* `/`. Le nom du projet se change difficilement ensuite.

Ensuite :
5. **Renseigner la nouvelle adresse** dans `site.json` (champ `adresse`, par exemple `"https://nom.netlify.app/"`), puis commit et push. Dès le déploiement de GitHub Pages, l'ancienne adresse envoie les visiteurs vers la nouvelle.
6. **Contrôler** : `node outils/verifier-domaine.mjs` (lit `site.json`) vérifie la page, le contenu chiffré, les en-têtes et le comportement de l'ancienne adresse.
7. **Régénérer le lien et les QR codes** : `node outils/construire.mjs` utilise l'adresse de `site.json`. Le contenu et la clé ne changent pas. Imprimer le nouveau QR du dossier `prive/` et remplacer celui du présentoir quand c'est pratique.
8. **Tester** : scanner le nouveau QR avec un téléphone, ouvrir chaque onglet et envoyer une photo de test (le dépôt de photos et le signal d'ouverture passent par un script extérieur).

**Ce que devient l'ancienne adresse.** Tant que GitHub Pages reste actif, `raphael1o1.github.io/bienvenue` sert la même page, qui lit `site.json` et envoie aussitôt le visiteur vers la nouvelle adresse, en emportant la clé : celle du lien (`#…`), ou, pour un voyageur qui revient sans le lien, celle déjà mémorisée sur son téléphone. Les anciens QR codes continuent donc de marcher. Si `site.json` est vide ou introuvable, ou hors connexion, le livret s'affiche normalement sur l'ancienne adresse. Si GitHub Pages est un jour désactivé, les anciens QR s'arrêteront.

Le fichier `_headers` ajoute des en-têtes de sécurité simples (Netlify et Cloudflare Pages le lisent ; GitHub Pages l'ignore).

### B. Domaine personnalisé payant (environ 8 à 12 € par an)

À faire dans cet ordre (GitHub avant le DNS : l'inverse peut laisser quelqu'un d'autre publier sur votre sous-domaine) :

1. **Acheter le domaine** chez un registrar. Rien d'autre à y configurer que les enregistrements de l'étape 4.
2. **Vérifier le domaine auprès de GitHub** (recommandé contre la prise de contrôle) : compte GitHub → *Settings* → *Pages* → *Add a domain*. GitHub indique l'enregistrement **TXT** à créer chez le registrar.
3. **Dépôt → *Settings* → *Pages* → *Custom domain*** : saisir le domaine, *Save*. GitHub ajoute alors un fichier `CNAME` à la racine de la branche `main` : le récupérer avec `git pull`. Ne pas créer ce fichier à la main avant que les enregistrements DNS soient en place, au risque de rendre le livret inaccessible.
4. **Créer les enregistrements DNS** chez le registrar :
   - *domaine seul* (ex. `bienvenue-exemple.fr`) : 4 enregistrements **A** vers `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (et, facultatif, 4 **AAAA** vers `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`) ;
   - *sous-domaine* (ex. `livret.exemple.fr`) : un seul enregistrement **CNAME** vers `raphael1o1.github.io` (sans le nom du dépôt) ;
   - pas d'enregistrement générique (`*.exemple.fr`) ; supprimer les enregistrements par défaut du registrar.
5. **Attendre la propagation** (jusqu'à 24 h), puis cocher ***Enforce HTTPS*** dans *Settings* → *Pages* (le certificat peut prendre jusqu'à 24 h).
6. **Contrôler** : `node outils/verifier-domaine.mjs` (lit le fichier `CNAME`) vérifie le DNS, le HTTPS, le livret, la redirection http → https et le comportement de l'ancienne adresse.
7. **Régénérer le lien et les QR codes** : `node outils/construire.mjs` (domaine du fichier `CNAME`, ou variable `LIVRET_URL`).
8. **Tester** comme à l'étape 7 du A.

L'ancienne adresse ne peut pas rester servie en même temps que le domaine, et GitHub ne précise pas dans sa documentation si elle redirige vers lui : l'étape 6 le contrôle. Le plus sûr est de faire la bascule entre deux séjours et de remplacer le QR le jour même.

L'adresse est cherchée dans cet ordre : variable `LIVRET_URL`, champ `adresse` de `site.json`, fichier `CNAME`, adresse GitHub d'origine.

## Modifier le contenu

```bash
cd outils && npm install && cd ..
node outils/construire.mjs --dechiffrer   # recrée prive/contenu.json (clé dans prive/cle.txt ou LIVRET_CLE)
# … modifier prive/contenu.json …
node outils/construire.mjs                # régénère contenu.enc (même clé, même QR code)
```

Changer la clé (supprimer `prive/cle.txt` puis reconstruire) coupe l'accès aux anciens liens, mais oblige à réimprimer le QR code.
