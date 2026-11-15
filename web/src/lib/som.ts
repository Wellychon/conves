"use client";
// Sons de interface do Traço e Sombra, portados de identidade/sons.js.
// Tudo sintetizado com Web Audio (0 KB de áudio). Nunca toca no hover; sempre com chave de silêncio.

const CHAVE = "conves.som";
let ctx: AudioContext | null = null;
let saida: GainNode | null = null;
let ligado = true;
let iniciado = false;
const ultimo: Record<string, number> = {};

type Tom = { tipo?: OscillatorType; de: number; ate?: number; dur: number; ganho: number; atraso?: number };

function tom(c: BaseAudioContext, destino: AudioNode, t: number, o: Tom) {
  const ini = t + (o.atraso ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.tipo ?? "sine";
  osc.frequency.setValueAtTime(o.de, ini);
  if (o.ate) osc.frequency.exponentialRampToValueAtTime(o.ate, ini + o.dur);
  g.gain.setValueAtTime(0.0001, ini);
  g.gain.exponentialRampToValueAtTime(o.ganho, ini + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, ini + o.dur);
  osc.connect(g);
  g.connect(destino);
  osc.start(ini);
  osc.stop(ini + o.dur + 0.02);
}

function ruido(c: BaseAudioContext, destino: AudioNode, t: number, dur: number, pico: number, freq: number, q = 1) {
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const fonte = c.createBufferSource();
  fonte.buffer = buf;
  const filtro = c.createBiquadFilter();
  filtro.type = "bandpass";
  filtro.frequency.value = freq;
  filtro.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(pico, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  fonte.connect(filtro);
  filtro.connect(g);
  g.connect(destino);
  fonte.start(t);
  fonte.stop(t + dur + 0.01);
}

type Receita = (c: BaseAudioContext, d: AudioNode, t: number, v: number) => void;
const receitas: Record<string, Receita> = {
  clique(c, d, t, v) {
    tom(c, d, t, { de: 190 * v, ate: 62 * v, dur: 0.09, ganho: 0.9 });
    ruido(c, d, t, 0.025, 0.35, 1800, 0.8);
  },
  solta(c, d, t, v) {
    tom(c, d, t, { tipo: "triangle", de: 1250 * v, ate: 820 * v, dur: 0.05, ganho: 0.6 });
    ruido(c, d, t, 0.012, 0.4, 4200, 1.2);
  },
  seleciona(c, d, t, v) {
    tom(c, d, t, { tipo: "square", de: 523 * v, dur: 0.07, ganho: 0.24 });
    tom(c, d, t, { tipo: "square", de: 784 * v, dur: 0.09, ganho: 0.24, atraso: 0.065 });
  },
  liga(c, d, t, v) {
    tom(c, d, t, { tipo: "triangle", de: 440 * v, ate: 660 * v, dur: 0.11, ganho: 0.34 });
    tom(c, d, t, { tipo: "triangle", de: 660 * v, ate: 990 * v, dur: 0.1, ganho: 0.25, atraso: 0.07 });
  },
  desliga(c, d, t, v) {
    tom(c, d, t, { tipo: "triangle", de: 660 * v, ate: 440 * v, dur: 0.11, ganho: 0.34 });
    tom(c, d, t, { tipo: "triangle", de: 440 * v, ate: 294 * v, dur: 0.12, ganho: 0.25, atraso: 0.07 });
  },
  erro(c, d, t, v) {
    tom(c, d, t, { tipo: "sawtooth", de: 120 * v, ate: 96 * v, dur: 0.11, ganho: 0.4 });
    tom(c, d, t, { tipo: "sawtooth", de: 112 * v, ate: 88 * v, dur: 0.12, ganho: 0.4, atraso: 0.12 });
  },
};

function contexto() {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const mestre = ctx.createGain();
  mestre.gain.value = 0.55;
  const suave = ctx.createBiquadFilter();
  suave.type = "lowpass";
  suave.frequency.value = 7000;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -8; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
  mestre.connect(suave); suave.connect(lim); lim.connect(ctx.destination);
  saida = mestre;
  return ctx;
}

export function tocar(nome: keyof typeof receitas) {
  if (!ligado || !receitas[nome]) return;
  const agora = Date.now();
  if (agora - (ultimo[nome] ?? 0) < 22) return;
  ultimo[nome] = agora;
  try {
    const c = contexto();
    if (!c || !saida) return;
    if (c.state === "suspended") void c.resume();
    receitas[nome](c, saida, c.currentTime + 0.005, 1 + (Math.random() - 0.5) * 0.05);
  } catch { /* som nunca pode quebrar a interface */ }
}

export const somLigado = () => ligado;

export function definirSom(v: boolean) {
  ligado = v;
  try { localStorage.setItem(CHAVE, v ? "on" : "off"); } catch { /* sem storage */ }
  document.dispatchEvent(new CustomEvent("som:mudou", { detail: { ligado } }));
}

/** Liga o aperto/soltura dos botões .btn (uma vez por página). */
export function iniciarSom() {
  if (iniciado || typeof document === "undefined") return;
  iniciado = true;
  try { ligado = localStorage.getItem(CHAVE) !== "off"; } catch { /* segue ligado */ }
  let premido: Element | null = null;
  const botao = (e: Event) => (e.target as Element | null)?.closest?.(".btn") ?? null;
  const inativo = (b: Element) => b.getAttribute("aria-disabled") === "true" || (b as HTMLButtonElement).disabled;
  const soltar = () => { premido?.removeAttribute("data-premido"); premido = null; };

  document.addEventListener("pointerdown", (e) => {
    if ((e as PointerEvent).button > 0) return;
    const b = botao(e);
    if (!b || inativo(b)) return;
    b.setAttribute("data-premido", "");
    premido = b;
    if (!b.hasAttribute("data-som-puro")) tocar("clique");
  }, true);
  document.addEventListener("pointerup", soltar, true);
  document.addEventListener("pointercancel", soltar, true);
  document.addEventListener("pointerout", (e) => {
    if (premido && !premido.contains((e as PointerEvent).relatedTarget as Node | null)) soltar();
  }, true);
  document.addEventListener("keydown", (e) => {
    if ((e.key !== " " && e.key !== "Enter") || e.repeat) return;
    const b = botao(e);
    if (!b || inativo(b) || (b as HTMLElement).tagName !== "BUTTON") return;
    b.setAttribute("data-premido", "");
    if (!b.hasAttribute("data-som-puro")) tocar("clique");
  }, true);
  document.addEventListener("keyup", (e) => botao(e)?.removeAttribute("data-premido"), true);
  document.addEventListener("click", (e) => {
    const b = botao(e);
    if (!b) return;
    if (inativo(b)) { e.preventDefault(); e.stopPropagation(); tocar("erro"); return; }
    const nome = b.getAttribute("data-som");
    if (nome === "nenhum") return;
    setTimeout(() => {
      let n = nome;
      if (!n) {
        if (b.hasAttribute("aria-pressed")) {
          n = b.closest("[data-unico]") ? "seleciona" : b.getAttribute("aria-pressed") === "true" ? "liga" : "desliga";
        } else n = "solta";
      }
      tocar(n as keyof typeof receitas);
    }, 0);
  }, true);
}
