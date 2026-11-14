// ============================================================
// FICHA SOMBRIA — fichas de Shadowdark em tempo real
// ============================================================

// ---------- Utilidades ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 20);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ls = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ }
  },
};
const normalizarMesa = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40);

function getPath(obj, path) {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, v) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (o[k] === null || typeof o[k] !== "object") o[k] = typeof path[i + 1] === "number" ? [] : {};
    o = o[k];
  }
  o[path[path.length - 1]] = v;
}
const parsePath = (s) => s.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- Regras de Shadowdark ----------
const ATRIBUTOS = [
  ["FOR", "Força"], ["DES", "Destreza"], ["CON", "Constituição"],
  ["INT", "Inteligência"], ["SAB", "Sabedoria"], ["CAR", "Carisma"],
];
const ANCESTRALIDADES = ["Humano", "Elfo", "Anão", "Halfling", "Meio-Orc", "Goblin"];
const CLASSES = ["Guerreiro", "Sacerdote", "Ladino", "Mago"];
const ALINHAMENTOS = ["", "Leal", "Neutro", "Caótico"];
const LUZ_MS = 60 * 60 * 1000; // uma tocha dura 1 hora real

const modificador = (v) => {
  v = Number(v) || 0;
  if (v <= 3) return -4;
  if (v <= 5) return -3;
  if (v <= 7) return -2;
  if (v <= 9) return -1;
  if (v <= 11) return 0;
  if (v <= 13) return 1;
  if (v <= 15) return 2;
  if (v <= 17) return 3;
  return 4;
};
const fmtMod = (m) => (m >= 0 ? `+${m}` : `${m}`);

function fichaNova(jogador) {
  return {
    nome: "",
    jogador: jogador || "",
    ancestralidade: "",
    classe: "",
    nivel: 1,
    xp: 0,
    titulo: "",
    alinhamento: "",
    antecedente: "",
    divindade: "",
    idiomas: "Comum",
    atributos: { FOR: 10, DES: 10, CON: 10, INT: 10, SAB: 10, CAR: 10 },
    pv: { atual: 1, max: 1 },
    ca: 10,
    sorte: false,
    ataques: [],
    magias: [],
    talentos: [],
    equipamento: [],
    espacosBonus: 0,
    moedas: { po: 0, pp: 0, pc: 0 },
    luz: { rodando: false, restante: LUZ_MS, desde: 0 },
    notas: "",
  };
}

function espacosUsados(f) {
  const itens = (f.equipamento || []).reduce((s, it) => s + (Number(it.espacos) || 0), 0);
  const m = f.moedas || {};
  const moedas = (Number(m.po) || 0) + (Number(m.pp) || 0) + (Number(m.pc) || 0);
  // as primeiras 100 moedas são grátis; depois, 1 espaço a cada 100
  const espMoedas = moedas > 100 ? Math.ceil((moedas - 100) / 100) : 0;
  return itens + espMoedas;
}
const espacosTotais = (f) => Math.max(Number(f.atributos?.FOR) || 0, 10) + (Number(f.espacosBonus) || 0);

function luzRestante(luz) {
  if (!luz) return LUZ_MS;
  if (!luz.rodando) return Math.max(0, Number(luz.restante) || 0);
  return Math.max(0, (Number(luz.restante) || 0) - (Date.now() - (Number(luz.desde) || Date.now())));
}
const fmtTempo = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// ---------- Dados ----------
const d = (n) => 1 + Math.floor(Math.random() * n);
function rolarExpressao(expr) {
  // aceita "1d8+2", "2d6", "d4-1", "+3"
  const texto = String(expr || "").replace(/\s+/g, "").toLowerCase();
  if (!texto) return null;
  let total = 0;
  const partes = [];
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
  let m;
  let achou = false;
  while ((m = re.exec(texto))) {
    achou = true;
    if (m[3]) {
      const sinal = m[1] === "-" ? -1 : 1;
      const qtd = Math.min(Number(m[2] || 1), 50);
      const lados = Math.min(Number(m[3]), 1000);
      const rs = Array.from({ length: qtd }, () => d(lados));
      total += sinal * rs.reduce((a, b) => a + b, 0);
      partes.push(`${sinal < 0 ? "−" : ""}[${rs.join(", ")}]`);
    } else if (m[5]) {
      const v = Number(m[5]) * (m[4] === "-" ? -1 : 1);
      total += v;
      partes.push(fmtMod(v));
    }
  }
  return achou ? { total, detalhe: partes.join(" ") } : null;
}

function toast({ rotulo, valor, detalhe, tipo }) {
  const el = document.createElement("div");
  el.className = `toast ${tipo || ""}`;
  el.innerHTML = `<div class="t-rotulo">${esc(rotulo)}</div><div class="t-valor">${esc(valor)}</div>${detalhe ? `<div class="t-detalhe">${esc(detalhe)}</div>` : ""}`;
  const box = $("#toasts");
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  el.addEventListener("click", () => el.remove());
  setTimeout(() => { el.classList.add("saindo"); setTimeout(() => el.remove(), 300); }, 4200);
}
function rolarD20(rotulo, mod = 0) {
  const r = d(20);
  const total = r + mod;
  toast({
    rotulo,
    valor: total,
    detalhe: `d20 [${r}] ${fmtMod(mod)}${r === 20 ? " — CRÍTICO!" : r === 1 ? " — FALHA CRÍTICA" : ""}`,
    tipo: r === 20 ? "critico" : r === 1 ? "falha" : "",
  });
  return r;
}
if (navigator.vibrate) document.addEventListener("click", (e) => { if (e.target.closest("[data-rolar]")) navigator.vibrate(15); });

// ============================================================
// SINCRONIZAÇÃO (WebSocket + fila offline persistente)
// ============================================================
const sync = {
  mesa: null,
  fichas: new Map(), // id -> { id, data, atualizado }
  pendentes: [], // operações ainda não confirmadas pelo servidor
  ws: null,
  estado: "offline", // offline | conectando | online
  ouvintes: new Set(),
  tentativas: 0,
  timerReconexao: null,
  timerPing: null,
  ultimoContato: 0,
  carregado: false,

  abrir(mesa) {
    if (this.mesa === mesa) return;
    this.fechar();
    this.mesa = mesa;
    this.carregado = false;
    // cache local: permite abrir a ficha mesmo sem internet
    const cache = ls.get(`cache:${mesa}`, []);
    this.fichas = new Map(cache.map((f) => [f.id, f]));
    this.pendentes = ls.get(`pend:${mesa}`, []);
    for (const op of this.pendentes) this.aplicar(op);
    if (cache.length) this.carregado = true;
    this.conectar();
  },

  fechar() {
    clearTimeout(this.timerReconexao);
    clearInterval(this.timerPing);
    if (this.ws) {
      this.ws.onclose = null;
      try { this.ws.close(); } catch { /* */ }
    }
    this.ws = null;
    this.mesa = null;
    this.setEstado("offline");
  },

  conectar() {
    if (!this.mesa) return;
    clearTimeout(this.timerReconexao);
    this.setEstado("conectando");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/mesa/${encodeURIComponent(this.mesa)}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.tentativas = 0;
      this.ultimoContato = Date.now();
      clearInterval(this.timerPing);
      this.timerPing = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - this.ultimoContato > 45000) { ws.close(); return; }
        ws.send("ping");
      }, 20000);
    };

    ws.onmessage = (ev) => {
      this.ultimoContato = Date.now();
      if (ev.data === "pong") return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.receber(msg);
    };

    ws.onclose = () => {
      clearInterval(this.timerPing);
      if (this.ws !== ws) return;
      this.setEstado("offline");
      const espera = Math.min(1000 * 2 ** this.tentativas++, 15000);
      this.timerReconexao = setTimeout(() => this.conectar(), espera);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  },

  receber(msg) {
    switch (msg.t) {
      case "snapshot": {
        this.fichas = new Map(msg.fichas.map((f) => [f.id, f]));
        // reaplica o que ainda não foi confirmado e reenvia
        for (const op of this.pendentes) this.aplicar(op);
        this.carregado = true;
        this.salvarCache();
        this.setEstado("online");
        for (const op of this.pendentes) this.enviarBruto(op);
        this.avisar({ t: "tudo" });
        break;
      }
      case "set": {
        const f = this.fichas.get(msg.id);
        if (!f) return;
        setPath(f.data, msg.path, msg.v);
        f.atualizado = msg.atualizado;
        // mantém nossas edições locais pendentes por cima
        for (const op of this.pendentes) if (op.id === msg.id && op.t === "set") setPath(f.data, op.path, op.v);
        this.salvarCache();
        this.avisar({ t: "set", id: msg.id, path: msg.path, remoto: true });
        break;
      }
      case "upsert":
        this.fichas.set(msg.ficha.id, msg.ficha);
        this.salvarCache();
        this.avisar({ t: "upsert", id: msg.ficha.id, remoto: true });
        break;
      case "delete":
        this.fichas.delete(msg.id);
        this.salvarCache();
        this.avisar({ t: "delete", id: msg.id, remoto: true });
        break;
      case "ack":
        this.pendentes = this.pendentes.filter((p) => p.op !== msg.op);
        this.salvarPendentes();
        this.avisarEstado();
        break;
      case "erro":
        console.warn("Servidor:", msg.msg);
        this.pendentes = this.pendentes.filter((p) => p.op !== msg.op);
        this.salvarPendentes();
        toast({ rotulo: "Erro ao salvar", valor: "⚠", detalhe: msg.msg, tipo: "falha" });
        this.avisarEstado();
        break;
    }
  },

  aplicar(op) {
    if (op.t === "set") {
      const f = this.fichas.get(op.id);
      if (f) setPath(f.data, op.path, clone(op.v));
    } else if (op.t === "create") {
      if (!this.fichas.has(op.id)) this.fichas.set(op.id, { id: op.id, data: clone(op.data), atualizado: Date.now() });
    } else if (op.t === "delete") {
      this.fichas.delete(op.id);
    }
  },

  /** Ponto único para qualquer alteração feita pelo usuário. */
  enviar(op) {
    op.op = uid();
    if (op.t === "set") {
      // coalesce: descarta pendência anterior idêntica (mesma ficha, mesmo caminho) ainda não enviada com sucesso
      const chave = op.id + "|" + op.path.join(".");
      this.pendentes = this.pendentes.filter((p) => !(p.t === "set" && p.id + "|" + p.path.join(".") === chave));
    }
    this.pendentes.push(op);
    this.salvarPendentes();
    this.aplicar(op);
    this.salvarCache();
    this.enviarBruto(op);
    this.avisarEstado();
  },

  enviarBruto(op) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.estado === "online") {
      this.ws.send(JSON.stringify(op));
    }
  },

  set(id, path, v) { this.enviar({ t: "set", id, path, v }); },

  salvarCache() { if (this.mesa) ls.set(`cache:${this.mesa}`, [...this.fichas.values()]); },
  salvarPendentes() { if (this.mesa) ls.set(`pend:${this.mesa}`, this.pendentes); },

  setEstado(e) { this.estado = e; this.avisarEstado(); },
  avisarEstado() { for (const fn of this.ouvintes) fn({ t: "estado" }); },
  avisar(ev) { for (const fn of this.ouvintes) fn(ev); },
  ouvir(fn) { this.ouvintes.add(fn); return () => this.ouvintes.delete(fn); },
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && sync.mesa && (!sync.ws || sync.ws.readyState > 1)) {
    sync.tentativas = 0;
    sync.conectar();
  }
});
window.addEventListener("online", () => { if (sync.mesa && sync.estado === "offline") { sync.tentativas = 0; sync.conectar(); } });

// ============================================================
// PREFERÊNCIAS LOCAIS
// ============================================================
const prefs = {
  get nome() { return ls.get("jogador", ""); },
  set nome(v) { ls.set("jogador", v); },
  get recentes() { return ls.get("mesas", []); },
  lembrarMesa(m) { ls.set("mesas", [m, ...this.recentes.filter((x) => x !== m)].slice(0, 6)); },
  get filtro() { return ls.get("filtro", "meus"); },
  set filtro(v) { ls.set("filtro", v); },
};
const ehMeu = (f) => prefs.nome && (f.data.jogador || "").trim().toLowerCase() === prefs.nome.trim().toLowerCase();

// ============================================================
// ROTEAMENTO (hash)
// ============================================================
const app = $("#app");
let desmontar = null;

function rota() {
  const h = location.hash.replace(/^#\/?/, "");
  const partes = h.split("/").filter(Boolean).map(decodeURIComponent);
  if (desmontar) { desmontar(); desmontar = null; }
  document.body.classList.remove("com-dados");
  window.scrollTo(0, 0);
  if (partes[0] === "m" && partes[1]) {
    const mesa = normalizarMesa(partes[1]);
    sync.abrir(mesa);
    prefs.lembrarMesa(mesa);
    if (partes[2] === "p" && partes[3]) desmontar = telaFicha(mesa, partes[3]);
    else desmontar = telaLista(mesa);
  } else {
    sync.fechar();
    desmontar = telaEntrada();
  }
}
window.addEventListener("hashchange", rota);
const ir = (h) => { location.hash = h; };

function htmlStatus() {
  const n = sync.pendentes.length;
  if (sync.estado !== "online") return `<span class="status offline" title="Sem conexão — alterações ficam guardadas no aparelho"><i></i>${n ? n + " pend." : "offline"}</span>`;
  if (n) return `<span class="status salvando"><i></i>salvando</span>`;
  return `<span class="status"><i></i>salvo</span>`;
}

// ============================================================
// TELA: ENTRADA
// ============================================================
const SELO = `<svg class="selo" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" fill="none" stroke="#e9e4d8" stroke-width="1.5" stroke-dasharray="2 3"/>
  <circle cx="50" cy="50" r="40" fill="none" stroke="#e9e4d8" stroke-width="0.8"/>
  <path d="M50 10 L54 62 L50 70 L46 62 Z" fill="#e9e4d8"/>
  <path d="M34 62 H66 L62 66 H38 Z" fill="#e9e4d8"/>
  <rect x="47.5" y="66" width="5" height="16" fill="#e9e4d8"/>
  <circle cx="50" cy="86" r="4" fill="#e9e4d8"/>
  <path d="M50 72 q-3 6 0 9 q3 -3 0 -9z" fill="#a3120f"/>
  <path d="M20 30 L30 36 M80 30 L70 36 M18 70 L29 64 M82 70 L71 64" stroke="#e9e4d8" stroke-width="1.2"/>
</svg>`;

function telaEntrada() {
  const recentes = prefs.recentes;
  app.innerHTML = `
  <section class="entrada">
    ${SELO}
    <h1 class="titulo-app">Ficha Sombria</h1>
    <p class="subtitulo">fichas de shadowdark · em tempo real</p>
    <div class="traco"></div>
    <form class="cartao" id="form-entrar">
      <h2 class="secao-titulo">Entrar na mesa</h2>
      <label class="campo"><span>Seu nome (jogador)</span>
        <input name="nome" autocomplete="nickname" placeholder="Ex.: Guts" value="${esc(prefs.nome)}" required maxlength="40"></label>
      <label class="campo"><span>Código da mesa</span>
        <input name="mesa" autocapitalize="none" autocomplete="off" placeholder="Ex.: terras-sombrias" value="${esc(recentes[0] || "")}" required maxlength="40"></label>
      <p class="dica">Todos os jogadores usam o mesmo código. Quem tiver o código vê e edita as fichas da mesa.</p>
      <div style="height:10px"></div>
      <button class="btn bloco" type="submit">Adentrar a escuridão</button>
    </form>
    ${recentes.length ? `<div class="cartao"><h2 class="secao-titulo">Mesas recentes</h2>
      <ul class="mesas-recentes">${recentes.map((m) => `<li><a href="#/m/${encodeURIComponent(m)}">${esc(m)}</a></li>`).join("")}</ul></div>` : ""}
  </section>`;
  $("#form-entrar").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mesa = normalizarMesa(fd.get("mesa"));
    if (mesa.length < 2) { toast({ rotulo: "Código inválido", valor: "⚠", detalhe: "Use letras e números (mín. 2)", tipo: "falha" }); return; }
    prefs.nome = String(fd.get("nome")).trim();
    ir(`#/m/${encodeURIComponent(mesa)}`);
  });
  return null;
}

// ============================================================
// TELA: LISTA DE PERSONAGENS DA MESA
// ============================================================
function telaLista(mesa) {
  const desenhar = () => {
    const todas = [...sync.fichas.values()];
    const filtro = prefs.filtro;
    const visiveis = filtro === "meus" ? todas.filter(ehMeu) : todas;
    app.innerHTML = `
    <header class="topo">
      <a class="icone-btn" href="#/" aria-label="Trocar mesa">‹</a>
      <div class="meio"><div class="nome-mesa">Mesa</div><div class="titulo-ficha">${esc(mesa)}</div></div>
      <div id="status">${htmlStatus()}</div>
    </header>
    <div class="filtros">
      <button data-filtro="meus" class="${filtro === "meus" ? "ativo" : ""}">Meus (${todas.filter(ehMeu).length})</button>
      <button data-filtro="todos" class="${filtro === "todos" ? "ativo" : ""}">Todos (${todas.length})</button>
    </div>
    ${!sync.carregado ? `<p class="vazio">Invocando as fichas…</p>` :
      visiveis.length ? visiveis.map(cardPersonagem).join("") :
      `<p class="vazio">${filtro === "meus" ? `Nenhum personagem de <b>${esc(prefs.nome || "você")}</b> nesta mesa.` : "A mesa está vazia."}<br>Crie um abaixo.</p>`}
    <div style="height:8px"></div>
    <button class="btn bloco" id="novo">+ Novo personagem</button>
    <p class="dica" style="text-align:center">Jogando como <b>${esc(prefs.nome || "—")}</b> · <a href="#/" style="color:inherit">trocar</a></p>`;

    $$("[data-filtro]").forEach((b) => b.addEventListener("click", () => { prefs.filtro = b.dataset.filtro; desenhar(); }));
    $("#novo").addEventListener("click", () => {
      const id = uid();
      sync.enviar({ t: "create", id, data: fichaNova(prefs.nome) });
      ir(`#/m/${encodeURIComponent(mesa)}/p/${id}`);
    });
  };
  desenhar();
  return sync.ouvir((ev) => {
    if (ev.t === "estado") { const s = $("#status"); if (s) s.innerHTML = htmlStatus(); return; }
    desenhar();
  });
}

function cardPersonagem(f) {
  const c = f.data;
  const pv = c.pv || {};
  const pct = pv.max > 0 ? Math.max(0, Math.min(100, (pv.atual / pv.max) * 100)) : 0;
  const meta = [c.ancestralidade, c.classe, c.titulo].filter(Boolean).join(" · ") || "Destino ainda não escrito";
  return `<a class="cartao card-pers" href="#/m/${encodeURIComponent(sync.mesa)}/p/${f.id}">
    <div class="linha1"><span class="nome">${esc(c.nome || "Sem nome")}</span><span class="nivel">NV ${esc(c.nivel ?? 1)}</span></div>
    <div class="meta">${esc(meta)}${c.jogador ? ` — <span style="font-style:normal">${esc(c.jogador)}</span>` : ""}</div>
    <div class="vitais"><span>PV ${esc(pv.atual ?? 0)}/${esc(pv.max ?? 0)}</span><span class="barra-pv"><b style="width:${pct}%"></b></span><span>CA ${esc(c.ca ?? 10)}</span></div>
  </a>`;
}

// ============================================================
// TELA: FICHA
// ============================================================
function telaFicha(mesa, id) {
  const timers = new Map(); // debounce por caminho
  let intervaloLuz = null;
  const ficha = () => sync.fichas.get(id)?.data;
  const base = `#/m/${encodeURIComponent(mesa)}`;

  if (!ficha()) {
    app.innerHTML = `<header class="topo"><a class="icone-btn" href="${base}">‹</a><div class="meio"><div class="titulo-ficha">…</div></div><div id="status">${htmlStatus()}</div></header>
      <p class="vazio">${sync.carregado ? "Esta ficha não existe mais (ou foi apagada)." : "Invocando a ficha…"}</p>`;
    const off = sync.ouvir(() => { if (ficha()) { off(); desmontar = telaFicha(mesa, id); } });
    return off;
  }

  document.body.classList.add("com-dados");

  // ---------- escrita ----------
  const valorDe = (el) => {
    if (el.type === "checkbox") return el.checked;
    if (el.dataset.tipo === "num") {
      const n = parseInt(el.value, 10);
      return Number.isFinite(n) ? n : 0;
    }
    return el.value;
  };
  const enviarCampo = (pathStr, v) => {
    clearTimeout(timers.get(pathStr));
    timers.delete(pathStr);
    sync.set(id, parsePath(pathStr), v);
  };
  const agendar = (pathStr, v, imediato) => {
    // aplica localmente na hora (para os cálculos), envia com pequeno atraso
    setPath(ficha(), parsePath(pathStr), v);
    atualizarDerivados();
    clearTimeout(timers.get(pathStr));
    if (imediato) return enviarCampo(pathStr, v);
    timers.set(pathStr, setTimeout(() => enviarCampo(pathStr, v), 350));
  };
  const descarregar = () => {
    for (const [p, t] of timers) {
      clearTimeout(t);
      sync.set(id, parsePath(p), getPath(ficha(), parsePath(p)));
    }
    timers.clear();
  };
  const definir = (pathStr, v) => { // alteração imediata (botões)
    clearTimeout(timers.get(pathStr)); timers.delete(pathStr);
    sync.set(id, parsePath(pathStr), v);
    sincronizarCampos(); atualizarDerivados();
  };

  // ---------- montagem ----------
  const campo = (rotulo, path, extra = "") => `<label class="campo"><span>${rotulo}</span><input data-bind="${path}" ${extra}></label>`;
  const opcoes = (lista) => lista.map((o) => `<option value="${esc(o)}">${esc(o || "—")}</option>`).join("");

  function montar() {
    const f = ficha();
    const meus = abasPersonagens();
    app.innerHTML = `
    <header class="topo" style="flex-wrap:wrap">
      <a class="icone-btn" href="${base}" aria-label="Voltar">‹</a>
      <div class="meio"><div class="nome-mesa">${esc(mesa)}</div><div class="titulo-ficha" id="t-nome"></div></div>
      <div id="status">${htmlStatus()}</div>
      ${meus.length > 1 ? `<nav class="abas" style="flex-basis:100%">${meus.map((x) => `<a href="${base}/p/${x.id}" class="${x.id === id ? "ativa" : ""}">${esc(x.data.nome || "Sem nome")}</a>`).join("")}</nav>` : ""}
    </header>

    <section class="cartao">
      <h2 class="secao-titulo">Identidade</h2>
      ${campo("Nome", "nome", 'placeholder="Nome do personagem" maxlength="60"')}
      <div class="grade-2">
        <label class="campo"><span>Ancestralidade</span><input data-bind="ancestralidade" list="dl-anc" maxlength="40"></label>
        <label class="campo"><span>Classe</span><input data-bind="classe" list="dl-cls" maxlength="40"></label>
        ${campo("Nível", "nivel", 'type="number" inputmode="numeric" data-tipo="num" min="0" max="10"')}
        ${campo("XP", "xp", 'type="number" inputmode="numeric" data-tipo="num" min="0"')}
      </div>
      <div class="xp-info" id="xp-info"></div>
      <div class="grade-2">
        ${campo("Título", "titulo", 'maxlength="40"')}
        <label class="campo"><span>Alinhamento</span><select data-bind="alinhamento">${opcoes(ALINHAMENTOS)}</select></label>
        ${campo("Antecedente", "antecedente", 'maxlength="60"')}
        ${campo("Divindade", "divindade", 'maxlength="40"')}
      </div>
      ${campo("Idiomas", "idiomas", 'maxlength="120"')}
      ${campo("Jogador", "jogador", 'maxlength="40"')}
      <datalist id="dl-anc">${opcoes(ANCESTRALIDADES)}</datalist>
      <datalist id="dl-cls">${opcoes(CLASSES)}</datalist>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Vigor</h2>
      <div class="vitais-grandes">
        <div class="vital pv">
          <span class="rotulo">Pontos de Vida</span>
          <div class="pv-linha">
            <input data-bind="pv.atual" type="number" inputmode="numeric" data-tipo="num" aria-label="PV atual">
            <span class="barra">/</span>
            <input class="max" data-bind="pv.max" type="number" inputmode="numeric" data-tipo="num" aria-label="PV máximo">
          </div>
          <div class="pv-botoes">
            <button class="icone-btn menor" data-pv="-1" aria-label="Menos 1 PV">−</button>
            <button class="icone-btn menor" data-pv="1" aria-label="Mais 1 PV">+</button>
          </div>
          <div class="morrendo" id="morrendo" hidden>☠ Morrendo</div>
        </div>
        <div class="vital">
          <span class="rotulo">CA</span>
          <input data-bind="ca" type="number" inputmode="numeric" data-tipo="num" aria-label="Classe de armadura">
        </div>
        <div class="vital">
          <span class="rotulo">Sorte</span>
          <label class="toggle"><input type="checkbox" data-bind="sorte"><span class="moeda">✦</span></label>
        </div>
      </div>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Atributos</h2>
      <div class="atributos">
        ${ATRIBUTOS.map(([s, nome]) => `
          <div class="atributo">
            <div class="sigla" title="${nome}">${s}</div>
            <button class="mod" data-rolar="atr" data-atr="${s}" aria-label="Rolar teste de ${nome}" id="mod-${s}"></button>
            <input data-bind="atributos.${s}" type="number" inputmode="numeric" data-tipo="num" min="1" max="20" aria-label="${nome}">
          </div>`).join("")}
      </div>
      <p class="dica" style="text-align:center">Toque no modificador para rolar o teste.</p>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Fonte de luz</h2>
      <div class="luz" id="luz">
        <div class="chama">🔥</div>
        <div class="tempo" id="luz-tempo">60:00</div>
        <div class="botoes">
          <button class="icone-btn" id="luz-play" aria-label="Acender/apagar">▶</button>
          <button class="icone-btn" id="luz-reset" aria-label="Nova tocha">↺</button>
        </div>
      </div>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Ataques</h2>
      <div class="cabecalho-lista"><span class="w-nome">Arma / ataque</span><span class="w-p">Bônus</span><span class="w-m">Dano</span><span class="w-b"></span><span class="w-b"></span></div>
      <ul class="lista" id="l-ataques"></ul>
      <button class="btn fantasma pequeno add-linha" data-add="ataques">+ ataque</button>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Magias</h2>
      <div class="cabecalho-lista"><span class="w-nome">Magia</span><span class="w-p">Grau</span><span class="w-b" title="Perdida">✗</span><span class="w-b"></span></div>
      <ul class="lista" id="l-magias"></ul>
      <button class="btn fantasma pequeno add-linha" data-add="magias">+ magia</button>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Talentos</h2>
      <ul class="lista" id="l-talentos"></ul>
      <button class="btn fantasma pequeno add-linha" data-add="talentos">+ talento</button>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Equipamento</h2>
      <div class="espacos" id="espacos"><span>Espaços</span><b id="esp-txt"></b></div>
      <div class="slots" id="slots"></div>
      <div class="cabecalho-lista"><span class="w-nome">Item</span><span class="w-p">Qtd</span><span class="w-p">Esp.</span><span class="w-b"></span></div>
      <ul class="lista" id="l-equipamento"></ul>
      <button class="btn fantasma pequeno add-linha" data-add="equipamento">+ item</button>
      <div class="moedas">
        ${campo("Ouro", "moedas.po", 'type="number" inputmode="numeric" data-tipo="num" min="0"')}
        ${campo("Prata", "moedas.pp", 'type="number" inputmode="numeric" data-tipo="num" min="0"')}
        ${campo("Cobre", "moedas.pc", 'type="number" inputmode="numeric" data-tipo="num" min="0"')}
      </div>
      <div style="max-width:160px">${campo("Espaços extras", "espacosBonus", 'type="number" inputmode="numeric" data-tipo="num"')}</div>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Anotações</h2>
      <textarea data-bind="notas" placeholder="Pistas, juramentos, dívidas, inimigos…" maxlength="20000"></textarea>
    </section>

    <div class="zona-perigo"><button class="btn sangue pequeno" id="apagar">Apagar personagem</button></div>

    <nav class="dados" aria-label="Rolar dados">
      ${[4, 6, 8, 10, 12, 20, 100].map((n) => `<button data-rolar="d" data-d="${n}">d${n}</button>`).join("")}
    </nav>`;

    LISTAS.forEach(desenharLista);
    sincronizarCampos(true);
    atualizarDerivados();
  }

  // ---------- listas ----------
  const LISTAS = ["ataques", "magias", "talentos", "equipamento"];
  const NOVOS = {
    ataques: () => ({ nome: "", bonus: "+0", dano: "1d6" }),
    magias: () => ({ nome: "", grau: 1, perdida: false }),
    talentos: () => ({ texto: "" }),
    equipamento: () => ({ nome: "", qtd: 1, espacos: 1 }),
  };
  function linhaLista(nome, item, i) {
    const p = `${nome}.${i}`;
    const remover = `<button class="icone-btn menor perigo" data-del="${nome}" data-i="${i}" aria-label="Remover">×</button>`;
    if (nome === "ataques")
      return `<li><input class="w-nome" data-bind="${p}.nome" placeholder="Espada longa" maxlength="60">
        <input class="w-p" data-bind="${p}.bonus" placeholder="+0" maxlength="6">
        <input class="w-m" data-bind="${p}.dano" placeholder="1d8" maxlength="20">
        <button class="icone-btn menor" data-rolar="ataque" data-i="${i}" aria-label="Rolar ataque">⚔</button>${remover}</li>`;
    if (nome === "magias")
      return `<li class="${item.perdida ? "perdida" : ""}"><input class="w-nome" data-bind="${p}.nome" placeholder="Luz" maxlength="60">
        <input class="w-p" data-bind="${p}.grau" type="number" inputmode="numeric" data-tipo="num" min="1" max="5">
        <label class="check" title="Perdida até descansar"><input type="checkbox" data-bind="${p}.perdida"><span>✗</span></label>
        <button class="icone-btn menor" data-rolar="magia" data-i="${i}" aria-label="Conjurar">✶</button>${remover}</li>`;
    if (nome === "talentos")
      return `<li><input class="w-nome" data-bind="${p}.texto" placeholder="+1 em ataques com armas corpo a corpo" maxlength="200">${remover}</li>`;
    return `<li><input class="w-nome" data-bind="${p}.nome" placeholder="Tocha" maxlength="60">
      <input class="w-p" data-bind="${p}.qtd" type="number" inputmode="numeric" data-tipo="num" min="0">
      <input class="w-p" data-bind="${p}.espacos" type="number" inputmode="numeric" data-tipo="num" min="0">${remover}</li>`;
  }
  function desenharLista(nome) {
    const ul = $(`#l-${nome}`);
    if (!ul) return;
    const itens = ficha()[nome] || [];
    ul.innerHTML = itens.map((it, i) => linhaLista(nome, it || {}, i)).join("") ||
      `<li class="dica" style="justify-content:center">— vazio —</li>`;
    sincronizarCampos(true, ul);
  }

  // ---------- leitura (dados -> tela) ----------
  function sincronizarCampos(forcar = false, raiz = app) {
    const f = ficha();
    if (!f) return;
    for (const el of $$("[data-bind]", raiz)) {
      if (!forcar && timers.has(el.dataset.bind)) continue; // não atrapalha quem está digitando
      const v = getPath(f, parsePath(el.dataset.bind));
      if (el.type === "checkbox") el.checked = !!v;
      else {
        const s = v == null ? "" : String(v);
        if (el.value !== s) el.value = s;
      }
    }
  }

  function atualizarDerivados() {
    const f = ficha();
    if (!f) return;
    const nomeEl = $("#t-nome");
    if (nomeEl) nomeEl.textContent = f.nome || "Sem nome";
    document.title = `${f.nome || "Ficha"} · Ficha Sombria`;
    for (const [s] of ATRIBUTOS) {
      const el = $(`#mod-${s}`);
      if (el) el.textContent = fmtMod(modificador(f.atributos?.[s]));
    }
    // XP: em Shadowdark sobe de nível com nível × 10 XP
    const nivel = Number(f.nivel) || 0;
    const prox = Math.max(1, nivel) * 10;
    const xpEl = $("#xp-info");
    if (xpEl) {
      const pode = (Number(f.xp) || 0) >= prox && nivel < 10;
      xpEl.textContent = pode ? `⚔ Pronto para subir ao nível ${nivel + 1}!` : `Próximo nível: ${prox} XP`;
      xpEl.classList.toggle("subir", pode);
    }
    const mor = $("#morrendo");
    if (mor) mor.hidden = !((Number(f.pv?.atual) || 0) <= 0);
    // magias perdidas
    $$("#l-magias > li").forEach((li, i) => li.classList.toggle("perdida", !!f.magias?.[i]?.perdida));
    // espaços de equipamento
    const usados = espacosUsados(f);
    const total = espacosTotais(f);
    const txt = $("#esp-txt");
    if (txt) {
      txt.textContent = `${usados} / ${total}`;
      $("#espacos").classList.toggle("excesso", usados > total);
      const n = Math.min(Math.max(usados, total), 60);
      $("#slots").innerHTML = Array.from({ length: n }, (_, i) =>
        `<i class="${i < usados ? (i >= total ? "excesso" : "cheio") : ""}"></i>`).join("");
    }
    atualizarLuz();
  }

  function atualizarLuz() {
    const f = ficha();
    const box = $("#luz");
    if (!f || !box) return;
    const luz = f.luz || { rodando: false, restante: LUZ_MS };
    const r = luzRestante(luz);
    const acesa = luz.rodando && r > 0;
    box.classList.toggle("acesa", acesa);
    const t = $("#luz-tempo");
    t.textContent = r > 0 ? fmtTempo(r) : "Apagou";
    t.classList.toggle("fim", r <= 0 || r < 5 * 60 * 1000);
    $("#luz-play").textContent = acesa ? "❚❚" : "▶";
    clearInterval(intervaloLuz);
    if (acesa) intervaloLuz = setInterval(atualizarLuz, 1000);
  }

  // ---------- eventos ----------
  const aoDigitar = (e) => {
    const el = e.target.closest("[data-bind]");
    if (!el) return;
    const imediato = el.type === "checkbox" || el.tagName === "SELECT";
    // "change" em campos de texto dispara ao sair do campo e reenviaria um valor velho
    if (e.type === "change" && !imediato) return;
    if (e.type === "input" && imediato) return;
    agendar(el.dataset.bind, valorDe(el), imediato);
  };
  const aoSair = (e) => {
    const el = e.target.closest?.("[data-bind]");
    if (el && timers.has(el.dataset.bind)) enviarCampo(el.dataset.bind, valorDe(el));
  };
  const aoClicar = (e) => {
    const f = ficha();
    const alvo = e.target.closest("button, [data-rolar]");
    if (!alvo || !f) return;

    if (alvo.dataset.pv) {
      const atual = Number(f.pv?.atual) || 0;
      definir("pv.atual", atual + Number(alvo.dataset.pv));
    } else if (alvo.dataset.add) {
      const nome = alvo.dataset.add;
      const lista = [...(f[nome] || []), NOVOS[nome]()];
      sync.set(id, [nome], lista);
      desenharLista(nome);
      atualizarDerivados();
      const inputs = $$(`#l-${nome} > li:last-child input`);
      inputs[0]?.focus();
    } else if (alvo.dataset.del) {
      const nome = alvo.dataset.del;
      const i = Number(alvo.dataset.i);
      descarregar();
      const lista = (f[nome] || []).filter((_, j) => j !== i);
      sync.set(id, [nome], lista);
      desenharLista(nome);
      atualizarDerivados();
    } else if (alvo.dataset.rolar === "atr") {
      const s = alvo.dataset.atr;
      rolarD20(`Teste de ${ATRIBUTOS.find((a) => a[0] === s)[1]}`, modificador(f.atributos?.[s]));
    } else if (alvo.dataset.rolar === "d") {
      const n = Number(alvo.dataset.d);
      const r = d(n);
      toast({ rotulo: `d${n}`, valor: r, tipo: n === 20 && r === 20 ? "critico" : n === 20 && r === 1 ? "falha" : "" });
    } else if (alvo.dataset.rolar === "ataque") {
      const at = f.ataques?.[Number(alvo.dataset.i)] || {};
      const bonus = parseInt(String(at.bonus || "0").replace(/\s/g, ""), 10) || 0;
      const nat = d(20);
      const dano = rolarExpressao(at.dano);
      const crit = nat === 20;
      let danoTotal = dano?.total;
      if (crit && dano) danoTotal += rolarExpressao(String(at.dano).replace(/[+-]\d+$/, ""))?.total || 0; // crítico: dados de dano em dobro
      toast({
        rotulo: at.nome || "Ataque",
        valor: `${nat + bonus}${dano ? ` · ${danoTotal} dano` : ""}`,
        detalhe: `d20 [${nat}] ${fmtMod(bonus)}${dano ? ` · ${at.dano}: ${dano.detalhe}` : ""}${crit ? " — CRÍTICO! dados em dobro" : nat === 1 ? " — FALHA CRÍTICA" : ""}`,
        tipo: crit ? "critico" : nat === 1 ? "falha" : "",
      });
    } else if (alvo.dataset.rolar === "magia") {
      const mg = f.magias?.[Number(alvo.dataset.i)] || {};
      const cls = String(f.classe || "").toLowerCase();
      const atr = cls.startsWith("sacerd") || cls.startsWith("priest") ? "SAB" : cls.startsWith("mag") || cls.startsWith("wiz") ? "INT" : modificador(f.atributos?.SAB) > modificador(f.atributos?.INT) ? "SAB" : "INT";
      const cd = 10 + (Number(mg.grau) || 1);
      const nat = rolarD20(`${mg.nome || "Magia"} (CD ${cd}, ${atr})`, modificador(f.atributos?.[atr]));
      const total = nat + modificador(f.atributos?.[atr]);
      if (nat !== 20 && total < cd && !mg.perdida) {
        definir(`magias.${alvo.dataset.i}.perdida`, true);
      }
    } else if (alvo.id === "luz-play") {
      const luz = { ...(f.luz || { restante: LUZ_MS }) };
      const r = luzRestante(luz);
      const nova = luz.rodando ? { rodando: false, restante: r, desde: 0 } : { rodando: r > 0, restante: r, desde: Date.now() };
      sync.set(id, ["luz"], nova);
      atualizarLuz();
    } else if (alvo.id === "luz-reset") {
      sync.set(id, ["luz"], { rodando: false, restante: LUZ_MS, desde: 0 });
      atualizarLuz();
    } else if (alvo.id === "apagar") {
      const nome = f.nome || "este personagem";
      if (confirm(`Apagar ${nome} para sempre? Esta ação não tem volta.`)) {
        descarregar();
        sync.enviar({ t: "delete", id });
        ir(base);
      }
    }
  };

  montar();
  app.addEventListener("input", aoDigitar);
  app.addEventListener("change", aoDigitar);
  app.addEventListener("focusout", aoSair);
  app.addEventListener("click", aoClicar);
  window.addEventListener("pagehide", descarregar);
  const offVis = () => { if (document.visibilityState === "hidden") descarregar(); };
  document.addEventListener("visibilitychange", offVis);

  const offSync = sync.ouvir((ev) => {
    if (ev.t === "estado") { const s = $("#status"); if (s) s.innerHTML = htmlStatus(); return; }
    if (ev.t === "delete" && ev.id === id) {
      toast({ rotulo: "Ficha apagada", valor: "☠", detalhe: "Outro jogador apagou esta ficha", tipo: "falha" });
      ir(base);
      return;
    }
    if (!ficha()) return;
    if (ev.t === "tudo") {
      LISTAS.forEach((n) => { if ($$(`#l-${n} [data-bind]`).length === 0 || listaMudou(n)) desenharLista(n); });
    } else if (ev.t === "set" && ev.id === id && LISTAS.includes(ev.path[0]) && listaMudou(ev.path[0])) {
      // não redesenha a lista se alguém está digitando nela
      const ul = $(`#l-${ev.path[0]}`);
      if (!ul?.contains(document.activeElement)) desenharLista(ev.path[0]);
    }
    if (ev.t === "upsert" || ev.t === "tudo" || ev.t === "delete") atualizarAbas();
    sincronizarCampos();
    atualizarDerivados();
  });

  function abasPersonagens() {
    const meus = [...sync.fichas.values()].filter(ehMeu);
    if (!meus.some((x) => x.id === id) && sync.fichas.get(id)) meus.unshift(sync.fichas.get(id));
    return meus;
  }
  function listaMudou(nome) {
    const n = (ficha()[nome] || []).length;
    const dom = $$(`#l-${nome} > li`).filter((li) => li.querySelector("[data-bind]")).length;
    return n !== dom;
  }
  function atualizarAbas() {
    // simples: só reconstrói a barra de abas se o número de personagens mudar
    const meus = abasPersonagens();
    const abas = $(".abas");
    if ((abas ? abas.children.length : 0) !== (meus.length > 1 ? meus.length : 0)) {
      const foco = document.activeElement?.dataset?.bind;
      descarregar(); montar();
      if (foco) $(`[data-bind="${foco}"]`)?.focus();
    }
  }

  return () => {
    descarregar();
    clearInterval(intervaloLuz);
    offSync();
    app.removeEventListener("input", aoDigitar);
    app.removeEventListener("change", aoDigitar);
    app.removeEventListener("focusout", aoSair);
    app.removeEventListener("click", aoClicar);
    window.removeEventListener("pagehide", descarregar);
    document.removeEventListener("visibilitychange", offVis);
  };
}

rota();
