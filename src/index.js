import { DurableObject } from "cloudflare:workers";

// Limites de segurança
const MAX_MSG = 64 * 1024; // tamanho máximo de uma mensagem WebSocket
const MAX_FICHA = 256 * 1024; // tamanho máximo de uma ficha (JSON)
const MAX_FICHAS = 200; // fichas por mesa
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
        setPath(data, msg.path, msg.v ?? null);
        const atualizado = this.gravar(msg.id, data, false);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/mesa\/([^/]+)(\/.*)?$/);
    if (!m) return json({ erro: "Não encontrado" }, 404);

    const mesa = decodeURIComponent(m[1]).toLowerCase();
    if (!RE_MESA.test(mesa)) return json({ erro: "Código de mesa inválido" }, 400);

    const stub = env.MESA.get(env.MESA.idFromName(mesa));
    return stub.fetch(request);
  },
};
