/* Deck Radar — Worker da Cloudflare para o rastreio de abertura dos decks.
   Rotas:
     GET /hit    grava uma abertura no KV (chamada pelo beacon track.js)
     GET /list?token=XXX   devolve as ultimas aberturas em JSON (para o Claude consultar)
     POST /p     guarda uma proposta ja cifrada e devolve um codigo curto
     GET /p/CODIGO   devolve a proposta cifrada daquele codigo
   Ambiente:
     KV binding  DECK_HITS   (guarda o historico)
     secret      LIST_TOKEN  (protege a leitura em /list)
   A proposta chega aqui ja cifrada no navegador de quem emitiu, com a chave
   derivada dos 4 ultimos digitos do telefone do cliente. O Worker guarda bytes
   opacos: nunca ve preco, nome nem valor.

   Sem Telegram, sem cookie.
*/
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
