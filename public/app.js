// ============================================================
// FICHA SOMBRIA — fichas de Shadowdark em tempo real
// ============================================================

import { arteCapa, arteFundo, cinzas } from "./arte.js";

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

const TOCHA_MS = 60 * 60 * 1000; // uma tocha dura 1 hora real

function fichaNova(jogador) {
  return {
    nome: "",
    jogador: jogador || "",
    atributos: { FOR: 10, DES: 10, CON: 10, INT: 10, SAB: 10, CAR: 10 },
    ancestralidade: "",
    classe: "",
    nivel: 1,
    xp: 0,
    pv: { atual: 1, max: 1 },
    ca: 10,
    titulo: "",
    alinhamento: "",
    antecedente: "",
    divindade: "",
    ataques: "",
    talentos: "",
    magias: [], // { id, nome, falhou }
    moedas: { po: 0, pp: 0, pc: 0 },
    equipamento: [],
    cargaLivre: "",
    tocha: { acesa: false, restante: 0, desde: 0 },
  };
}

// Espaços de equipamento = valor de FOR do personagem
const espacosTotais = (f) => Math.max(0, Math.min(Number(f.atributos?.FOR) || 0, 40));

function tochaRestante(t) {
  if (!t) return 0;
  const r = Number(t.restante) || 0;
  return Math.max(0, t.acesa ? r - (Date.now() - (Number(t.desde) || Date.now())) : r);
}
const fmtTempo = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

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
      case "imagem":
        if (!location.hash.startsWith("#/mestre")) mostrarImagem(msg);
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
        toast({ rotulo: msg.op ? "Erro ao salvar" : "Aviso", valor: "⚠", detalhe: msg.msg, tipo: "falha" });
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
  window.scrollTo(0, 0);
  if (partes[0] === "mestre") {
    if (partes[1] === "m" && partes[2]) {
      const mesa = normalizarMesa(partes[2]);
      sync.abrir(mesa);
      prefs.lembrarMesa(mesa);
      desmontar = telaMestre(mesa);
    } else {
      sync.fechar();
      desmontar = telaMestreEntrada();
    }
  } else if (partes[0] === "m" && partes[1]) {
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
// camadas de arte fixas (fundo com massas de tinta e cinzas caindo)
document.getElementById("fundo").innerHTML = arteFundo();
document.getElementById("cinzas").innerHTML = cinzas();

function telaEntrada() {
  const recentes = prefs.recentes;
  app.innerHTML = `
  <section class="entrada">
    <div class="capa">${arteCapa()}</div>
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
    <p style="text-align:center;margin-top:24px"><a class="btn fantasma pequeno" href="#/mestre">Área do mestre</a></p>
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
// ÁREA DO MESTRE
// ============================================================
const mestre = {
  get token() { return ls.get("mestreToken", ""); },
  set token(v) { ls.set("mestreToken", v); },
  async api(caminho, corpo, metodo = "POST") {
    const r = await fetch(caminho, {
      method: metodo,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: metodo === "GET" ? undefined : JSON.stringify(corpo || {}),
    });
    const dados = await r.json().catch(() => ({}));
    if (r.status === 401 && caminho !== "/api/mestre/login") {
      this.token = "";
      toast({ rotulo: "Sessão do mestre expirou", valor: "🔒", detalhe: "Entre de novo", tipo: "falha" });
      ir("#/mestre");
    }
    if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`);
    return dados;
  },
  async verificar() {
    if (!this.token) return false;
    try {
      const r = await fetch("/api/mestre/verificar", { headers: { authorization: `Bearer ${this.token}` } });
      return !!(await r.json()).ok;
    } catch {
      return true; // sem internet: confia no token salvo; o servidor valida de novo em cada ação
    }
  },
};

function telaMestreEntrada() {
  let vivo = true;
  const desenharLogin = () => {
    app.innerHTML = `
    <header class="topo"><a class="icone-btn" href="#/" aria-label="Voltar">‹</a>
      <div class="meio"><div class="nome-mesa">Ficha Sombria</div><div class="titulo-ficha">Área do Mestre</div></div><div style="width:40px"></div></header>
    <form class="cartao" id="form-login" style="margin-top:24px">
      <h2 class="secao-titulo">Entrar como mestre</h2>
      <label class="campo"><span>Usuário</span><input name="usuario" autocomplete="username" autocapitalize="none" required></label>
      <label class="campo"><span>Senha</span><input name="senha" type="password" autocomplete="current-password" required></label>
      <div style="height:10px"></div>
      <button class="btn bloco" type="submit">Entrar</button>
    </form>`;
    $("#form-login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const botao = e.target.querySelector("button");
      botao.disabled = true;
      try {
        const { token } = await mestre.api("/api/mestre/login", { usuario: fd.get("usuario"), senha: fd.get("senha") });
        mestre.token = token;
        if (vivo) desenharMesas();
      } catch (err) {
        toast({ rotulo: "Não foi possível entrar", valor: "🔒", detalhe: err.message, tipo: "falha" });
        botao.disabled = false;
      }
    });
  };
  const desenharMesas = () => {
    const recentes = prefs.recentes;
    app.innerHTML = `
    <header class="topo"><a class="icone-btn" href="#/" aria-label="Voltar">‹</a>
      <div class="meio"><div class="nome-mesa">Ficha Sombria</div><div class="titulo-ficha">Área do Mestre</div></div>
      <button class="icone-btn" id="sair" aria-label="Sair" title="Sair">⏻</button></header>
    <form class="cartao" id="form-mesa" style="margin-top:24px">
      <h2 class="secao-titulo">Abrir mesa</h2>
      <label class="campo"><span>Código da mesa</span><input name="mesa" autocapitalize="none" autocomplete="off" value="${esc(recentes[0] || "")}" required maxlength="40"></label>
      <button class="btn bloco" type="submit">Abrir painel</button>
    </form>
    ${recentes.length ? `<div class="cartao"><h2 class="secao-titulo">Mesas recentes</h2>
      <ul class="mesas-recentes">${recentes.map((m) => `<li><a href="#/mestre/m/${encodeURIComponent(m)}">${esc(m)}</a></li>`).join("")}</ul></div>` : ""}`;
    $("#form-mesa").addEventListener("submit", (e) => {
      e.preventDefault();
      const mesa = normalizarMesa(new FormData(e.target).get("mesa"));
      if (mesa.length >= 2) ir(`#/mestre/m/${encodeURIComponent(mesa)}`);
    });
    $("#sair").addEventListener("click", () => { mestre.token = ""; desenharLogin(); });
  };
  app.innerHTML = `<p class="vazio">…</p>`;
  mestre.verificar().then((ok) => { if (vivo) (ok ? desenharMesas : desenharLogin)(); });
  return () => { vivo = false; };
}

function telaMestre(mesa) {
  if (!mestre.token) { ir("#/mestre"); return null; }
  let ocupado = false;
  let imagemPronta = null; // data URL comprimida
  let timerNotas = null;
  const rotaMesa = `/api/mesa/${encodeURIComponent(mesa)}`;

  const cardMestre = (f) => {
    const c = f.data;
    const pv = c.pv || {};
    const pct = pv.max > 0 ? Math.max(0, Math.min(100, (pv.atual / pv.max) * 100)) : 0;
    const falhadas = (Array.isArray(c.magias) ? c.magias : []).filter((m) => m && m.falhou);
    const t = c.tocha || {};
    const r = tochaRestante(t);
    const tocha = t.acesa && r > 0 ? fmtTempo(r) : "apagada";
    return `<div class="cartao card-pers">
      <div class="linha1"><a class="nome" href="#/m/${encodeURIComponent(mesa)}/p/${f.id}" style="color:inherit;text-decoration:none">${esc(c.nome || "Sem nome")}</a><span class="nivel">NV ${esc(c.nivel ?? 1)}</span></div>
      <div class="meta">${esc([c.ancestralidade, c.classe].filter(Boolean).join(" · ") || "—")}${c.jogador ? ` — <span style="font-style:normal">${esc(c.jogador)}</span>` : ""}</div>
      <div class="vitais"><span>PV ${esc(pv.atual ?? 0)}/${esc(pv.max ?? 0)}</span><span class="barra-pv"><b style="width:${pct}%"></b></span><span>CA ${esc(c.ca ?? 10)}</span></div>
      <div class="mestre-info">
        <span>Tocha: ${tocha}</span>
        <span>${falhadas.length ? `Magias bloqueadas: <b>${falhadas.map((m) => esc(m.nome || "sem nome")).join(", ")}</b>` : "Nenhuma magia bloqueada"}</span>
      </div>
      <button class="btn fantasma pequeno" data-descanso="${f.id}">Descanso longo</button>
    </div>`;
  };

  // estrutura fixa: só a lista de personagens é redesenhada ao vivo
  app.innerHTML = `
    <header class="topo">
      <a class="icone-btn" href="#/mestre" aria-label="Voltar">‹</a>
      <div class="meio"><div class="nome-mesa">Mestre · ${esc(mesa)}</div><div class="titulo-ficha">Painel</div></div>
      <div id="status">${htmlStatus()}</div>
    </header>

    <section class="cartao">
      <h2 class="secao-titulo">Recapitulação</h2>
      <p class="dica" style="margin-top:0">Só você vê. Salva sozinho.</p>
      <textarea id="notas-mestre" rows="8" placeholder="O que aconteceu na última sessão…" maxlength="100000" disabled></textarea>
      <p class="dica" id="notas-status">Carregando…</p>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Revelar imagem</h2>
      <p class="dica" style="margin-top:0">Aparece na tela de todos os jogadores por 10 segundos.</p>
      <label class="btn fantasma bloco" for="arquivo-img">Escolher imagem</label>
      <input type="file" id="arquivo-img" accept="image/*" hidden>
      <div id="previa" class="previa" hidden></div>
      <label class="campo"><span>Legenda (opcional)</span><input id="legenda-img" maxlength="140" placeholder="O que eles veem…"></label>
      <button class="btn bloco" id="enviar-img" disabled>Mostrar aos jogadores</button>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Descanso longo</h2>
      <p class="dica" style="margin-top:0">Recupera todos os PV e libera as magias que falharam.</p>
      <button class="btn bloco" data-descanso="todos">Descanso longo para todos</button>
    </section>

    <div id="lista-mestre"></div>`;

  const desenharLista = () => {
    const todas = [...sync.fichas.values()];
    $("#lista-mestre").innerHTML = !sync.carregado ? `<p class="vazio">Invocando as fichas…</p>` :
      todas.length ? todas.map(cardMestre).join("") : `<p class="vazio">Nenhum personagem nesta mesa.</p>`;
  };

  // ---- anotações ----
  const notas = $("#notas-mestre");
  const statusNotas = $("#notas-status");
  mestre.api(`${rotaMesa}/notas`, null, "GET").then((r) => {
    notas.value = r.texto || "";
    notas.disabled = false;
    statusNotas.textContent = "Salvo";
  }).catch((e) => { statusNotas.textContent = `Erro ao carregar: ${e.message}`; });
  const salvarNotas = async () => {
    clearTimeout(timerNotas); timerNotas = null;
    try {
      await mestre.api(`${rotaMesa}/notas`, { texto: notas.value }, "PUT");
      statusNotas.textContent = "Salvo";
    } catch (e) {
      statusNotas.textContent = `Não salvou (${e.message}) — tentando de novo…`;
      timerNotas = setTimeout(salvarNotas, 5000);
    }
  };
  notas.addEventListener("input", () => {
    statusNotas.textContent = "Salvando…";
    clearTimeout(timerNotas);
    timerNotas = setTimeout(salvarNotas, 800);
  });
  notas.addEventListener("blur", () => { if (timerNotas) salvarNotas(); });

  // ---- imagem ----
  $("#arquivo-img").addEventListener("change", async (e) => {
    const arq = e.target.files?.[0];
    if (!arq) return;
    try {
      imagemPronta = await comprimirImagem(arq);
      const previa = $("#previa");
      previa.innerHTML = `<img src="${imagemPronta}" alt="Prévia">`;
      previa.hidden = false;
      $("#enviar-img").disabled = false;
    } catch (err) {
      toast({ rotulo: "Imagem inválida", valor: "⚠", detalhe: err.message, tipo: "falha" });
    }
  });

  const aoClicar = async (e) => {
    if (e.target.closest("#enviar-img")) {
      if (!imagemPronta || ocupado) return;
      ocupado = true;
      try {
        const r = await mestre.api(`${rotaMesa}/imagem`, { src: imagemPronta, legenda: $("#legenda-img").value });
        toast({ rotulo: "Imagem revelada", valor: "👁", detalhe: `Enviada para ${r.enviados} tela(s) conectada(s)` });
      } catch (err) {
        toast({ rotulo: "Não enviou", valor: "⚠", detalhe: err.message, tipo: "falha" });
      } finally { ocupado = false; }
      return;
    }
    const b = e.target.closest("[data-descanso]");
    if (!b || ocupado) return;
    const alvo = b.dataset.descanso;
    const nome = alvo === "todos" ? "todos os personagens" : sync.fichas.get(alvo)?.data.nome || "este personagem";
    if (!confirm(`Dar descanso longo para ${nome}?`)) return;
    ocupado = true;
    try {
      const r = await mestre.api(`${rotaMesa}/descanso`, alvo === "todos" ? {} : { ids: [alvo] });
      toast({ rotulo: "Descanso longo", valor: "☾", detalhe: `${r.descansaram} personagem(ns) recuperado(s)` });
    } catch (err) {
      toast({ rotulo: "Falhou", valor: "⚠", detalhe: err.message, tipo: "falha" });
    } finally { ocupado = false; }
  };

  desenharLista();
  app.addEventListener("click", aoClicar);
  const relogio = setInterval(desenharLista, 15000); // atualiza o tempo das tochas
  const off = sync.ouvir((ev) => {
    if (ev.t === "estado") { const s = $("#status"); if (s) s.innerHTML = htmlStatus(); return; }
    desenharLista();
  });
  return () => {
    if (timerNotas) salvarNotas();
    off(); clearInterval(relogio); app.removeEventListener("click", aoClicar);
  };
}

/** Reduz a imagem no navegador (máx. 1280px, JPEG) para caber numa mensagem em tempo real. */
async function comprimirImagem(arquivo) {
  if (!arquivo.type.startsWith("image/")) throw new Error("O arquivo não é uma imagem");
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error("Não consegui abrir a imagem"));
      i.src = url;
    });
    for (const [lado, q] of [[1280, 0.8], [1024, 0.7], [800, 0.6], [640, 0.5]]) {
      const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.naturalWidth * escala);
      cv.height = Math.round(img.naturalHeight * escala);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const dataUrl = cv.toDataURL("image/jpeg", q);
      if (dataUrl.length < 850 * 1024) return dataUrl;
    }
    throw new Error("Imagem grande demais mesmo comprimida");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pop-up de imagem nos jogadores: some sozinho depois de N segundos. */
function mostrarImagem({ src, legenda, segundos = 10 }) {
  if (typeof src !== "string" || !src.startsWith("data:image/")) return;
  $("#revelacao")?.remove();
  const el = document.createElement("div");
  el.id = "revelacao";
  el.className = "revelacao";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Imagem do mestre");
  el.innerHTML = `<figure>
      <img alt="${esc(legenda || "Imagem enviada pelo mestre")}">
      ${legenda ? `<figcaption>${esc(legenda)}</figcaption>` : ""}
      <div class="contagem"><i style="animation-duration:${segundos}s"></i></div>
    </figure>`;
  el.querySelector("img").src = src;
  document.body.appendChild(el);
  if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  setTimeout(() => {
    el.classList.add("saindo");
    setTimeout(() => el.remove(), 600);
  }, segundos * 1000);
}

// ============================================================
// TELA: FICHA
// ============================================================
function telaFicha(mesa, id) {
  const timers = new Map(); // debounce por caminho
  const ficha = () => sync.fichas.get(id)?.data;
  const base = `#/m/${encodeURIComponent(mesa)}`;

  if (!ficha()) {
    app.innerHTML = `<header class="topo"><a class="icone-btn" href="${base}">‹</a><div class="meio"><div class="titulo-ficha">…</div></div><div id="status">${htmlStatus()}</div></header>
      <p class="vazio">${sync.carregado ? "Esta ficha não existe mais (ou foi apagada)." : "Invocando a ficha…"}</p>`;
    const off = sync.ouvir(() => { if (ficha()) { off(); desmontar = telaFicha(mesa, id); } });
    return off;
  }

  // ---------- escrita ----------
  const valorDe = (el) => {
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
  const NUM = 'type="number" inputmode="numeric" data-tipo="num"';
  // mesma disposição da ficha impressa: FOR INT / DES SAB / CON CAR
  const ORDEM_ATR = ["FOR", "INT", "DES", "SAB", "CON", "CAR"];

  function montar() {
    const meus = abasPersonagens();
    app.innerHTML = `
    <header class="topo" style="flex-wrap:wrap">
      <a class="icone-btn" href="${base}" aria-label="Voltar">‹</a>
      <div class="meio"><div class="nome-mesa">${esc(mesa)}</div><div class="titulo-ficha" id="t-nome"></div></div>
      <div id="status">${htmlStatus()}</div>
      ${meus.length > 1 ? `<nav class="abas" style="flex-basis:100%">${meus.map((x) => `<a href="${base}/p/${x.id}" class="${x.id === id ? "ativa" : ""}">${esc(x.data.nome || "Sem nome")}</a>`).join("")}</nav>` : ""}
    </header>

    <section class="cartao">
      ${campo("Nome", "nome", 'placeholder="Nome do personagem" maxlength="60"')}
      <div class="atributos">
        ${ORDEM_ATR.map((s) => {
          const nome = ATRIBUTOS.find((a) => a[0] === s)[1];
          return `<div class="atributo">
            <span class="sigla" title="${nome}">${s}</span>
            <input data-bind="atributos.${s}" ${NUM} min="1" max="20" aria-label="${nome}">
            <span class="barra">/</span>
            <span class="mod" id="mod-${s}" aria-label="Modificador de ${nome}"></span>
          </div>`;
        }).join("")}
      </div>
    </section>

    <section class="cartao">
      <label class="campo"><span>Ancestralidade</span><input data-bind="ancestralidade" list="dl-anc" maxlength="40"></label>
      <label class="campo"><span>Classe</span><input data-bind="classe" list="dl-cls" maxlength="40"></label>
      <div class="grade-nivel">
        ${campo("Nível", "nivel", `${NUM} min="0" max="10"`)}
        <label class="campo"><span>XP</span>
          <div class="xp-linha"><input data-bind="xp" ${NUM} min="0" aria-label="XP atual"><span class="barra">/</span><b id="xp-prox"></b></div>
        </label>
      </div>
      <datalist id="dl-anc">${opcoes(ANCESTRALIDADES)}</datalist>
      <datalist id="dl-cls">${opcoes(CLASSES)}</datalist>
    </section>

    <section class="cartao">
      <div class="vitais-grandes">
        <div class="vital pv">
          <span class="rotulo">PV</span>
          <div class="pv-linha">
            <input data-bind="pv.atual" ${NUM} aria-label="PV atual">
            <span class="barra">/</span>
            <input class="max" data-bind="pv.max" ${NUM} aria-label="PV máximo">
          </div>
          <div class="pv-botoes">
            <button class="icone-btn menor" data-pv="-1" aria-label="Menos 1 PV">−</button>
            <button class="icone-btn menor" data-pv="1" aria-label="Mais 1 PV">+</button>
          </div>
        </div>
        <div class="vital">
          <span class="rotulo">CA</span>
          <input data-bind="ca" ${NUM} aria-label="Classe de armadura">
        </div>
      </div>
    </section>

    <section class="cartao">
      ${campo("Título", "titulo", 'maxlength="60"')}
      <label class="campo"><span>Alinhamento</span><select data-bind="alinhamento">${opcoes(ALINHAMENTOS)}</select></label>
      ${campo("Antecedente", "antecedente", 'maxlength="60"')}
      ${campo("Divindade", "divindade", 'maxlength="60"')}
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Ataques</h2>
      <textarea data-bind="ataques" rows="4" placeholder="Espada longa +2 (1d8)" maxlength="4000"></textarea>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Talentos / Magias</h2>
      <label class="campo"><span>Talentos</span><textarea data-bind="talentos" rows="4" maxlength="10000"></textarea></label>
      <span class="rotulo">Magias</span>
      <ul class="magias" id="magias"></ul>
      <button class="btn fantasma pequeno" id="add-magia">+ magia</button>
      <p class="dica">Use a magia à vontade. Se falhar no teste, toque em <b>Falhou</b>: ela fica bloqueada até o mestre dar o descanso longo.</p>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Equip.</h2>
      <div class="moedas">
        ${campo("PO", "moedas.po", `${NUM} min="0"`)}
        ${campo("PP", "moedas.pp", `${NUM} min="0"`)}
        ${campo("PC", "moedas.pc", `${NUM} min="0"`)}
      </div>
      <p class="dica" id="equip-info"></p>
      <ol class="equip" id="equip"></ol>
      <label class="campo" style="margin-top:12px"><span>Carga livre</span><textarea data-bind="cargaLivre" rows="3" maxlength="2000"></textarea></label>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Tocha</h2>
      <div class="tocha" id="tocha">
        <div class="chama" aria-hidden="true">🔥</div>
        <div class="tempo" id="tocha-tempo"></div>
      </div>
      <div class="tocha-botoes" id="tocha-botoes"></div>
      <p class="dica">Acender gasta uma tocha do equipamento e dura 1 hora.</p>
    </section>

    <section class="cartao">
      ${campo("Jogador", "jogador", 'maxlength="40"')}
    </section>

    <div class="zona-perigo"><button class="btn sangue pequeno" id="apagar">Apagar personagem</button></div>`;

    desenharEquip();
    desenharMagias();
    sincronizarCampos(true);
    atualizarDerivados();
  }

  // ---------- equipamento: uma linha por ponto de FOR ----------
  function linhasEquip(f) {
    // mostra os espaços de FOR + itens que sobraram além da carga (se a FOR baixar)
    const eq = Array.isArray(f.equipamento) ? f.equipamento : [];
    let ultimo = -1;
    eq.forEach((x, i) => { if (typeof x === "string" && x.trim()) ultimo = i; });
    return Math.max(espacosTotais(f), ultimo + 1);
  }
  function desenharEquip() {
    const ol = $("#equip");
    if (!ol) return;
    const f = ficha();
    const n = linhasEquip(f);
    const cap = espacosTotais(f);
    ol.innerHTML = Array.from({ length: n }, (_, i) =>
      `<li class="${i >= cap ? "excesso" : ""}"><span class="n">${i + 1}.</span><input data-bind="equipamento.${i}" maxlength="80" aria-label="Espaço ${i + 1}"></li>`).join("");
    sincronizarCampos(true, ol);
  }

  // ---------- magias ----------
  function desenharMagias() {
    const ul = $("#magias");
    if (!ul) return;
    const lista = Array.isArray(ficha().magias) ? ficha().magias : [];
    ul.innerHTML = lista.map((m, i) => m && m.falhou
      ? `<li class="falhou"><span class="nome-magia">${esc(m.nome || "Magia sem nome")}</span><span class="selo-falhou" title="Bloqueada até o descanso longo">Falhou</span></li>`
      : `<li><input data-bind="magias.${i}.nome" placeholder="Nome da magia" maxlength="60">
          <button class="btn-falhou" data-falhou="${i}">Falhou</button>
          <button class="icone-btn menor perigo" data-del-magia="${i}" aria-label="Remover magia">×</button></li>`).join("") ||
      `<li class="dica">Nenhuma magia.</li>`;
    sincronizarCampos(true, ul);
  }

  // ---------- tocha ----------
  let intervaloTocha = null;
  function atualizarTocha() {
    const f = ficha();
    const box = $("#tocha");
    if (!f || !box) return;
    const t = f.tocha || {};
    const r = tochaRestante(t);
    const acesa = !!t.acesa && r > 0;
    box.classList.toggle("acesa", acesa);
    const tempo = $("#tocha-tempo");
    tempo.textContent = acesa ? fmtTempo(r) : t.acesa ? "Apagou" : r > 0 ? `${fmtTempo(r)} (pausada)` : "Apagada";
    tempo.classList.toggle("fim", acesa && r < 5 * 60 * 1000);
    const botoes = acesa
      ? `<button class="btn fantasma pequeno" data-tocha="pausar">Pausar</button><button class="btn fantasma pequeno" data-tocha="apagar">Apagar</button>`
      : `<button class="btn pequeno" data-tocha="acender">Acender tocha</button>${!t.acesa && r > 0 ? `<button class="btn fantasma pequeno" data-tocha="retomar">Retomar</button>` : ""}`;
    const bx = $("#tocha-botoes");
    if (bx.dataset.estado !== botoes) { bx.innerHTML = botoes; bx.dataset.estado = botoes; }
    clearInterval(intervaloTocha);
    if (acesa) intervaloTocha = setInterval(atualizarTocha, 1000);
  }

  function acenderTocha() {
    const f = ficha();
    const eq = Array.isArray(f.equipamento) ? f.equipamento : [];
    const i = eq.findIndex((x) => typeof x === "string" && /toch/i.test(x));
    if (i < 0) {
      toast({ rotulo: "Sem tochas", valor: "🕯", detalhe: "Não há tocha no equipamento", tipo: "falha" });
      return;
    }
    // "Tochas (3)" vira "Tochas (2)"; uma tocha sozinha libera o espaço
    const txt = eq[i];
    const m = txt.match(/\d+/);
    const novo = m && Number(m[0]) > 1 ? txt.replace(m[0], String(Number(m[0]) - 1)) : "";
    descarregar();
    sync.set(id, ["equipamento", i], novo);
    sync.set(id, ["tocha"], { acesa: true, restante: TOCHA_MS, desde: Date.now() });
    desenharEquip();
    atualizarDerivados();
    toast({ rotulo: "Tocha acesa", valor: "🔥", detalhe: novo ? `Restou: ${novo}` : `"${txt}" saiu do equipamento` });
  }

  // ---------- leitura (dados -> tela) ----------
  function sincronizarCampos(forcar = false, raiz = app) {
    const f = ficha();
    if (!f) return;
    for (const el of $$("[data-bind]", raiz)) {
      if (!forcar && timers.has(el.dataset.bind)) continue; // não atrapalha quem está digitando
      const v = getPath(f, parsePath(el.dataset.bind));
      const s = v == null || typeof v === "object" ? "" : String(v);
      if (el.value !== s) el.value = s;
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
    // XP: em Shadowdark o próximo nível exige nível × 10 XP
    const prox = $("#xp-prox");
    if (prox) prox.textContent = Math.max(1, Number(f.nivel) || 0) * 10;
    // espaços de equipamento = FOR
    const cap = espacosTotais(f);
    const ol = $("#equip");
    if (ol && ol.children.length !== linhasEquip(f) && !ol.contains(document.activeElement)) desenharEquip();
    $$("#equip > li").forEach((li, i) => li.classList.toggle("excesso", i >= cap));
    const usados = (f.equipamento || []).filter((x, i) => i < cap && typeof x === "string" && x.trim()).length;
    const info = $("#equip-info");
    if (info) info.textContent = `${usados} de ${cap} espaços ocupados (espaços = FOR)`;
    atualizarTocha();
  }

  // ---------- eventos ----------
  const aoDigitar = (e) => {
    const el = e.target.closest("[data-bind]");
    if (!el) return;
    const imediato = el.tagName === "SELECT";
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
    const alvo = e.target.closest("button");
    if (!alvo || !f) return;

    if (alvo.dataset.pv) {
      const atual = Number(f.pv?.atual) || 0;
      definir("pv.atual", atual + Number(alvo.dataset.pv));
    } else if (alvo.id === "add-magia") {
      descarregar();
      const lista = [...(Array.isArray(f.magias) ? f.magias : []), { id: uid(), nome: "", falhou: false }];
      sync.set(id, ["magias"], lista);
      desenharMagias();
      $("#magias > li:last-child input")?.focus();
    } else if (alvo.dataset.falhou) {
      const i = Number(alvo.dataset.falhou);
      const nome = f.magias?.[i]?.nome || "esta magia";
      if (confirm(`Marcar "${nome}" como falhou?\nEla fica bloqueada até o mestre dar o descanso longo.`)) {
        descarregar();
        sync.set(id, ["magias", i, "falhou"], true);
        desenharMagias();
      }
    } else if (alvo.dataset.delMagia) {
      const i = Number(alvo.dataset.delMagia);
      if (f.magias?.[i]?.nome && !confirm(`Remover a magia "${f.magias[i].nome}"?`)) return;
      descarregar();
      sync.set(id, ["magias"], f.magias.filter((_, j) => j !== i));
      desenharMagias();
    } else if (alvo.dataset.tocha) {
      const t = f.tocha || {};
      const acao = alvo.dataset.tocha;
      if (acao === "acender") {
        if (t.acesa && tochaRestante(t) > 0 && !confirm("Já há uma tocha acesa. Acender outra (gasta mais uma)?")) return;
        acenderTocha();
      } else if (acao === "pausar") {
        sync.set(id, ["tocha"], { acesa: false, restante: tochaRestante(t), desde: 0 });
      } else if (acao === "retomar") {
        sync.set(id, ["tocha"], { acesa: true, restante: tochaRestante(t), desde: Date.now() });
      } else if (acao === "apagar") {
        if (!confirm("Apagar a tocha? O tempo restante é perdido.")) return;
        sync.set(id, ["tocha"], { acesa: false, restante: 0, desde: 0 });
      }
      atualizarTocha();
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
    if (ev.t === "upsert" || ev.t === "tudo" || ev.t === "delete") atualizarAbas();
    const mexeu = (campo) => ev.t === "tudo" || (ev.t === "set" && ev.id === id && ev.path[0] === campo);
    if (mexeu("magias") && !$("#magias")?.contains(document.activeElement)) desenharMagias();
    if (mexeu("equipamento") && !$("#equip")?.contains(document.activeElement)) desenharEquip();
    sincronizarCampos();
    atualizarDerivados();
  });

  function abasPersonagens() {
    const meus = [...sync.fichas.values()].filter(ehMeu);
    if (!meus.some((x) => x.id === id) && sync.fichas.get(id)) meus.unshift(sync.fichas.get(id));
    return meus;
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
    clearInterval(intervaloTocha);
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
