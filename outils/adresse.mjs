// Adresse du livret, partagée par construire.mjs (lien des QR codes) et verifier-domaine.mjs.
//
// Ordre de priorité :
//   1. la variable LIVRET_URL (ex. LIVRET_URL=bienvenue-exemple.fr node outils/construire.mjs) ;
//   2. le fichier CNAME à la racine du dépôt, que GitHub crée quand on enregistre un domaine
//      personnalisé dans Settings → Pages (il faut ensuite faire « git pull ») ;
//   3. sinon l'adresse GitHub par défaut.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const ADRESSE_PAR_DEFAUT = 'https://raphael1o1.github.io/bienvenue/';

/**
 * « domaine.fr », « https://domaine.fr » ou « https://domaine.fr/dossier » → « https://domaine.fr/… » avec
 * une barre finale. Refuse ce qui contient un « ? » ou un « # » : la clé du livret est ajoutée toute seule.
 */
export function normaliserAdresse(valeur) {
  let s = String(valeur ?? '').trim();
  if (!s) throw new Error('Adresse vide.');
  if (/^http:\/\//i.test(s)) throw new Error(`L'adresse doit commencer par https:// (reçu « ${valeur} »).`);
  if (!/^https:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`Adresse illisible : « ${valeur} ».`);
  }
  if (u.search || u.hash) throw new Error('Adresse sans « ? » ni « # » : la clé du livret est ajoutée automatiquement.');
  if (!u.hostname.includes('.')) throw new Error(`Nom de domaine incomplet : « ${u.hostname} ».`);
  return `https://${u.host}${u.pathname.replace(/\/*$/, '/')}`;
}

/** @returns {Promise<{ adresse: string, source: 'LIVRET_URL' | 'CNAME' | 'défaut' }>} */
export async function resoudreAdresse(racine, env = process.env) {
  if (env.LIVRET_URL && env.LIVRET_URL.trim()) return { adresse: normaliserAdresse(env.LIVRET_URL), source: 'LIVRET_URL' };
  const fichier = path.join(racine, 'CNAME');
  if (existsSync(fichier)) {
    const domaine = (await readFile(fichier, 'utf8')).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (domaine) return { adresse: normaliserAdresse(domaine.toLowerCase()), source: 'CNAME' };
  }
  return { adresse: ADRESSE_PAR_DEFAUT, source: 'défaut' };
}
