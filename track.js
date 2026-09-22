/* Deck Radar — beacon de abertura das propostas do deck.
   Registra: página, destinatário (?u=nome), origem do clique, idioma e tela.
   A cidade e o estado vêm do IP pelo próprio Cloudflare, no Worker.
   Sem cookie, sem dado digitado. Falha em silêncio se algo der errado. */
(function () {
  try {
    var EP = "https://deck-track.k2ia.workers.dev/hit"; // endpoint do Worker Deck Radar
    var q = new URLSearchParams(location.search);
    var pr = new URLSearchParams();
    pr.set("p", location.pathname);
    if (q.get("u")) pr.set("u", q.get("u"));       // marcador de destinatário no link
    if (document.referrer) pr.set("r", document.referrer);
    pr.set("s", (screen.width || 0) + "x" + (screen.height || 0));
    if (navigator.language) pr.set("lang", navigator.language);
    var url = EP + "?" + pr.toString();
    if (navigator.sendBeacon) { navigator.sendBeacon(url); }
    else { fetch(url, { mode: "no-cors", keepalive: true }).catch(function () {}); }
  } catch (e) {}
})();
