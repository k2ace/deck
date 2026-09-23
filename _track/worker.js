/* Deck Radar — Worker da Cloudflare para o rastreio de abertura dos decks.
   Rotas:
     GET /hit    grava uma abertura no KV (chamada pelo beacon track.js)
     GET /list?token=XXX   devolve as ultimas aberturas em JSON (para o Claude consultar)
   Ambiente:
     KV binding  DECK_HITS   (guarda o historico)
     secret      LIST_TOKEN  (protege a leitura em /list)
   Sem Telegram, sem cookie. So registra abertura.
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
