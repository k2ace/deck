/* Deck Radar — Worker da Cloudflare que recebe os toques do beacon (track.js).
   Registra cada abertura e, se configurado, avisa no Telegram na hora.
   Variaveis de ambiente (secrets), todas opcionais:
     TG_TOKEN  token do bot do Telegram
     TG_CHAT   id do chat que recebe os avisos
   Binding opcional de KV: DECK_HITS (guarda o historico dos toques).
*/
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname !== "/hit") {
      return new Response("Deck Radar no ar.", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    const cf = req.cf || {};
    const p = url.searchParams.get("p") || "";
    const u = url.searchParams.get("u") || "";
    const ref = url.searchParams.get("r") || req.headers.get("referer") || "";
    const screen = url.searchParams.get("s") || "";
    const ua = req.headers.get("user-agent") || "";
    const loc = [cf.city, cf.region, cf.country].filter(Boolean).join(", ");
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
    const device = isMobile ? "celular" : "computador";

    const rec = {
      ts: new Date().toISOString(),
      page: p, dest: u, loc, device, screen, ref, ua,
    };

    // historico em KV, se houver o binding
    if (env.DECK_HITS) {
      const key = "hit:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
      ctx.waitUntil(env.DECK_HITS.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 }));
    }

    // aviso no Telegram, se houver token e chat
    if (env.TG_TOKEN && env.TG_CHAT) {
      const linhas = [
        "Deck aberto: " + p,
        "Local: " + (loc || "nao identificado"),
        "Aparelho: " + device,
      ];
      if (u) linhas.push("Destinatario: " + u);
      if (ref) linhas.push("Veio de: " + ref);
      const msg = linhas.join("\n");
      ctx.waitUntil(
        fetch("https://api.telegram.org/bot" + env.TG_TOKEN + "/sendMessage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: env.TG_CHAT, text: msg, disable_web_page_preview: true }),
        }).catch(() => {})
      );
    }

    return new Response("ok", {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  },
};
