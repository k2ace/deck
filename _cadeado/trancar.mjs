/* Tranca as páginas do deck com senha.
 *
 * O original de cada página fica em _fonte/<caminho> (pasta fora do git, porque o
 * repositório é público). Cada cliente (grupo) tem uma chave AES de 256 bits,
 * aleatória, guardada em _fonte/chaves.json. As páginas vão cifradas com ela dentro
 * da porta (_cadeado/porta.html).
 *
 * A chave não está na página: quem digita o PIN pede a chave ao Worker deck-track
 * (rota /abre), que confere o PIN e limita os erros. Por isso os 4 dígitos não podem
 * ser testados aos milhares. Os PINs vão para o KV só como hash com sal.
 *
 * _fonte/cadeados.json:
 *   { "_mestre": {"pessoas": {"Klaus": "0000"}},          abre todos os grupos
 *     "geracao": {"paginas": ["geracao/index.html"], "pessoas": {"Geração": "4183"}} }
 *
 * Uso:   node _cadeado/trancar.mjs            tranca tudo e atualiza o Worker
 *        node _cadeado/trancar.mjs geracao    só esse grupo
 *
 * Para editar uma página trancada: edite o original em _fonte/ e rode de novo.
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {webcrypto as cr, createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTE = join(RAIZ, '_fonte');
const KV = 'f06e664d56aa4ff89a0fbb937f881860';
const CONTA = '0d24fa910a904e0ebc749d7417719d8c';
const TRACK = /\s*<script[^>]*src="https:\/\/deck\.k2ia\.app\/track\.js"[^>]*><\/script>/g;

const b64 = (u) => Buffer.from(u).toString('base64');
const sorteia = (n) => cr.getRandomValues(new Uint8Array(n));
const enc = (s) => new TextEncoder().encode(s);

// mesmo cálculo do hashPin do Worker
function pessoasComHash(pessoas){
  return Object.entries(pessoas).map(([nome, pin]) => {
    if (!/^[0-9]{4}$/.test(String(pin))) throw new Error(`PIN de ${nome} precisa ter 4 dígitos`);
    const s = b64(sorteia(12));
    return {nome, s, h: createHash('sha256').update(s + ':' + pin).digest('base64')};
  });
}
function gravaKV(chave, valor){
  execFileSync('npx', ['wrangler', 'kv', 'key', 'put', chave, JSON.stringify(valor), '--namespace-id', KV, '--remote'],
    {cwd: join(RAIZ, '_track'), env: {...process.env, CLOUDFLARE_ACCOUNT_ID: CONTA}, stdio: ['ignore', 'ignore', 'inherit']});
}

async function tranca(grupo, chaveBruta, caminho, porta){
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
  const chave = await cr.subtle.importKey('raw', chaveBruta, 'AES-GCM', false, ['encrypt']);
  const nonce = sorteia(12);
  const dados = await cr.subtle.encrypt({name: 'AES-GCM', iv: nonce}, chave, gzipSync(enc(html.replace(TRACK, ''))));
  const pacote = {v: 2, grupo, nonce: b64(nonce), dados: b64(new Uint8Array(dados))};
  writeFileSync(publico, porta
    .replaceAll('__TITULO__', titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
    .replace('__COFRE__', () => JSON.stringify(pacote)));
  console.log(`trancado  ${caminho}`);
}

const cfg = JSON.parse(readFileSync(join(FONTE, 'cadeados.json'), 'utf8'));
const arqChaves = join(FONTE, 'chaves.json');
const chaves = existsSync(arqChaves) ? JSON.parse(readFileSync(arqChaves, 'utf8')) : {};
const porta = readFileSync(join(RAIZ, '_cadeado', 'porta.html'), 'utf8');
const so = process.argv[2];

if (!so && cfg._mestre){ gravaKV('cad:_mestre', {pessoas: pessoasComHash(cfg._mestre.pessoas)}); console.log('mestre    atualizado'); }
for (const [grupo, {paginas, pessoas}] of Object.entries(cfg)){
  if (grupo === '_mestre' || (so && so !== grupo)) continue;
  // a chave do grupo é estável: rodar de novo não invalida página já publicada
  chaves[grupo] ||= b64(sorteia(32));
  writeFileSync(arqChaves, JSON.stringify(chaves, null, 2));
  gravaKV('cad:' + grupo, {chave: chaves[grupo], pessoas: pessoasComHash(pessoas || {})});
  console.log(`grupo     ${grupo}  (${Object.keys(pessoas || {}).join(', ') || 'só mestre'})`);
  for (const p of paginas) await tranca(grupo, Buffer.from(chaves[grupo], 'base64'), p, porta);
}
