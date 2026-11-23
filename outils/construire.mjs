// Chiffre le contenu du livret et génère les QR codes.
//
//   node outils/construire.mjs                    → chiffre prive/contenu.json vers contenu.enc
//   node outils/construire.mjs --dechiffrer       → recrée prive/contenu.json depuis contenu.enc
//   node outils/construire.mjs --sections         → liste les sections et les fiches (pour choisir ce qui reste derrière le code)
//   node outils/construire.mjs --nouveau-code [N] → tire un nouveau code de N chiffres (4 par défaut), puis reconstruit
//   node outils/construire.mjs --sans-code        → désactive l'accès par code (supprime acces.enc et conditions-acces.enc)
//
// Accès par code (avant l'arrivée) : si prive/acces.json existe, une version du livret (sans Wi-Fi ni photos
// par défaut) est aussi chiffrée avec une clé dérivée du code : acces.enc et conditions-acces.enc.
// Le lien envoyé aux voyageurs n'a alors ni « # » ni clé : la page demande le code. Le QR du studio ne change pas.
//
// La clé est dans prive/cle.txt (créée au premier lancement). Le dossier prive/ n'est
// jamais publié : il contient le texte en clair, la clé, le lien complet et les QR codes.

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { resoudreAdresse } from './adresse.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVE = path.join(RACINE, 'prive');
// Adresse du livret : variable LIVRET_URL, sinon fichier CNAME (domaine personnalisé), sinon adresse GitHub.

const ITERATIONS = 600000; // PBKDF2-SHA256 : chaque essai de code coûte du temps, pour qui voudrait les tester tous
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function lireCle(creer) {
  const f = path.join(PRIVE, 'cle.txt');
  const env = process.env.LIVRET_CLE;
  if (env) return env.trim();
  if (existsSync(f)) return (await readFile(f, 'utf8')).trim();
  if (!creer) throw new Error('Clé introuvable : mettez-la dans prive/cle.txt ou la variable LIVRET_CLE.');
  const s = b64url(crypto.getRandomValues(new Uint8Array(12)));
  await writeFile(f, s + '\n');
  return s;
}

async function cleAes(secret) {
  const brut = await crypto.subtle.digest('SHA-256', deB64url(secret));
  return crypto.subtle.importKey('raw', brut, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const echapWifi = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');

function relirePng(buf) {
  const img = PNG.sync.read(buf);
  const r = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  return r ? r.data : null;
}

async function dechiffrer() {
  const secret = await lireCle(false);
  const enc = JSON.parse(await readFile(path.join(RACINE, 'contenu.enc'), 'utf8'));
  const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64url(enc.iv) }, await cleAes(secret), deB64url(enc.data));
  const contenu = JSON.parse(new TextDecoder().decode(clair));
  delete contenu.wifi.qrSvg;
  await mkdir(PRIVE, { recursive: true });
  await writeFile(path.join(PRIVE, 'contenu.json'), JSON.stringify(contenu, null, 2) + '\n');
  console.log('prive/contenu.json recréé.');
}


// ───────── Accès par code ─────────
const FICHIER_ACCES = path.join(PRIVE, 'acces.json');
const titreFiche = (f) => (typeof f.titre === 'string' ? f.titre : f.titre?.fr || f.titre?.en || '');

async function lireAcces() {
  if (!existsSync(FICHIER_ACCES)) return null;
  let a;
  try { a = JSON.parse(await readFile(FICHIER_ACCES, 'utf8')); } catch { throw new Error('prive/acces.json illisible : vérifier la syntaxe JSON.'); }
  const code = String(a.code ?? '').trim();
  if (!/^\d{4,12}$/.test(code)) throw new Error('prive/acces.json : « code » doit contenir de 4 à 12 chiffres.');
  return { code, sansWifi: a.sansWifi !== false, sansPhotos: a.sansPhotos !== false, fichesRetirees: a.fichesRetirees ?? [] };
}

/** Code à N chiffres, sans suite évidente (0000, 1234, 4321…). */
function tirerCode(n) {
  for (;;) {
    const c = Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x % 10).join('');
    const monotone = [...c].every((d, i, t) => i === 0 || +d === +t[i - 1] + 1) || [...c].every((d, i, t) => i === 0 || +d === +t[i - 1] - 1);
    if (!/^(\d)\1+$/.test(c) && !monotone) return c;
  }
}

/** Copie du contenu pour l'accès par code : sans ce qu'on ne veut pas montrer avant l'arrivée. */
function contenuAcces(contenu, a) {
  const c = JSON.parse(JSON.stringify(contenu));
  if (a.sansWifi) delete c.wifi;
  if (a.sansPhotos) delete c.photos;
  if (a.fichesRetirees.length) {
    const fiches = c.fiches || [];
    const aRetirer = new Set();
    for (const r of a.fichesRetirees) {
      const i = typeof r === 'number' ? r : fiches.findIndex((f) => titreFiche(f).trim().toLowerCase() === String(r).trim().toLowerCase());
      // Une faute de frappe ne doit jamais laisser une fiche sensible visible : on s'arrête.
      if (!Number.isInteger(i) || i < 0 || i >= fiches.length) throw new Error(`prive/acces.json : fiche « ${r} » introuvable (voir --sections).`);
      aRetirer.add(i);
    }
    c.fiches = fiches.filter((_, i) => !aRetirer.has(i));
  }
  return c;
}

async function deriverCode(code, sel, iter = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations: iter }, base, 256));
}

async function chiffrerAcces(contenu, a, adresse) {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const brut = await deriverCode(a.code, sel);
  const cle = await crypto.subtle.importKey('raw', brut, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clair = contenuAcces(contenu, a);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, new TextEncoder().encode(JSON.stringify(clair))));
  await writeFile(path.join(RACINE, 'acces.enc'), JSON.stringify({ v: 2, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: b64url(sel), iv: b64url(iv), data: b64url(chiffre) }) + '\n');

  // Relecture comme le fait la page : dérivation depuis le code, puis déchiffrement
  const rel = await deriverCode(a.code, sel);
  const cleRel = await crypto.subtle.importKey('raw', rel, 'AES-GCM', false, ['decrypt']);
  const relu = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cleRel, chiffre)));
  const ok = relu.hote?.prenom === contenu.hote?.prenom && !(a.sansWifi && relu.wifi) && !(a.sansPhotos && relu.photos);
  console.log(`acces.enc : ${chiffre.length} octets chiffrés · ${(clair.fiches || []).length}/${(contenu.fiches || []).length} fiches · Wi-Fi ${clair.wifi ? 'INCLUS' : 'retiré'} · photos ${clair.photos ? 'INCLUSES' : 'retirées'} · relecture ${ok ? 'OK' : 'ÉCHEC'}`);

  // Conditions d'Airbnb pour cette version
  const fCond = path.join(PRIVE, 'conditions.json');
  if (existsSync(fCond)) {
    const ivC = crypto.getRandomValues(new Uint8Array(12));
    const ch = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivC }, cle, gzipSync(await readFile(fCond), { level: 9 })));
    await writeFile(path.join(RACINE, 'conditions-acces.enc'), JSON.stringify({ v: 2, gz: 1, iv: b64url(ivC), data: b64url(ch) }) + '\n');
  }

  const message = [
    'Bonjour,',
    `Voici le livret d'accueil du studio : ${adresse}`,
    `Code d'accès : ${a.code}`,
    '',
    'Hello,',
    `Here is the welcome guide for the studio: ${adresse}`,
    `Access code: ${a.code}`,
    '',
  ].join('\n');
  await writeFile(path.join(PRIVE, 'message-voyageur.txt'), message);
  console.log(`Code d'accès : ${a.code} · message prêt à envoyer dans prive/message-voyageur.txt`);
  if (a.code.length < 6) console.log('Un code court se devine plus vite : pour qui sait programmer, 4 chiffres tiennent quelques minutes. Sans importance pour un livret allégé ; sinon, node outils/construire.mjs --nouveau-code 6.');
  if (!a.sansWifi || !a.sansPhotos) console.log('Attention : le Wi-Fi ou les photos sont derrière un simple code ; voir README (« Accès par code »).');
}

async function sections() {
  const contenu = JSON.parse(await readFile(path.join(PRIVE, 'contenu.json'), 'utf8'));
  console.log('Sections du contenu :', Object.keys(contenu).join(', '));
  console.log('\nFiches (à indiquer dans « fichesRetirees » de prive/acces.json, par numéro ou par titre) :');
  (contenu.fiches || []).forEach((f, i) => console.log(`  ${i} · ${titreFiche(f)}`));
}

async function chiffrer() {
  await mkdir(PRIVE, { recursive: true });
  const contenu = JSON.parse(await readFile(path.join(PRIVE, 'contenu.json'), 'utf8'));
  // Accès par code : on valide la configuration avant d'écrire quoi que ce soit (une erreur ne doit pas laisser un état à moitié à jour)
  const acces = await lireAcces();
  if (acces) contenuAcces(contenu, acces);

  // QR Wi-Fi, affiché dans le livret pour un deuxième appareil
  const w = contenu.wifi;
  const texteWifi = `WIFI:T:${w.securite || 'WPA'};S:${echapWifi(w.reseau)};P:${echapWifi(w.motDePasse)};;`;
  w.qrSvg = await QRCode.toString(texteWifi, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  const wifiRelu = relirePng(await QRCode.toBuffer(texteWifi, { errorCorrectionLevel: 'M', margin: 2, scale: 10 }));

  // Chiffrement AES-GCM, clé = SHA-256 du secret contenu dans le lien du QR
  const secret = await lireCle(true);
  const cle = await cleAes(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, new TextEncoder().encode(JSON.stringify(contenu))));
  await writeFile(path.join(RACINE, 'contenu.enc'), JSON.stringify({ v: 1, iv: b64url(iv), data: b64url(chiffre) }) + '\n');
  const retour = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cle, chiffre)));

  // Lien et QR du livret (à imprimer)
  const { adresse, source } = await resoudreAdresse(RACINE);
  const lien = adresse + '#' + secret;
  console.log('Adresse du livret :', adresse, `(source : ${source})`);
  const opts = { errorCorrectionLevel: 'M', margin: 4 };
  await writeFile(path.join(PRIVE, 'lien.txt'), lien + '\n');
  await writeFile(path.join(PRIVE, 'qr-livret.svg'), await QRCode.toString(lien, { ...opts, type: 'svg' }));
  const png = await QRCode.toBuffer(lien, { ...opts, scale: 12 });
  await writeFile(path.join(PRIVE, 'qr-livret.png'), png);
  const qr = QRCode.create(lien, opts);

  console.log('contenu.enc :', chiffre.length, 'octets chiffrés · relecture', retour.wifi.reseau === w.reseau ? 'OK' : 'ÉCHEC');
  console.log('QR Wi-Fi :', wifiRelu === texteWifi ? 'relu OK' : 'ÉCHEC de relecture');
  console.log('Lien du livret :', lien, `(${lien.length} caractères)`);
  // Conditions d'Airbnb (texte long) : compressées puis chiffrées à part, chargées seulement à l'ouverture
  const fCond = path.join(PRIVE, 'conditions.json');
  if (existsSync(fCond)) {
    const brut = gzipSync(await readFile(fCond), { level: 9 });
    const ivC = crypto.getRandomValues(new Uint8Array(12));
    const ch = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivC }, cle, brut));
    await writeFile(path.join(RACINE, 'conditions.enc'), JSON.stringify({ v: 1, gz: 1, iv: b64url(ivC), data: b64url(ch) }) + '\n');
    const relu = JSON.parse(gunzipSync(Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivC }, cle, ch))).toString('utf8'));
    console.log('conditions.enc :', ch.length, 'octets chiffrés ·', relu.parties.length, 'parties · relecture OK');
  }
  if (acces) await chiffrerAcces(contenu, acces, adresse);
  else if (existsSync(path.join(RACINE, 'acces.enc'))) console.log('ATTENTION : acces.enc existe déjà et reste actif avec son ancien code (pas de prive/acces.json). Pour désactiver l\'accès par code : node outils/construire.mjs --sans-code.');
  else console.log('Accès par code : désactivé (pas de prive/acces.json).');
  console.log('QR du livret : version', qr.version, '·', qr.modules.size, 'modules + 4 de marge de chaque côté · relecture', relirePng(png) === lien ? 'OK' : 'ÉCHEC');
}

async function sansCode() {
  const fichiers = ['acces.enc', 'conditions-acces.enc'].map((f) => path.join(RACINE, f)).filter((f) => existsSync(f));
  for (const f of fichiers) await unlink(f);
  console.log(fichiers.length ? `Accès par code désactivé : ${fichiers.map((f) => path.basename(f)).join(', ')} supprimé(s). À publier (commit et push) pour que ce soit effectif.` : 'Accès par code : déjà désactivé.');
}

async function nouveauCode() {
  const i = process.argv.indexOf('--nouveau-code');
  const demande = process.argv[i + 1] && /^\d+$/.test(process.argv[i + 1]) ? Number(process.argv[i + 1]) : null;
  let actuel = {};
  if (existsSync(FICHIER_ACCES)) actuel = JSON.parse(await readFile(FICHIER_ACCES, 'utf8'));
  const n = demande ?? (String(actuel.code ?? '').length >= 4 ? String(actuel.code).length : 4);
  if (n < 4 || n > 12) throw new Error('--nouveau-code : de 4 à 12 chiffres.');
  await mkdir(PRIVE, { recursive: true });
  await writeFile(FICHIER_ACCES, JSON.stringify({ sansWifi: true, sansPhotos: true, fichesRetirees: [], ...actuel, code: tirerCode(n) }, null, 2) + '\n');
  await chiffrer();
}

const principal = process.argv.includes('--dechiffrer') ? dechiffrer : process.argv.includes('--sections') ? sections : process.argv.includes('--sans-code') ? sansCode : process.argv.includes('--nouveau-code') ? nouveauCode : chiffrer;
principal().catch((e) => { console.error(e.message || e); process.exit(1); });
