#!/usr/bin/env node
/* Tranca as páginas do deck com senha.
 *
 * O original de cada página fica em _fonte/<caminho> (pasta fora do git, porque o
 * repositório é público). Este script lê _fonte/cadeados.json, cifra cada original
 * com AES-GCM e grava no lugar público uma porta (_cadeado/porta.html) com o
 * conteúdo cifrado dentro. Cada pessoa tem o seu cofre: a senha dela abre a chave
 * da página, e o nome do cofre é o que o Radar registra como "quem destravou".
 *
 * Uso:   node _cadeado/trancar.mjs            tranca tudo que está no cadeados.json
 *        node _cadeado/trancar.mjs geracao    tranca só esse grupo
 *
 * Para editar uma página trancada: edite o original em _fonte/ e rode de novo.
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {webcrypto as cr} from 'node:crypto';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTE = join(RAIZ, '_fonte');
const ITER = 200000;
const TRACK = /\s*<script[^>]*src="https:\/\/deck\.k2ia\.app\/track\.js"[^>]*><\/script>/g;

const b64 = (u) => Buffer.from(u).toString('base64');
const sorteia = (n) => cr.getRandomValues(new Uint8Array(n));
const enc = (s) => new TextEncoder().encode(s);

async function cofre(senha, mestraBruta, nome){
  const salt = sorteia(16), nonce = sorteia(12), nonce2 = sorteia(12);
  const base = await cr.subtle.importKey('raw', enc(senha), 'PBKDF2', false, ['deriveKey']);
  const chave = await cr.subtle.deriveKey({name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256'},
    base, {name: 'AES-GCM', length: 256}, false, ['encrypt']);
  return {
    salt: b64(salt), nonce: b64(nonce), nonce2: b64(nonce2),
    chave: b64(new Uint8Array(await cr.subtle.encrypt({name: 'AES-GCM', iv: nonce}, chave, mestraBruta))),
    quem: b64(new Uint8Array(await cr.subtle.encrypt({name: 'AES-GCM', iv: nonce2}, chave, enc(nome)))),
  };
}

async function tranca(grupo, pessoas, caminho, porta){
  const publico = join(RAIZ, caminho), original = join(FONTE, caminho);
  // primeira vez: o original sai do lugar público e vai para _fonte
  if (!existsSync(original)){
    const atual = readFileSync(publico, 'utf8');
    if (atual.includes('id="cofre"')) throw new Error(`${caminho} já está trancado e não há original em _fonte/`);
    mkdirSync(dirname(original), {recursive: true});
    copyFileSync(publico, original);
  }
  const html = readFileSync(original, 'utf8');
  const titulo = (html.match(/<title>([^<]*)<\/title>/) || [, 'Acesso restrito'])[1];
  const mestraBruta = sorteia(32);
  const mestra = await cr.subtle.importKey('raw', mestraBruta, 'AES-GCM', false, ['encrypt']);
  const nonce = sorteia(12);
  const dados = await cr.subtle.encrypt({name: 'AES-GCM', iv: nonce}, mestra, gzipSync(enc(html.replace(TRACK, ''))));
  const pacote = {
    v: 1, grupo, iter: ITER, nonce: b64(nonce), dados: b64(new Uint8Array(dados)),
    cofres: await Promise.all(Object.entries(pessoas).map(([nome, senha]) => cofre(String(senha), mestraBruta, nome))),
  };
  writeFileSync(publico, porta
    .replaceAll('__TITULO__', titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
    .replace('__COFRE__', () => JSON.stringify(pacote)));
  console.log(`trancado  ${caminho}  (${Object.keys(pessoas).join(', ')})`);
}

const cfg = JSON.parse(readFileSync(join(FONTE, 'cadeados.json'), 'utf8'));
const porta = readFileSync(join(RAIZ, '_cadeado', 'porta.html'), 'utf8');
const so = process.argv[2];
for (const [grupo, {paginas, pessoas}] of Object.entries(cfg)){
  if (so && so !== grupo) continue;
  for (const p of paginas) await tranca(grupo, pessoas, p, porta);
}
