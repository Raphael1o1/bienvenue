# Livret d'accueil

Page d'accueil des voyageurs, ouverte par le QR code du présentoir.

- `index.html` : l'interface (publique, sans contenu personnel).
- `contenu.enc` : le contenu du livret, **chiffré** (AES-GCM). Il ne se lit qu'avec la clé contenue dans le lien du QR code.
- `img/` : schéma du four et notice.
- `outils/construire.mjs` : chiffre le contenu et génère les QR codes.

Le dossier `prive/` (texte en clair, clé, lien complet, QR codes) n'est jamais publié.

## Adresse personnalisée (domaine)

Le livret est servi par GitHub Pages, gratuitement. Pour une adresse plus professionnelle que `raphael1o1.github.io/bienvenue`, on y associe un nom de domaine à soi (environ 8 à 12 € par an). L'hébergement reste le même.

Le site n'a rien à modifier : tous ses fichiers sont chargés par des chemins relatifs, il fonctionne tel quel à la racine d'un domaine. Seul le **lien des QR codes** change.

À faire dans cet ordre (GitHub avant le DNS : l'inverse peut laisser quelqu'un d'autre publier sur votre sous-domaine) :

1. **Acheter le domaine** chez un registrar de votre choix. Rien d'autre à y configurer que les enregistrements de l'étape 4.
2. **Vérifier le domaine auprès de GitHub** (recommandé contre la prise de contrôle) : compte GitHub → *Settings* → *Pages* → *Add a domain*. GitHub indique l'enregistrement **TXT** à créer chez le registrar.
3. **Dépôt → *Settings* → *Pages* → *Custom domain*** : saisir le domaine, *Save*. GitHub ajoute alors un fichier `CNAME` à la racine de la branche `main` : le récupérer avec `git pull`. Ne pas créer ce fichier à la main avant que les enregistrements DNS soient en place.
4. **Créer les enregistrements DNS** chez le registrar :
   - *domaine seul* (ex. `bienvenue-exemple.fr`) : 4 enregistrements **A** vers `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (et, facultatif, 4 **AAAA** vers `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`) ;
   - *sous-domaine* (ex. `livret.exemple.fr`) : un seul enregistrement **CNAME** vers `raphael1o1.github.io` (sans le nom du dépôt) ;
   - pas d'enregistrement générique (`*.exemple.fr`) ; supprimer les enregistrements par défaut du registrar.
5. **Attendre la propagation** (jusqu'à 24 h), puis cocher ***Enforce HTTPS*** dans *Settings* → *Pages* (le certificat peut prendre jusqu'à 24 h).
6. **Contrôler** : `node outils/verifier-domaine.mjs` (lit le fichier `CNAME`) vérifie le DNS, le HTTPS, le livret, la redirection http → https et le comportement de l'ancienne adresse.
7. **Régénérer le lien et les QR codes** : `node outils/construire.mjs` utilise le domaine du fichier `CNAME` (ou la variable `LIVRET_URL`). Le contenu et la clé ne changent pas. Imprimer le nouveau QR du dossier `prive/` et remplacer celui du présentoir.
8. **Tester** : scanner le nouveau QR avec un téléphone, ouvrir chaque onglet et envoyer une photo de test (le dépôt de photos et le signal d'ouverture passent par un script extérieur : à confirmer depuis le nouveau domaine).

L'ancienne adresse ne peut pas rester servie en même temps que le domaine. GitHub ne précise pas dans sa documentation si elle redirige vers le nouveau : l'étape 6 le contrôle. Le plus sûr est de faire la bascule entre deux séjours et de remplacer le QR le jour même.

## Modifier le contenu

```bash
cd outils && npm install && cd ..
node outils/construire.mjs --dechiffrer   # recrée prive/contenu.json (clé dans prive/cle.txt ou LIVRET_CLE)
# … modifier prive/contenu.json …
node outils/construire.mjs                # régénère contenu.enc (même clé, même QR code)
```

Changer la clé (supprimer `prive/cle.txt` puis reconstruire) coupe l'accès aux anciens liens, mais oblige à réimprimer le QR code.
