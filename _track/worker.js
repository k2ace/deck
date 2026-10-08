/* Deck Radar — Worker da Cloudflare para o rastreio de abertura dos decks.
   Rotas:
     GET /hit    grava uma abertura no KV (chamada pelo beacon track.js)
                 ?q=nome  marca quem destravou (o PIN em si nunca chega aqui)
     GET /list?token=XXX   devolve as ultimas aberturas em JSON (para o Claude consultar)
     POST /p     guarda uma proposta ja cifrada e devolve um codigo curto
     GET /p/CODIGO   devolve a proposta cifrada daquele codigo
     POST /abre  {g, pin}  confere o PIN de uma página trancada e devolve a chave dela
                 (cadeados em KV "cad:<grupo>" e "cad:_mestre", gravados por _cadeado/trancar.mjs)
   Ambiente:
     KV binding  DECK_HITS   (guarda o historico)
     Durable Object PORTEIRO (contadores de erro de PIN: por IP, por cliente e geral)
     secret      LIST_TOKEN  (protege a leitura em /list)
   A proposta chega aqui ja cifrada no navegador de quem emitiu, com a chave
   derivada dos 4 ultimos digitos do telefone do cliente. O Worker guarda bytes
   opacos: nunca ve preco, nome nem valor.

   Sem Telegram, sem cookie.
*/
const MAX_IP = 8;       // erros por IP a cada 15 minutos
const MAX_GRUPO = 40;   // erros por cliente a cada hora, somando todos os IPs
const MAX_TODOS = 100;  // erros no deck inteiro a cada hora: segura ataque ao PIN mestre vindo de muitos IPs

async function hashPin(sal, pin) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sal + ":" + pin));
  return btoa(String.fromCharCode(...new Uint8Array(d)));
}

// Contador de tentativas. Um Durable Object processa um pedido por vez, então a conta
// é exata mesmo com pedidos em paralelo. Usado com três nomes: "ip:<ip>" (vale para
// todas as páginas, porque o PIN mestre abre todas), "g:<grupo>" e "todos".
export class Porteiro {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const { acao, max, janela } = await req.json();
    const st = this.state.storage, agora = Date.now();
    let c = (await st.get("c")) || { n: 0, ate: 0 };
    if (c.ate < agora) c = { n: 0, ate: agora + janela };
    if (acao === "devolve") { c.n = Math.max(0, c.n - 1); await st.put("c", c); return new Response("{}"); }
    if (c.n >= max) return new Response(JSON.stringify({ ok: false }));
    c.n++;
    await st.put("c", c);
    return new Response(JSON.stringify({ ok: true, resta: max - c.n }));
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = { "access-control-allow-origin": "*", "cache-control": "no-store" };

    if (url.pathname === "/hit") {
      const cf = req.cf || {};
      const ua = req.headers.get("user-agent") || "";
      const rec = {
        ts: new Date().toISOString(),
        page: url.searchParams.get("p") || "",
        dest: url.searchParams.get("u") || "",
        loc: [cf.city, cf.region, cf.country].filter(Boolean).join(", "),
        city: cf.city || "",
        region: cf.region || "",
        regionCode: cf.regionCode || "",
        postal: cf.postalCode || "",
        country: cf.country || "",
        lat: cf.latitude || "",
        lon: cf.longitude || "",
        tz: cf.timezone || "",
        isp: cf.asOrganization || "",
        colo: cf.colo || "",
        quem: url.searchParams.get("q") || "",   // consultor que destravou com o PIN dele
        device: /Mobi|Android|iPhone|iPad/i.test(ua) ? "celular" : "computador",
        screen: url.searchParams.get("s") || "",
        ref: url.searchParams.get("r") || req.headers.get("referer") || "",
        ua,
      };
      if (env.DECK_HITS) {
        const key = "hit:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
        ctx.waitUntil(env.DECK_HITS.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 }));
      }
      return new Response("ok", { headers: cors });
    }

    // ---- propostas: guarda o pacote cifrado e devolve um codigo curto ----
    if (url.pathname === "/p" && req.method === "OPTIONS") {
      return new Response(null, {
        headers: { ...cors, "access-control-allow-methods": "POST, GET, OPTIONS",
                   "access-control-allow-headers": "content-type" },
      });
    }

    if (url.pathname === "/p" && req.method === "POST") {
      if (!env.DECK_HITS) return new Response("sem armazenamento", { status: 500, headers: cors });
      const corpo = await req.text();
      // o pacote e base64url; limite generoso, mas nao ilimitado
      if (!corpo || corpo.length > 400000 || !/^[A-Za-z0-9_-]+$/.test(corpo)) {
        return new Response("pacote invalido", { status: 400, headers: cors });
      }
      // codigo sem vogais, para nao formar palavra, e sem caractere ambiguo
      const alfabeto = "23456789BCDFGHJKLMNPQRSTVWXZ";
      let codigo = "";
      for (const n of crypto.getRandomValues(new Uint8Array(7))) codigo += alfabeto[n % alfabeto.length];
      await env.DECK_HITS.put("prop:" + codigo, corpo, { expirationTtl: 60 * 60 * 24 * 180 });
      return new Response(JSON.stringify({ codigo }), {
        headers: { ...cors, "content-type": "application/json; charset=utf-8" },
      });
    }

    if (url.pathname.startsWith("/p/")) {
      const codigo = url.pathname.slice(3).toUpperCase();
      if (!env.DECK_HITS || !/^[A-Z0-9]{4,12}$/.test(codigo)) {
        return new Response("nao encontrada", { status: 404, headers: cors });
      }
      const pacote = await env.DECK_HITS.get("prop:" + codigo);
      if (!pacote) return new Response("nao encontrada", { status: 404, headers: cors });
      return new Response(pacote, { headers: { ...cors, "content-type": "text/plain; charset=utf-8" } });
    }

    // ---- cadeado: confere o PIN e entrega a chave da página ----
    // As páginas do deck vão cifradas com uma chave longa e aleatória por cliente.
    // A chave só sai daqui para quem acerta o PIN, e o erro tem limite: por IP e
    // por cliente. Assim os 4 dígitos não podem ser testados aos milhares.
    if (url.pathname === "/abre" && req.method === "OPTIONS") {
      return new Response(null, {
        headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS",
                   "access-control-allow-headers": "content-type" },
      });
    }

    if (url.pathname === "/abre" && req.method === "POST") {
      const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...cors, "content-type": "application/json; charset=utf-8" },
      });
      if (!env.DECK_HITS) return json({ erro: "sem armazenamento" }, 500);
      let g = "", pin = "";
      try { ({ g, pin } = await req.json()); } catch (e) {}
      if (!/^[a-z0-9-]{1,40}$/.test(g || "") || !/^[0-9]{4}$/.test(pin || "")) return json({ erro: "invalido" }, 400);

      // A tentativa é reservada nos três contadores antes de conferir o PIN.
      const ip = req.headers.get("cf-connecting-ip") || "?";
      const contadores = [["ip:" + ip, MAX_IP, 15 * 60e3], ["g:" + g, MAX_GRUPO, 60 * 60e3], ["todos", MAX_TODOS, 60 * 60e3]];
      const porteiro = (nome) => env.PORTEIRO.get(env.PORTEIRO.idFromName(nome));
      const pede = (nome, corpo) => porteiro(nome).fetch("https://porteiro/", { method: "POST", body: JSON.stringify(corpo) }).then((r) => r.json());
      const reservas = await Promise.all(contadores.map(([nome, max, janela]) => pede(nome, { acao: "conta", max, janela })));
      const devolve = () => Promise.all(contadores.map(([nome, , janela], i) =>
        reservas[i].ok ? pede(nome, { acao: "devolve", janela }) : null));
      if (reservas.some((r) => !r.ok)) { ctx.waitUntil(devolve()); return json({ erro: "espera" }, 429); }

      const [cad, mestre] = await Promise.all([
        env.DECK_HITS.get("cad:" + g, "json"), env.DECK_HITS.get("cad:_mestre", "json")]);
      if (!cad) return json({ erro: "invalido" }, 404);
      let quem = null;
      for (const p of [...(cad.pessoas || []), ...((mestre && mestre.pessoas) || [])]) {
        if (await hashPin(p.s, pin) === p.h) { quem = p.nome; break; }
      }
      if (!quem) return json({ erro: "pin", resta: reservas[0].resta }, 401);
      ctx.waitUntil(devolve());   // acerto não conta como erro
      const chave = cad.chave;

      const cf = req.cf || {};
      const rec = {
        ts: new Date().toISOString(), page: url.searchParams.get("p") || "", dest: "senha: " + quem, quem,
        loc: [cf.city, cf.region, cf.country].filter(Boolean).join(", "), city: cf.city || "",
        region: cf.region || "", country: cf.country || "", isp: cf.asOrganization || "",
        device: /Mobi|Android|iPhone|iPad/i.test(req.headers.get("user-agent") || "") ? "celular" : "computador",
        ua: req.headers.get("user-agent") || "",
      };
      ctx.waitUntil(env.DECK_HITS.put("hit:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
        JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 }));
      return json({ chave, quem });
    }

    if (url.pathname === "/list") {
      if (!env.LIST_TOKEN || url.searchParams.get("token") !== env.LIST_TOKEN) {
        return new Response("nope", { status: 401, headers: cors });
      }
      const out = [];
      if (env.DECK_HITS) {
        const list = await env.DECK_HITS.list({ prefix: "hit:", limit: 1000 });
        const keys = list.keys.map((k) => k.name).sort().reverse().slice(0, 300);
        for (const k of keys) {
          const v = await env.DECK_HITS.get(k);
          if (v) out.push(JSON.parse(v));
        }
      }
      return new Response(JSON.stringify(out, null, 2), {
        headers: { ...cors, "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response("Deck Radar no ar.", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
