# Deck Radar — rastreio de abertura dos decks (Cloudflare)

Está no ar. O beacon (`/track.js`) está em todas as páginas e envia cada
abertura para o Worker `deck-track`, publicado em
`https://deck-track.k2ia.workers.dev`.

## Peças
- `worker.js` — o Worker. Rotas: `/hit` grava a abertura no KV, `/list?token=...` devolve o histórico.
- KV `DECK_HITS` — guarda os registros.
- Secret `LIST_TOKEN` — protege a leitura. O valor NÃO fica aqui no repositório,
  está em `_Agents/.deck-radar-token`, fora do git.

## Ler as aberturas
Peça ao Claude aqui no chat ("quem abriu o GJF") que ele consulta e resume.
A rota crua é `https://deck-track.k2ia.workers.dev/list?token=<LIST_TOKEN>`.

## Saber a pessoa exata
Ao mandar um link, ponha um marcador no fim:
`https://deck.k2ia.app/gjf/?u=glauce`

## Republicar o Worker, se mudar o worker.js
    cd _track
    CLOUDFLARE_ACCOUNT_ID=0d24fa910a904e0ebc749d7417719d8c npx wrangler deploy

## Cadeado das páginas (rota /abre)
As páginas do deck vão cifradas com uma chave por cliente. A tela de PIN manda os
4 dígitos para `/abre`, que confere contra o KV (`cad:<grupo>` e `cad:_mestre`, só
hash com sal) e devolve a chave. Erros têm limite: 8 por IP a cada 15 min e 40 por
cliente a cada hora. Quem grava os cadeados é `node _cadeado/trancar.mjs`.
A contagem fica num Durable Object `Porteiro` (um por cliente), que conta a tentativa
antes de conferir. Assim pedidos em paralelo não furam o limite.
