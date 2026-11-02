# Livret d'accueil

Page d'accueil des voyageurs, ouverte par le QR code du présentoir.

- `index.html` : l'interface (publique, sans contenu personnel).
- `contenu.enc` : le contenu du livret, **chiffré** (AES-GCM). Il ne se lit qu'avec la clé contenue dans le lien du QR code.
- `img/` : schéma du four et notice.
- `outils/construire.mjs` : chiffre le contenu et génère les QR codes.

Le dossier `prive/` (texte en clair, clé, lien complet, QR codes) n'est jamais publié.

## Modifier le contenu

```bash
cd outils && npm install && cd ..
node outils/construire.mjs --dechiffrer   # recrée prive/contenu.json (clé dans prive/cle.txt ou LIVRET_CLE)
# … modifier prive/contenu.json …
node outils/construire.mjs                # régénère contenu.enc (même clé, même QR code)
```

Changer la clé (supprimer `prive/cle.txt` puis reconstruire) coupe l'accès aux anciens liens, mais oblige à réimprimer le QR code.
