// Vérifie que le livret répond bien sur son adresse : hébergement gratuit (nom.pages.dev, nom.netlify.app…),
// domaine personnalisé ou adresse GitHub d'origine.
//
//   node outils/verifier-domaine.mjs                       → adresse de site.json, du fichier CNAME, sinon celle de GitHub
//   node outils/verifier-domaine.mjs bienvenue-exemple.pages.dev
//
// Contrôles : page en HTTPS, contenu chiffré, mode hors connexion, en-têtes, et pour un domaine personnalisé les
// enregistrements DNS et la redirection http → https. Vérifie aussi ce que devient l'ancienne adresse (celle des
// QR codes déjà imprimés). Ne lit aucun secret : rien du dossier prive/ n'est utilisé. Nécessite Node 18 ou plus récent.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCIENNE_ADRESSE, normaliserAdresse, resoudreAdresse } from './adresse.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IP_GITHUB = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const IP6_GITHUB = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];
const HOTE_ANCIEN = new URL(ANCIENNE_ADRESSE).hostname; // raphael1o1.github.io
// Adresses « nom.plateforme » : la plateforme gère le DNS et le HTTPS, il n'y a rien à contrôler de ce côté.
const PLATEFORME = /\.(github\.io|pages\.dev|netlify\.app|workers\.dev|vercel\.app)$/;
const REDIRECTIONS = [301, 302, 307, 308];

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

const hoteDe = (adresse) => { try { return new URL(adresse).hostname; } catch { return null; } };

const argument = process.argv[2];
const { adresse, source } = argument ? { adresse: normaliserAdresse(argument), source: 'argument' } : await resoudreAdresse(RACINE);
const hote = new URL(adresse).hostname;
const plateforme = PLATEFORME.test(hote);
console.log(`Adresse contrôlée : ${adresse} (${source})\n`);

if (!plateforme) {
  console.log('DNS');
  const cname = await dns(hote, 'CNAME');
  if (cname.length) {
    cname.some((c) => c === HOTE_ANCIEN) ? ok(`CNAME → ${cname.join(', ')}`) : ko(`CNAME → ${cname.join(', ')} : attendu ${HOTE_ANCIEN} (sans le nom du dépôt)`);
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
  ko(`HTTPS impossible (${page.erreur})${plateforme ? ' : le site n\'est pas (encore) publié à cette adresse' : ' : certificat pas encore créé par GitHub (jusqu\'à 24 h) ou DNS pas propagé'}.`);
} else {
  const html = await page.r.text();
  const livret = html.includes('<title>Bienvenue</title>');
  page.r.ok && livret ? ok(`Livret servi en HTTPS (HTTP ${page.r.status})`) : ko(`Réponse inattendue : HTTP ${page.r.status}${livret ? '' : ', ce n\'est pas le livret'}.`);
  const enc = await get(new URL('contenu.enc', adresse));
  if (enc.erreur || !enc.r.ok) ko(`contenu.enc introuvable (${enc.erreur || 'HTTP ' + enc.r.status}).`);
  else {
    const j = await enc.r.json().catch(() => null);
    j && j.iv && j.data ? ok('contenu.enc présent (chiffré)') : ko('contenu.enc illisible.');
  }
  const sw = await get(new URL('sw.js', adresse));
  sw.r?.ok ? ok('sw.js présent (mode hors connexion)') : ko('sw.js introuvable.');
  page.r.headers.get('x-content-type-options')
    ? ok('En-têtes de sécurité actifs (fichier _headers pris en compte)')
    : info('En-têtes de sécurité du fichier _headers non appliqués par cet hébergeur (GitHub Pages les ignore) : sans gravité.');
}

if (!plateforme) {
  console.log('\nRedirection http → https');
  const http = await get(`http://${hote}${new URL(adresse).pathname}`, { redirect: 'manual' });
  if (http.erreur) info(`http:// ne répond pas (${http.erreur}) : sans importance si https:// fonctionne.`);
  else if (REDIRECTIONS.includes(http.r.status) && (http.r.headers.get('location') || '').startsWith('https://')) ok('http:// redirige vers https://');
  else ko('http:// ne redirige pas vers https:// : coche « Enforce HTTPS » dans Settings → Pages du dépôt.');
}

if (hote !== HOTE_ANCIEN) {
  console.log('\nAncienne adresse (QR codes déjà imprimés)');
  const ancien = await get(ANCIENNE_ADRESSE, { redirect: 'manual' });
  if (ancien.erreur) info(`Ancienne adresse injoignable (${ancien.erreur}).`);
  else if (REDIRECTIONS.includes(ancien.r.status)) {
    const cible = ancien.r.headers.get('location') || '';
    cible.startsWith(adresse.replace(/\/$/, '')) ? ok(`Redirige vers ${cible} : les anciens QR codes (avec leur clé après le « # ») continuent de marcher`) : ko(`Redirige vers ${cible}, pas vers ${adresse}.`);
  } else {
    // GitHub Pages ne redirige pas : c'est la page elle-même qui suit le livret vers sa nouvelle adresse (site.json).
    const config = await get(new URL('site.json', ANCIENNE_ADRESSE), { cache: 'no-store' });
    const json = config.r?.ok ? await config.r.json().catch(() => null) : null;
    const cible = json && json.adresse ? hoteDe(json.adresse) : null;
    const code = (await get(ANCIENNE_ADRESSE)).r;
    const html = code ? await code.text() : '';
    if (cible === hote && html.includes('suivreAdresse')) ok(`L'ancienne adresse envoie vers ${adresse} (site.json) en emportant la clé : les anciens QR codes mènent ici.`);
    else if (cible && cible !== hote) ko(`site.json de l'ancienne adresse pointe vers ${json.adresse}, pas vers ${adresse}.`);
    else if (cible === hote) ko('site.json est à jour mais la page de l\'ancienne adresse n\'a pas encore le code de redirection : attendre le déploiement GitHub Pages.');
    else info(`L'ancienne adresse sert encore le livret sans redirection (HTTP ${ancien.r.status}) : les anciens QR codes continuent de marcher, sur l'ancienne adresse.`);
  }
}

console.log(echecs ? `\n${echecs} point(s) à corriger.` : '\nTout est en ordre.');
process.exit(echecs ? 1 : 0);
