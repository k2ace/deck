# Deck Radar — como ligar o rastreio (Cloudflare)

O beacon (`/track.js`) já está em todas as páginas e envia cada abertura para
`https://deck-track.k2ia.app/hit`. Falta publicar o Worker que recebe e guarda.

## Token de leitura
Este é o token que protege a rota `/list` e que o Claude usa para consultar:

    LIST_TOKEN = deckradar-7q3m9x2k

## Caminho A — pelo wrangler (terminal)

    cd _track
    wrangler kv namespace create DECK_HITS       # copie o id devolvido
    # cole o id no wrangler.toml, no bloco [[kv_namespaces]], e descomente
    # descomente também o bloco routes (deck-track.k2ia.app/*)
    wrangler secret put LIST_TOKEN               # cole: deckradar-7q3m9x2k
    wrangler deploy

## Caminho B — pelo painel da Cloudflare

1. Workers e Pages, criar Worker, colar o conteúdo de `worker.js`.
2. Settings, Variables, KV Namespace Bindings: criar um namespace e ligar com o nome `DECK_HITS`.
3. Settings, Variables, adicionar o secret `LIST_TOKEN` com o valor `deckradar-7q3m9x2k`.
4. Triggers, Custom Domains, adicionar `deck-track.k2ia.app`.

## Depois de publicar
- Teste: abrir `https://deck-track.k2ia.app/hit?p=/teste` deve responder `ok`.
- Leitura: `https://deck-track.k2ia.app/list?token=deckradar-7q3m9x2k` devolve o JSON.
- Se você usar outro endereço em vez de `deck-track.k2ia.app`, me avise que eu troco no `track.js`.

## Para saber quem exatamente abriu
Ao mandar um link, ponha um marcador no fim:
`https://deck.k2ia.app/gjf/?u=glauce`
Aí o registro já vem com o nome de quem recebeu.
