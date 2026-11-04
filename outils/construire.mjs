// Chiffre le contenu du livret et génère les QR codes.
//
//   node outils/construire.mjs              → chiffre prive/contenu.json vers contenu.enc
//   node outils/construire.mjs --dechiffrer → recrée prive/contenu.json depuis contenu.enc
//
// La clé est dans prive/cle.txt (créée au premier lancement). Le dossier prive/ n'est
// jamais publié : il contient le texte en clair, la clé, le lien complet et les QR codes.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVE = path.join(RACINE, 'prive');
const URL_SITE = 'https://raphael1o1.github.io/bienvenue/';

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

async function chiffrer() {
  await mkdir(PRIVE, { recursive: true });
  const contenu = JSON.parse(await readFile(path.join(PRIVE, 'contenu.json'), 'utf8'));

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
  const lien = URL_SITE + '#' + secret;
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
  console.log('QR du livret : version', qr.version, '·', qr.modules.size, 'modules + 4 de marge de chaque côté · relecture', relirePng(png) === lien ? 'OK' : 'ÉCHEC');
}

(process.argv.includes('--dechiffrer') ? dechiffrer() : chiffrer()).catch((e) => { console.error(e.message || e); process.exit(1); });
