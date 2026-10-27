# Deck (deck.k2ia.app)

## Regra: toda página abre só com PIN

O repositório é público. Nenhuma página vai ao ar em texto aberto.

- O original de cada página fica em `_fonte/<caminho>` (fora do git).
- Grupo, páginas e PINs ficam em `_fonte/cadeados.json`. O `_mestre` (Klaus) abre todos os grupos.
- `node _cadeado/trancar.mjs [grupo]` cifra a página, grava a porta no lugar público e
  atualiza o servidor (Worker `deck-track`, rota `/abre`, que confere o PIN e limita erros).
- Para editar página trancada: edite o original em `_fonte/` e rode o script de novo.
- **Proposta vale 15 dias.** Grupo de proposta leva `"proposta": true` no `cadeados.json`; o
  trancar grava `"expira"` (hoje + 15) na primeira vez. Depois dessa data o Worker recusa o PIN do
  cliente com "proposta expirada"; o PIN mestre continua abrindo. Para estender, mude `"expira"` e
  rode o trancar do grupo. Les Sept expirou em 21/10/2026. Cristofolini e os grupos sem `proposta` ficam sem validade, por decisão do Klaus (27/10/2026).
- O hook `_cadeado/pre-commit` recusa commit de página sem PIN. Clone novo: instale com
  `cp _cadeado/pre-commit .git/hooks/pre-commit`.
- Exceção: `desafio/index.html` é a capa de proposta expirada (10/10/2026), sem conteúdo nenhum.
  O grupo saiu do `cadeados.json` (cópia em `_fonte/cadeados.antes-expirar-desafio.json`) e a chave
  `cad:desafio` foi apagada do KV. Para reabrir, volte o grupo e rode o trancar.
- Exceção: `cristofolini/index.html` (Gerador) tem cofre próprio por consultor, gerado por
  `_Agents/CRISTOFOLINI/gerar-dados.py`. As ferramentas antigas `desafio/_build.mjs` e
  `desafio/_gate.html` não valem mais: o Desafio passa pelo cadeado como as outras.

## farma/: fonte mora em `_Agents/FARMA`

As páginas em `_fonte/farma/` são cópias geradas por `_Agents/FARMA/publicar.sh`. Edite lá e rode o
script; ele copia, tranca e faz push do deck.
