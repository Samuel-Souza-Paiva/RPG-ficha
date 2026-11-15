# Ficha Sombria

Fichas de **Shadowdark** para celular, salvas em tempo real na Cloudflare.

- Cada **mesa** tem um código (ex.: `terras-sombrias`). Todos os jogadores entram com o mesmo código.
- Cada jogador cria quantos personagens quiser (2–3 por sessão é tranquilo) e alterna entre eles pelas abas no topo da ficha.
- **Toda alteração é salva na hora** e aparece em tempo real para os outros (inclusive para o mestre).
- Sem internet? As alterações ficam guardadas no aparelho e são enviadas quando a conexão voltar.
- Na próxima sessão é só abrir a mesa: a ficha está como ficou.

Campos da ficha (iguais à ficha impressa de Shadowdark): nome; FOR, DES, CON, INT, SAB e CAR (valor / modificador
calculado); ancestralidade; classe; nível; XP (atual / próximo nível); PV; CA; título; alinhamento; antecedente;
divindade; ataques; talentos/magias; equipamento (uma linha por ponto de FOR), PO/PP/PC e carga livre.

- **Tocha:** "Acender tocha" tira uma tocha do equipamento ("Tochas (3)" vira "Tochas (2)") e conta 1 hora.
- **Magias:** use à vontade; ao falhar no teste, toque em **Falhou**. A magia fica bloqueada (o servidor
  impede desmarcar) até o mestre dar o descanso longo.

### Área do mestre (`#/mestre`, com login)

- Painel ao vivo de todas as fichas da mesa (PV, tocha, magias bloqueadas).
- **Descanso longo** por personagem ou para todos: PV no máximo e magias liberadas.
- **Revelar imagem:** aparece em tela cheia para todos os jogadores por 10 segundos e some.
- **Recapitulação:** anotações privadas do mestre, salvas automaticamente.

## Como funciona

```
Celular ──WebSocket──► Worker ──► Durable Object "Mesa" (1 por código de mesa)
                                     └─ SQLite com as fichas da mesa
```

- `public/` — front-end estático (HTML/CSS/JS puro, sem build).
- `src/index.js` — Worker + Durable Object. Recebe cada alteração (`set` de um campo), grava no SQLite e
  repassa aos outros conectados.

## Rodar localmente

Crie um arquivo `.dev.vars` (já está no `.gitignore`) com o login do mestre:

```
MESTRE_USUARIO=seu-usuario
MESTRE_SENHA=sua-senha
```

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

Configure o login do mestre como *secrets* (não ficam no código nem no repositório):

```bash
npx wrangler secret put MESTRE_USUARIO
npx wrangler secret put MESTRE_SENHA
```

O comando de deploy mostra a URL (`https://rpg-ficha.<sua-conta>.workers.dev`). Durable Objects com SQLite funcionam
no plano gratuito.

Alternativa sem terminal: no painel da Cloudflare, **Workers & Pages → Create → Import a repository**, escolha
este repositório e mantenha o comando de deploy padrão (`npx wrangler deploy`).

## Backup

`GET /api/mesa/<codigo>/fichas` devolve todas as fichas da mesa em JSON.

## Segurança

Jogadores não têm login: quem souber o código da mesa pode ver e editar as fichas. A área do mestre exige usuário e senha (validados no servidor). Use um código difícil de adivinhar
(ex.: `sombras-do-norte-7k2q`).
