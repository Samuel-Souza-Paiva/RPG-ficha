// ============================================================
// ARTE — ilustrações originais em nanquim, geradas em SVG.
// Massas de tentáculos com olhos e dentes, hachura densa,
// um orbe negro com coroa de traços, um espadachim solitário.
// Tudo animado de leve ("tinta fervendo"), só preto e branco.
// ============================================================

const P = "#f1eee6"; // papel
const N = "#000";    // nanquim

// gerador pseudoaleatório com semente: o desenho é sempre o mesmo
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f1 = (n) => n.toFixed(1);

/** Um tentáculo: corpo negro com contorno branco, hachura e ventosas. */
function tentaculo(r, x0, y0, ang, comp, larg, curva) {
  const pts = [];
  const passos = 14;
  let x = x0, y = y0, a = ang;
  for (let i = 0; i <= passos; i++) {
    pts.push([x, y, a]);
    a += curva * (0.6 + r() * 0.8) + Math.sin(i * 0.9) * curva * 0.5;
    x += Math.cos(a) * (comp / passos);
    y += Math.sin(a) * (comp / passos);
  }
  const lado = (s) => pts.map(([px, py, pa], i) => {
    const w = larg * (1 - i / passos) * (0.85 + 0.15 * Math.sin(i * 2.1));
    return [px + Math.cos(pa + Math.PI / 2) * w * s, py + Math.sin(pa + Math.PI / 2) * w * s];
  });
  const e = lado(1), d = lado(-1).reverse();
  const corpo = `M${e.map((p) => p.map(f1).join(" ")).join(" L")} L${d.map((p) => p.map(f1).join(" ")).join(" L")} Z`;
  // hachura: traços transversais ao longo do corpo
  let hach = "";
  pts.forEach(([px, py, pa], i) => {
    if (i === 0 || i === passos) return;
    const w = larg * (1 - i / passos) * 0.8;
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * 2.2;
      const cx = px + Math.cos(pa) * off, cy = py + Math.sin(pa) * off;
      const nx = Math.cos(pa + Math.PI / 2 + 0.35) * w, ny = Math.sin(pa + Math.PI / 2 + 0.35) * w;
      hach += `M${f1(cx - nx * 0.2)} ${f1(cy - ny * 0.2)} L${f1(cx + nx)} ${f1(cy + ny)} `;
    }
  });
  // ventosas num dos lados
  let vent = "";
  pts.forEach(([px, py, pa], i) => {
    if (i % 2 || i < 2 || i > passos - 2) return;
    const w = larg * (1 - i / passos);
    const vx = px + Math.cos(pa - Math.PI / 2) * w * 0.55, vy = py + Math.sin(pa - Math.PI / 2) * w * 0.55;
    vent += `<circle cx="${f1(vx)}" cy="${f1(vy)}" r="${f1(Math.max(0.8, w * 0.22))}" fill="none" stroke="${P}" stroke-width="0.7"/>`;
  });
  return `<path d="${corpo}" fill="${N}" stroke="${P}" stroke-width="1.3"/>
    <path d="${hach}" stroke="${P}" stroke-width="0.45" opacity="0.75"/>${vent}`;
}

/** Olho arregalado com íris hachurada; pisca de vez em quando. */
function olho(r, x, y, tam) {
  const atraso = (r() * 8).toFixed(2);
  const dur = (5 + r() * 6).toFixed(2);
  let raios = "";
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    raios += `M${f1(x + Math.cos(a) * tam * 0.18)} ${f1(y + Math.sin(a) * tam * 0.18)} L${f1(x + Math.cos(a) * tam * 0.42)} ${f1(y + Math.sin(a) * tam * 0.42)} `;
  }
  return `<g class="olho" style="transform-origin:${f1(x)}px ${f1(y)}px;animation-delay:${atraso}s;animation-duration:${dur}s">
    <ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(tam)}" ry="${f1(tam * 0.62)}" fill="${P}" stroke="${N}" stroke-width="1.5"/>
    <circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(tam * 0.44)}" fill="${N}"/>
    <path d="${raios}" stroke="${P}" stroke-width="0.5"/>
    <circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(tam * 0.16)}" fill="${N}" stroke="${P}" stroke-width="0.4"/>
    <circle cx="${f1(x - tam * 0.18)}" cy="${f1(y - tam * 0.18)}" r="${f1(tam * 0.1)}" fill="${P}"/>
  </g>`;
}

/** Bocarra com fileiras de dentes. */
function boca(r, x, y, larg, alt) {
  let dentes = "";
  const n = Math.max(5, Math.round(larg / 5));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const bx = x - larg / 2 + t * larg;
    const curvaSup = y - alt * 0.5 * Math.sin(t * Math.PI);
    const curvaInf = y + alt * 0.5 * Math.sin(t * Math.PI);
    const w = larg / n * 0.45;
    dentes += `M${f1(bx - w)} ${f1(curvaSup)} L${f1(bx)} ${f1(curvaSup + alt * (0.35 + r() * 0.3))} L${f1(bx + w)} ${f1(curvaSup)} Z `;
    dentes += `M${f1(bx - w)} ${f1(curvaInf)} L${f1(bx)} ${f1(curvaInf - alt * (0.3 + r() * 0.3))} L${f1(bx + w)} ${f1(curvaInf)} Z `;
  }
  return `<g class="boca" style="transform-origin:${f1(x)}px ${f1(y)}px">
    <ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(larg / 2)}" ry="${f1(alt / 2)}" fill="${N}" stroke="${P}" stroke-width="1.6"/>
    <path d="${dentes}" fill="${P}" stroke="${N}" stroke-width="0.4"/>
  </g>`;
}

/** Massa de horror: tentáculos + olhos + bocas brotando de um ponto. */
function massa(r, cx, cy, raio, angBase, abertura, qtd) {
  let s = "";
  for (let i = 0; i < qtd; i++) {
    const a = angBase + (r() - 0.5) * abertura;
    s += tentaculo(r, cx + (r() - 0.5) * raio * 0.4, cy + (r() - 0.5) * raio * 0.4, a, raio * (0.7 + r() * 0.8), 6 + r() * 9, (r() - 0.5) * 0.5);
  }
  for (let i = 0; i < Math.round(qtd / 2.5); i++) {
    const a = angBase + (r() - 0.5) * abertura * 0.8, d = r() * raio * 0.8;
    s += olho(r, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 4 + r() * 7);
  }
  if (qtd > 6) {
    const a = angBase + (r() - 0.5) * 0.6, d = raio * 0.45;
    s += boca(r, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 26 + r() * 14, 12 + r() * 6);
  }
  return s;
}

const FILTROS = `
  <filter id="ferver" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="3" result="ruido">
      <animate attributeName="baseFrequency" values="0.020;0.027;0.020" dur="9s" repeatCount="indefinite"/>
    </feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="ruido" scale="7"/>
  </filter>
  <filter id="vento" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="turbulence" baseFrequency="0.03 0.09" numOctaves="2" seed="8" result="ruido">
      <animate attributeName="seed" values="1;2;3;4;5;6;7;8" dur="1.6s" repeatCount="indefinite"/>
    </feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="ruido" scale="5"/>
  </filter>`;

/** Ilustração da capa (tela de entrada). */
export function arteCapa() {
  const r = rng(1997);
  const W = 400, H = 300, ox = 200, oy = 92;
  // coroa de traços em volta do orbe
  let coroa = "";
  for (let i = 0; i < 220; i++) {
    const a = r() * Math.PI * 2;
    const r0 = 40 + r() * 6, r1 = r0 + 18 + r() * 70;
    coroa += `M${f1(ox + Math.cos(a) * r0)} ${f1(oy + Math.sin(a) * r0)} L${f1(ox + Math.cos(a) * r1)} ${f1(oy + Math.sin(a) * r1)} `;
  }
  // corvos
  let corvos = "";
  for (let i = 0; i < 6; i++) {
    const y = 30 + r() * 90, esc = 0.6 + r() * 0.7, dur = 14 + r() * 12, atraso = -r() * dur;
    corvos += `<g class="corvo" style="animation-duration:${f1(dur)}s;animation-delay:${f1(atraso)}s"><path transform="translate(0 ${f1(y)}) scale(${f1(esc)})" d="M0 0 q6 -7 12 -1 q3 -2 5 0 q2 -2 5 0 q6 -6 12 1 q-7 -2 -11 3 q-3 3 -6 0 q-4 -5 -11 -3z" fill="${N}" stroke="${P}" stroke-width="0.6"/></g>`;
  }
  // chão rochoso
  let contorno = "M0 250";
  for (let x = 0; x <= W; x += 10) contorno += ` L${x} ${f1(238 + Math.sin(x * 0.05) * 6 + r() * 10 + (Math.abs(x - ox) < 50 ? -14 : 0))}`;
  const chao = `${contorno} L${W} ${H + 20} L0 ${H + 20} Z`;
  let hachChao = "";
  for (let i = 0; i < 90; i++) {
    const x = r() * W, y = 252 + r() * 45;
    hachChao += `M${f1(x)} ${f1(y)} l${f1(4 + r() * 8)} ${f1(-2 - r() * 3)} `;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>${FILTROS}
      <radialGradient id="halo"><stop offset="0.45" stop-color="${P}" stop-opacity="0.9"/><stop offset="1" stop-color="${P}" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="${ox}" cy="${oy}" r="70" fill="url(#halo)" opacity="0.35"/>
    <g class="coroa" style="transform-origin:${ox}px ${oy}px"><path d="${coroa}" stroke="${P}" stroke-width="0.6" opacity="0.8"/></g>
    <circle cx="${ox}" cy="${oy}" r="38" fill="${N}" stroke="${P}" stroke-width="2.5"/>
    <circle cx="${ox}" cy="${oy}" r="43" fill="none" stroke="${P}" stroke-width="0.6" stroke-dasharray="1 3"/>
    ${corvos}
    <g filter="url(#ferver)">
      ${massa(r, -10, 140, 150, -0.15, 1.6, 11)}
      ${massa(r, 410, 150, 150, Math.PI + 0.15, 1.6, 11)}
      ${massa(r, 40, 290, 110, -0.9, 1.0, 7)}
      ${massa(r, 360, 295, 110, Math.PI + 0.9, 1.0, 7)}
    </g>
    <path d="${chao}" fill="${N}"/><path d="${contorno}" fill="none" stroke="${P}" stroke-width="1.4"/>
    <path d="${hachChao}" stroke="${P}" stroke-width="0.5" opacity="0.5"/>
    ${espadachim(ox, 232)}
  </svg>`;
}

/** Guerreiro solitário de costas, capa rasgada ao vento e espada enorme. Desenho original. */
function espadachim(x, y) {
  return `<g transform="translate(${x} ${y})">
    <g filter="url(#vento)">
      <path d="M-9 -44 C-20 -30 -26 -10 -34 4 L-30 2 L-28 9 L-22 4 L-19 11 L-14 5 L-9 12 L-5 6 L0 13 L4 6 L9 11 L13 4 L18 9 L22 2 L27 6 L24 -8 C20 -26 14 -36 9 -44 Z" fill="${N}" stroke="${P}" stroke-width="1.2"/>
      <path d="M-20 -20 L-26 2 M-12 -30 L-16 6 M-3 -36 L-4 8 M6 -34 L8 6 M14 -24 L19 3" stroke="${P}" stroke-width="0.5" opacity="0.7"/>
    </g>
    <path d="M-6 -46 Q0 -50 6 -46 L9 -42 L-9 -42 Z" fill="${N}" stroke="${P}" stroke-width="1"/>
    <circle cx="0" cy="-52" r="6" fill="${N}" stroke="${P}" stroke-width="1.1"/>
    <path d="M-5 -55 L-8 -60 M4 -56 L7 -61 M0 -58 L1 -63" stroke="${P}" stroke-width="0.8"/>
    <path d="M10 -40 L60 -112 L66 -108 L16 -36 Z" fill="${N}" stroke="${P}" stroke-width="1.3"/>
    <path d="M14 -42 L62 -109" stroke="${P}" stroke-width="0.5"/>
    <path d="M4 -34 L20 -46 M8 -30 L12 -38" stroke="${P}" stroke-width="2"/>
  </g>`;
}

/** Bordas da tela com massas de horror em baixa opacidade (fundo fixo de todas as telas). */
export function arteFundo() {
  const r = rng(666);
  return `<svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>${FILTROS}</defs>
    <g filter="url(#ferver)">
      ${massa(r, -30, 120, 120, 0.2, 1.4, 7)}
      ${massa(r, 430, 300, 130, Math.PI - 0.2, 1.4, 7)}
      ${massa(r, -30, 560, 130, 0.1, 1.4, 7)}
      ${massa(r, 430, 760, 130, Math.PI + 0.3, 1.4, 7)}
    </g>
  </svg>`;
}

/** Cinzas caindo (camada leve, só CSS). */
export function cinzas(qtd = 26) {
  const r = rng(42);
  let s = "";
  for (let i = 0; i < qtd; i++) {
    const tam = 1 + r() * 2.5, dur = 9 + r() * 14, atraso = -r() * dur, x = r() * 100, deriva = (r() - 0.5) * 80;
    s += `<i style="left:${f1(x)}%;width:${f1(tam)}px;height:${f1(tam)}px;animation-duration:${f1(dur)}s;animation-delay:${f1(atraso)}s;--deriva:${f1(deriva)}px"></i>`;
  }
  return s;
}
