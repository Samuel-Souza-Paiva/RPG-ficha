# Ficha Sombria

Fichas de **Shadowdark** para celular, salvas em tempo real na Cloudflare.

- Cada **mesa** tem um código (ex.: `terras-sombrias`). Todos os jogadores entram com o mesmo código.
- Cada jogador cria quantos personagens quiser (2–3 por sessão é tranquilo) e alterna entre eles pelas abas no topo da ficha.
- **Toda alteração é salva na hora** e aparece em tempo real para os outros (inclusive para o mestre).
- Sem internet? As alterações ficam guardadas no aparelho e são enviadas quando a conexão voltar.
- Na próxima sessão é só abrir a mesa: a ficha está como ficou.

Campos da ficha (iguais à ficha impressa de Shadowdark): nome; FOR, DES, CON, INT, SAB e CAR (valor / modificador
calculado); ancestralidade; classe; nível; XP (atual / próximo nível); PV; CA; título; alinhamento; antecedente;
divindade; ataques; talentos/magias; equipamento com 20 espaços (os que passam da carga — FOR ou 10 — ficam
apagados), PO/PP/PC e carga livre.

## Como funciona

```
Celular ──WebSocket──► Worker ──► Durable Object "Mesa" (1 por código de mesa)
                                     └─ SQLite com as fichas da mesa
```

- `public/` — front-end estático (HTML/CSS/JS puro, sem build).
- `src/index.js` — Worker + Durable Object. Recebe cada alteração (`set` de um campo), grava no SQLite e
  repassa aos outros conectados.

## Rodar localmente

```bash
npm install
npm run dev        # http://localhost:8787
```

## Publicar na Cloudflare

```bash
npm install
npx wrangler login
npm run deploy
```

O comando mostra a URL (`https://rpg-ficha.<sua-conta>.workers.dev`). Durable Objects com SQLite funcionam
no plano gratuito.

Alternativa sem terminal: no painel da Cloudflare, **Workers & Pages → Create → Import a repository**, escolha
este repositório e mantenha o comando de deploy padrão (`npx wrangler deploy`).

## Backup

`GET /api/mesa/<codigo>/fichas` devolve todas as fichas da mesa em JSON.

## Segurança

Não há login: quem souber o código da mesa pode ver e editar as fichas. Use um código difícil de adivinhar
(ex.: `sombras-do-norte-7k2q`).
