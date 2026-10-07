// gera index.html (publicado) a partir de _fonte.html, cifrando o miolo com o PIN
// uso: node _build.mjs <PIN>
import { readFileSync, writeFileSync } from 'fs';
import { webcrypto as c } from 'crypto';
const pin = process.argv[2]; if (!/^\d{4}$/.test(pin)) { console.error('PIN de 4 dígitos'); process.exit(1); }
const src = readFileSync(new URL('./_fonte.html', import.meta.url), 'utf8');
const m = src.match(/<!--SEGREDO-->([\s\S]*?)<!--\/SEGREDO-->/);
const ITER = 300000, salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
const base = await c.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
const key = await c.subtle.deriveKey({ name:'PBKDF2', salt, iterations:ITER, hash:'SHA-256' }, base, { name:'AES-GCM', length:256 }, false, ['encrypt']);
const ct = new Uint8Array(await c.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(m[1])));
const b64 = u => Buffer.from(u).toString('base64');
const gate = readFileSync(new URL('./_gate.html', import.meta.url), 'utf8')
  .replace('__DADOS__', JSON.stringify({ s:b64(salt), i:b64(iv), c:b64(ct), n:ITER }));
writeFileSync(new URL('./index.html', import.meta.url), src.replace(m[0], gate));
console.log('index.html gerado,', ct.length, 'bytes cifrados');
