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

const SLOTS = 20; // linhas de equipamento da ficha

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
    moedas: { po: 0, pp: 0, pc: 0 },
    equipamento: Array(SLOTS).fill(""),
    cargaLivre: "",
  };
}

const espacosTotais = (f) => Math.max(Number(f.atributos?.FOR) || 0, 10);

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
      <textarea data-bind="talentos" rows="6" maxlength="10000"></textarea>
    </section>

    <section class="cartao">
      <h2 class="secao-titulo">Equip.</h2>
      <div class="moedas">
        ${campo("PO", "moedas.po", `${NUM} min="0"`)}
        ${campo("PP", "moedas.pp", `${NUM} min="0"`)}
        ${campo("PC", "moedas.pc", `${NUM} min="0"`)}
      </div>
      <ol class="equip" id="equip">
        ${Array.from({ length: SLOTS }, (_, i) => `<li><span class="n">${i + 1}.</span><input data-bind="equipamento.${i}" maxlength="80" aria-label="Espaço ${i + 1}"></li>`).join("")}
      </ol>
      <p class="dica" id="equip-info"></p>
      <label class="campo"><span>Carga livre</span><textarea data-bind="cargaLivre" rows="3" maxlength="2000"></textarea></label>
    </section>

    <section class="cartao">
      ${campo("Jogador", "jogador", 'maxlength="40"')}
    </section>

    <div class="zona-perigo"><button class="btn sangue pequeno" id="apagar">Apagar personagem</button></div>`;

    sincronizarCampos(true);
    atualizarDerivados();
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
    // espaços de equipamento: FOR ou 10, o que for maior
    const cap = espacosTotais(f);
    $$("#equip > li").forEach((li, i) => li.classList.toggle("alem", i >= cap));
    const info = $("#equip-info");
    if (info) info.textContent = `Espaços disponíveis: ${cap} (FOR ou 10, o que for maior)`;
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
