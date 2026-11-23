// Vérifie que le livret répond bien sur son adresse (domaine personnalisé ou adresse GitHub).
//
//   node outils/verifier-domaine.mjs                  → adresse du fichier CNAME (ou adresse par défaut)
//   node outils/verifier-domaine.mjs bienvenue-exemple.fr
//
// Contrôles : enregistrements DNS, page en HTTPS, contenu chiffré, redirection http → https,
// et comportement de l'ancienne adresse (celle des QR codes déjà imprimés).
// Ne lit aucun secret : rien du dossier prive/ n'est utilisé. Nécessite Node 18 ou plus récent.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADRESSE_PAR_DEFAUT, normaliserAdresse, resoudreAdresse } from './adresse.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IP_GITHUB = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const IP6_GITHUB = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];
const PROPRIETAIRE = new URL(ADRESSE_PAR_DEFAUT).hostname; // raphael1o1.github.io

let echecs = 0;
const ok = (m) => console.log('  ✓', m);
const ko = (m) => { echecs++; console.log('  ✗', m); };
const info = (m) => console.log('  ·', m);

async function dns(nom, type) {
  const code = { A: 1, AAAA: 28, CNAME: 5 }[type];
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nom)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
  const j = await r.json();
  return (j.Answer || []).filter((a) => a.type === code).map((a) => String(a.data).replace(/\.$/, '').toLowerCase());
}

async function get(url, options = {}) {
  try {
    return { r: await fetch(url, { signal: AbortSignal.timeout(15000), ...options }) };
  } catch (e) {
    return { erreur: e.cause?.code || e.cause?.message || e.message };
  }
}

const argument = process.argv[2];
const { adresse, source } = argument ? { adresse: normaliserAdresse(argument), source: 'argument' } : await resoudreAdresse(RACINE);
const hote = new URL(adresse).hostname;
const personnalise = !hote.endsWith('.github.io');
console.log(`Adresse contrôlée : ${adresse} (${source})\n`);

if (personnalise) {
  console.log('DNS');
  const cname = await dns(hote, 'CNAME');
  if (cname.length) {
    cname.some((c) => c === PROPRIETAIRE) ? ok(`CNAME → ${cname.join(', ')}`) : ko(`CNAME → ${cname.join(', ')} : attendu ${PROPRIETAIRE} (sans le nom du dépôt)`);
  } else {
    const a = await dns(hote, 'A');
    if (a.length === 0) ko('Aucun enregistrement A ni CNAME : DNS pas encore créé ou pas encore propagé (jusqu\'à 24 h).');
    else if (a.every((x) => IP_GITHUB.includes(x))) ok(`A → ${a.join(', ')}${a.length < 4 ? ' (GitHub en recommande 4)' : ''}`);
    else ko(`A → ${a.join(', ')} : adresses non GitHub (attendu ${IP_GITHUB.join(', ')})`);
    const a6 = await dns(hote, 'AAAA');
    if (a6.length === 0) info('Pas d\'enregistrement AAAA (IPv6) : facultatif.');
    else a6.every((x) => IP6_GITHUB.includes(x)) ? ok(`AAAA → ${a6.join(', ')}`) : ko(`AAAA → ${a6.join(', ')} : adresses non GitHub (supprime-les ou corrige-les)`);
  }
  const joker = await dns(`verification-joker-${Date.now()}.${hote}`, 'A');
  if (joker.length) ko('Un enregistrement générique (*) semble exister : GitHub le déconseille (risque de prise de contrôle).');
  console.log();
}

console.log('Page');
const page = await get(adresse);
if (page.erreur) {
  ko(`HTTPS impossible (${page.erreur})${personnalise ? ' : certificat pas encore créé par GitHub (jusqu\'à 24 h) ou DNS pas propagé' : ''}.`);
} else {
  const html = await page.r.text();
  page.r.ok && html.includes('<title>Bienvenue</title>') ? ok(`Livret servi en HTTPS (HTTP ${page.r.status})`) : ko(`Réponse inattendue : HTTP ${page.r.status}${html.includes('<title>Bienvenue</title>') ? '' : ', ce n\'est pas le livret'}.`);
  const enc = await get(new URL('contenu.enc', adresse));
  if (enc.erreur || !enc.r.ok) ko(`contenu.enc introuvable (${enc.erreur || 'HTTP ' + enc.r.status}).`);
  else {
    const j = await enc.r.json().catch(() => null);
    j && j.iv && j.data ? ok('contenu.enc présent (chiffré)') : ko('contenu.enc illisible.');
  }
  const sw = await get(new URL('sw.js', adresse));
  sw.r?.ok ? ok('sw.js présent (mode hors connexion)') : ko('sw.js introuvable.');
}

if (personnalise) {
  console.log('\nRedirection http → https');
  const http = await get(`http://${hote}${new URL(adresse).pathname}`, { redirect: 'manual' });
  if (http.erreur) info(`http:// ne répond pas (${http.erreur}) : sans importance si https:// fonctionne.`);
  else if ([301, 302, 307, 308].includes(http.r.status) && (http.r.headers.get('location') || '').startsWith('https://')) ok('http:// redirige vers https://');
  else ko('http:// ne redirige pas vers https:// : coche « Enforce HTTPS » dans Settings → Pages du dépôt.');

  console.log('\nAncienne adresse (QR codes déjà imprimés)');
  const ancien = await get(ADRESSE_PAR_DEFAUT, { redirect: 'manual' });
  if (ancien.erreur) info(`Ancienne adresse injoignable (${ancien.erreur}).`);
  else if ([301, 302, 307, 308].includes(ancien.r.status)) {
    const cible = ancien.r.headers.get('location') || '';
    cible.startsWith(adresse.replace(/\/$/, '')) ? ok(`Redirige vers ${cible} : les anciens QR codes (avec leur clé après le « # ») continuent de marcher`) : ko(`Redirige vers ${cible}, pas vers ${adresse}.`);
  } else {
    info(`Ne redirige pas (HTTP ${ancien.r.status}) : les anciens QR codes ne marcheront plus tant qu'ils ne sont pas remplacés par le nouveau.`);
  }
}

console.log(echecs ? `\n${echecs} point(s) à corriger.` : '\nTout est en ordre.');
process.exit(echecs ? 1 : 0);
