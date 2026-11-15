import { DurableObject } from "cloudflare:workers";

// Limites de segurança
const MAX_MSG = 64 * 1024; // tamanho máximo de uma mensagem WebSocket
const MAX_FICHA = 256 * 1024; // tamanho máximo de uma ficha (JSON)
const MAX_FICHAS = 200; // fichas por mesa
const MAX_IMAGEM = 900 * 1024; // imagem enviada pelo mestre (data URL já comprimida no navegador)
const CHAVES_PROIBIDAS = new Set(["__proto__", "constructor", "prototype"]);
const RE_MESA = /^[a-z0-9][a-z0-9-]{1,39}$/;
const RE_ID = /^[A-Za-z0-9_-]{6,64}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** Aplica `valor` no caminho `path` dentro de `obj`, criando objetos/arrays intermediários. */
function setPath(obj, path, valor) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (o[k] === null || typeof o[k] !== "object") o[k] = typeof path[i + 1] === "number" ? [] : {};
    o = o[k];
  }
  o[path[path.length - 1]] = valor;
}

function caminhoValido(path) {
  if (!Array.isArray(path) || path.length < 1 || path.length > 8) return false;
  return path.every(
    (k) =>
      (typeof k === "string" && k.length > 0 && k.length <= 64 && !CHAVES_PROIBIDAS.has(k)) ||
      (Number.isInteger(k) && k >= 0 && k < 1000)
  );
}

/**
 * Magia marcada como "falhou" só volta no descanso longo (dado pelo mestre).
 * Garante isso no servidor: nenhuma edição de jogador desmarca nem apaga uma magia falhada.
 * Devolve true se precisou corrigir algo.
 */
function protegerMagias(antes, depois) {
  const falhadas = (Array.isArray(antes.magias) ? antes.magias : []).filter((m) => m && m.falhou && m.id);
  if (!falhadas.length) return false;
  if (!Array.isArray(depois.magias)) depois.magias = [];
  let corrigiu = false;
  for (const velha of falhadas) {
    const nova = depois.magias.find((m) => m && m.id === velha.id);
    if (!nova) {
      depois.magias.push(velha);
      corrigiu = true;
    } else if (!nova.falhou) {
      nova.falhou = true;
      corrigiu = true;
    }
  }
  return corrigiu;
}

/**
 * Uma mesa (campanha) = um Durable Object.
 * Guarda todas as fichas em SQLite e mantém os WebSockets dos jogadores conectados.
 */
export class Mesa extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fichas (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      criado INTEGER NOT NULL,
      atualizado INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`);
    // Responde "ping" sem acordar o objeto (economiza no plano gratuito)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  listar() {
    return this.sql
      .exec("SELECT id, data, atualizado FROM fichas ORDER BY criado")
      .toArray()
      .map((r) => ({ id: r.id, data: JSON.parse(r.data), atualizado: r.atualizado }));
  }

  obter(id) {
    const rows = this.sql.exec("SELECT data FROM fichas WHERE id = ?", id).toArray();
    return rows.length ? JSON.parse(rows[0].data) : null;
  }

  gravar(id, data, nova) {
    const texto = JSON.stringify(data);
    if (texto.length > MAX_FICHA) throw new Error("Ficha grande demais");
    const agora = Date.now();
    if (nova) {
      this.sql.exec("INSERT INTO fichas (id, data, criado, atualizado) VALUES (?, ?, ?, ?)", id, texto, agora, agora);
    } else {
      this.sql.exec("UPDATE fichas SET data = ?, atualizado = ? WHERE id = ?", texto, agora, id);
    }
    return agora;
  }

  transmitir(msg, exceto) {
    const texto = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exceto) continue;
      try {
        ws.send(texto);
      } catch {
        /* conexão já caiu */
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const { 0: cliente, 1: servidor } = new WebSocketPair();
      this.ctx.acceptWebSocket(servidor);
      servidor.send(JSON.stringify({ t: "snapshot", fichas: this.listar() }));
      return new Response(null, { status: 101, webSocket: cliente });
    }

    // ---- rotas do mestre (só chegam aqui com token válido, ver Worker) ----

    // POST /api/mesa/:mesa/imagem  -> pop-up de imagem para todos os jogadores conectados
    if (request.method === "POST" && url.pathname.endsWith("/imagem")) {
      const corpo = await request.json().catch(() => ({}));
      const src = String(corpo.src || "");
      if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return json({ erro: "Imagem inválida" }, 400);
      if (src.length > MAX_IMAGEM) return json({ erro: "Imagem grande demais" }, 413);
      const legenda = String(corpo.legenda || "").slice(0, 140);
      this.transmitir({ t: "imagem", src, legenda, segundos: 10 });
      return json({ ok: true, enviados: this.ctx.getWebSockets().length });
    }

    // GET/PUT /api/mesa/:mesa/notas  -> anotações privadas do mestre (resumo das sessões)
    if (url.pathname.endsWith("/notas")) {
      if (request.method === "PUT") {
        const corpo = await request.json().catch(() => ({}));
        const texto = String(corpo.texto ?? "").slice(0, 100000);
        this.sql.exec("INSERT INTO meta (chave, valor) VALUES ('notas', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor", texto);
        return json({ ok: true, salvo: Date.now() });
      }
      const row = this.sql.exec("SELECT valor FROM meta WHERE chave = 'notas'").toArray()[0];
      return json({ texto: row ? row.valor : "" });
    }

    // POST /api/mesa/:mesa/descanso
    if (request.method === "POST" && url.pathname.endsWith("/descanso")) {
      let corpo = {};
      try { corpo = await request.json(); } catch { /* corpo vazio = todos */ }
      const ids = Array.isArray(corpo.ids) ? corpo.ids : null;
      const feitos = [];
      for (const { id, data } of this.listar()) {
        if (ids && !ids.includes(id)) continue;
        data.pv = data.pv || {};
        data.pv.atual = Number(data.pv.max) || 0;
        if (Array.isArray(data.magias)) data.magias.forEach((m) => { if (m) m.falhou = false; });
        const atualizado = this.gravar(id, data, false);
        this.transmitir({ t: "set", id, path: ["pv", "atual"], v: data.pv.atual, atualizado });
        this.transmitir({ t: "set", id, path: ["magias"], v: data.magias || [], atualizado });
        feitos.push(id);
      }
      return json({ ok: true, descansaram: feitos.length });
    }

    // GET /api/mesa/:mesa/fichas  -> todas as fichas (backup / consulta)
    if (request.method === "GET" && url.pathname.endsWith("/fichas")) {
      return json(this.listar());
    }
    // GET /api/mesa/:mesa/fichas/:id
    const m = url.pathname.match(/\/fichas\/([^/]+)$/);
    if (request.method === "GET" && m) {
      const data = this.obter(m[1]);
      return data ? json({ id: m[1], data }) : json({ erro: "Ficha não encontrada" }, 404);
    }
    return json({ erro: "Rota inválida" }, 404);
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const op = typeof msg.op === "string" ? msg.op.slice(0, 64) : undefined;
    const erro = (texto) => ws.send(JSON.stringify({ t: "erro", op, msg: texto }));

    try {
      if (!RE_ID.test(msg.id || "")) return erro("ID inválido");

      if (msg.t === "set") {
        if (!caminhoValido(msg.path)) return erro("Caminho inválido");
        const data = this.obter(msg.id);
        if (!data) return erro("Ficha não existe");
        const antes = msg.path[0] === "magias" ? structuredClone(data) : null;
        setPath(data, msg.path, msg.v ?? null);
        const corrigiu = antes ? protegerMagias(antes, data) : false;
        const atualizado = this.gravar(msg.id, data, false);
        if (corrigiu) {
          // confirma a operação e manda a lista corrigida para todos (inclusive quem tentou)
          ws.send(JSON.stringify({ t: "ack", op }));
          this.transmitir({ t: "set", id: msg.id, path: ["magias"], v: data.magias, atualizado });
          ws.send(JSON.stringify({ t: "erro", msg: "Magia que falhou só volta no descanso longo." }));
          return;
        }
        this.transmitir({ t: "set", id: msg.id, path: msg.path, v: msg.v ?? null, atualizado }, ws);
      } else if (msg.t === "create") {
        if (!msg.data || typeof msg.data !== "object" || Array.isArray(msg.data)) return erro("Dados inválidos");
        if (!this.obter(msg.id)) {
          const total = this.sql.exec("SELECT COUNT(*) AS n FROM fichas").one().n;
          if (total >= MAX_FICHAS) return erro("Limite de fichas da mesa atingido");
          const atualizado = this.gravar(msg.id, msg.data, true);
          this.transmitir({ t: "upsert", ficha: { id: msg.id, data: msg.data, atualizado } }, ws);
        }
      } else if (msg.t === "delete") {
        this.sql.exec("DELETE FROM fichas WHERE id = ?", msg.id);
        this.transmitir({ t: "delete", id: msg.id }, ws);
      } else {
        return erro("Operação desconhecida");
      }
      ws.send(JSON.stringify({ t: "ack", op }));
    } catch (e) {
      erro(String(e.message || e));
    }
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code, "tchau");
    } catch {
      /* já fechado */
    }
  }

  async webSocketError(ws) {
    try {
      ws.close(1011, "erro");
    } catch {
      /* já fechado */
    }
  }
}

// ---------- Autenticação do mestre ----------
// Usuário e senha vêm de secrets da Cloudflare (MESTRE_USUARIO / MESTRE_SENHA), nunca do código.
const enc = new TextEncoder();
const TOKEN_DIAS = 30;

async function chaveHmac(env) {
  return crypto.subtle.importKey("raw", enc.encode("ficha-sombria:" + env.MESTRE_SENHA), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function iguaisSeguro(a, b) {
  // compara em tempo constante usando o hash das duas strings
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i] ^ y[i];
  return dif === 0;
}

async function gerarToken(env) {
  const exp = Date.now() + TOKEN_DIAS * 86400000;
  const sig = await crypto.subtle.sign("HMAC", await chaveHmac(env), enc.encode("mestre:" + exp));
  return `${exp}.${b64url(sig)}`;
}

async function tokenValido(request, env) {
  if (!env.MESTRE_SENHA) return false;
  const m = (request.headers.get("Authorization") || "").match(/^Bearer (\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m || Number(m[1]) < Date.now()) return false;
  try {
    return await crypto.subtle.verify("HMAC", await chaveHmac(env), deB64url(m[2]), enc.encode("mestre:" + m[1]));
  } catch {
    return false;
  }
}

async function login(request, env) {
  if (!env.MESTRE_USUARIO || !env.MESTRE_SENHA) return json({ erro: "Login do mestre não configurado no servidor" }, 503);
  let corpo;
  try { corpo = await request.json(); } catch { return json({ erro: "Requisição inválida" }, 400); }
  const okUser = await iguaisSeguro(String(corpo.usuario || ""), env.MESTRE_USUARIO);
  const okSenha = await iguaisSeguro(String(corpo.senha || ""), env.MESTRE_SENHA);
  if (!(okUser && okSenha)) {
    await new Promise((r) => setTimeout(r, 600)); // atrasa tentativas de adivinhação
    return json({ erro: "Usuário ou senha incorretos" }, 401);
  }
  return json({ token: await gerarToken(env) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/mestre/login" && request.method === "POST") return login(request, env);
    if (url.pathname === "/api/mestre/verificar") return json({ ok: await tokenValido(request, env) });

    const m = url.pathname.match(/^\/api\/mesa\/([^/]+)(\/.*)?$/);
    if (!m) return json({ erro: "Não encontrado" }, 404);

    const mesa = decodeURIComponent(m[1]).toLowerCase();
    if (!RE_MESA.test(mesa)) return json({ erro: "Código de mesa inválido" }, 400);

    const rotaMestre = /^\/(descanso|imagem|notas)\/?$/.test(m[2] || "");
    if (rotaMestre && !(await tokenValido(request, env))) {
      return json({ erro: "Apenas o mestre pode fazer isso" }, 401);
    }

    const stub = env.MESA.get(env.MESA.idFromName(mesa));
    return stub.fetch(request);
  },
};
