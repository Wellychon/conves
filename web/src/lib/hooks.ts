"use client";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { supabase } from "./supabase";
import { tempo } from "./types";

/* ==========================================================================
   Tempo real barato
   - Um canal do Realtime por TABELA na página, compartilhado por todos os hooks.
   - A mudança (INSERT/UPDATE/DELETE) é aplicada direto no estado. Só vai ao banco
     quando o payload não basta (select com join, coluna que o canal não manda,
     filtro que só o banco sabe avaliar) e, mesmo assim, busca só as linhas que mudaram.
   - Recarga inteira fica para: janela com limite que precisa ser completada,
     reconexão do canal e mudança de parâmetros (`chave`).
   ========================================================================== */

type Linha = Record<string, unknown>;
type Timer = ReturnType<typeof setTimeout>;
type ErroPg = { code?: string; message?: string } | null;

/** Mudança vinda do Realtime, já normalizada. */
export type Mudanca = {
  tipo: "INSERT" | "UPDATE" | "DELETE";
  novo: Linha;
  velho: Linha;
  /** o canal desta tabela recebe só algumas colunas (ver COLUNAS_CANAL) */
  restrito: boolean;
  /** o Realtime cortou campos (payload grande demais) */
  cortado: boolean;
};

type Ouvinte = { mudou: (m: Mudanca) => void; reconectou: () => void };

// chave primária de cada tabela (o DELETE do Realtime traz só ela)
const CHAVES: Record<string, string[]> = { presence: ["member_id"], links: ["src", "dst_title"] };
const chavesDe = (t: string) => CHAVES[t] ?? ["id"];

// colunas que o canal recebe. notes vem sem o body: as listas não usam e o editor busca só a nota aberta.
const COLUNAS_CANAL: Record<string, string[]> = {
  notes: ["id", "path", "title", "tipo", "owner", "in_graph", "version", "updated_by", "created_at", "updated_at", "deleted_at"],
};

// tabelas que ainda não existem no banco (migração pendente): não abrimos canal para elas
const ausentes = new Set<string>();
export const tabelaAusente = (e: ErroPg) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" ||
    /relation "[^"]+" does not exist|could not find the table/i.test(e.message ?? ""));

// ---------- canais compartilhados ----------
type Canal = { ch: RealtimeChannel; ouvintes: Set<Ouvinte>; select: string[] | null; entrou: boolean; erro: boolean; fim: Timer | null };
const canais = new Map<string, Canal>();
let seqCanal = 0;

function abrirCanal(tabela: string, comSelect = true): Canal {
  const select = comSelect ? COLUNAS_CANAL[tabela] ?? null : null;
  const c: Canal = { ch: null as unknown as RealtimeChannel, ouvintes: new Set(), select, entrou: false, erro: false, fim: null };
  canais.set(tabela, c);
  // nome único: um canal com o mesmo tópico ainda fechando seria devolvido pelo supabase.channel()
  c.ch = supabase
    .channel(`rt:${tabela}:${++seqCanal}`)
    .on("postgres_changes", { event: "*", schema: "public", table: tabela, ...(select ? { select } : {}) }, (p: RealtimePostgresChangesPayload<Linha>) => {
      const erros = (p as { errors?: unknown }).errors;
      const m: Mudanca = {
        tipo: p.eventType,
        novo: (p.new ?? {}) as Linha,
        velho: (p.old ?? {}) as Linha,
        restrito: !!c.select,
        cortado: Array.isArray(erros) ? erros.length > 0 : !!erros,
      };
      c.ouvintes.forEach((o) => { try { o.mudou(m); } catch { /* um ouvinte com defeito não derruba os outros */ } });
    })
    .subscribe((status) => {
      if (canais.get(tabela) !== c) return;
      if (status === "SUBSCRIBED") {
        // voltou depois de queda (sono do notebook, rede): o que mudou no meio se perdeu
        if (c.entrou || c.erro) c.ouvintes.forEach((o) => o.reconectou());
        c.entrou = true;
        c.erro = false;
      } else if (status === "CHANNEL_ERROR") {
        c.erro = true;
        if (c.select && !c.entrou) {
          // servidor sem suporte a colunas no postgres_changes: reabre recebendo a linha inteira
          const novo = abrirCanal(tabela, false);
          c.ouvintes.forEach((o) => novo.ouvintes.add(o));
          void supabase.removeChannel(c.ch);
        }
      }
    });
  return c;
}

function ouvir(tabela: string, o: Ouvinte): () => void {
  const c = canais.get(tabela) ?? abrirCanal(tabela);
  if (c.fim) { clearTimeout(c.fim); c.fim = null; }
  c.ouvintes.add(o);
  return () => {
    const atual = canais.get(tabela);
    if (!atual) return;
    atual.ouvintes.delete(o);
    if (atual.ouvintes.size) return;
    const fechar = () => {
      if (canais.get(tabela) !== atual || atual.ouvintes.size) return;
      canais.delete(tabela);
      void supabase.removeChannel(atual.ch);
    };
    // pequena folga: trocar de página (ou o StrictMode) não derruba e reabre o mesmo canal
    if (atual.erro || ausentes.has(tabela)) fechar(); else atual.fim = setTimeout(fechar, 4000);
  };
}

/** Recebe as mudanças de uma tabela pelo canal compartilhado (para quem não usa useTable). */
export function useMudancas(tabela: string, aoMudar: (m: Mudanca) => void, o: { aoReconectar?: () => void; ativo?: boolean } = {}) {
  const ref = useRef({ aoMudar, aoReconectar: o.aoReconectar });
  ref.current = { aoMudar, aoReconectar: o.aoReconectar };
  const ativo = o.ativo ?? true;
  useEffect(() => {
    if (!ativo) return;
    return ouvir(tabela, { mudou: (m) => ref.current.aoMudar(m), reconectou: () => ref.current.aoReconectar?.() });
  }, [tabela, ativo]);
}

// ---------- filtro: grava as chamadas do construtor para avaliar aqui também ----------
type Chamada = { op: string; args: unknown[] };
type Teste = (r: Linha) => boolean;

function gravarFiltro(f: (q: any) => any): Chamada[] | null {
  const chamadas: Chamada[] = [];
  const q: any = new Proxy({}, {
    get(_alvo, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      return (...args: unknown[]) => { chamadas.push({ op: prop, args }); return q; };
    },
  });
  try { f(q); } catch { return null; }
  return chamadas;
}

const nulo = (v: unknown) => v === null || v === undefined;
const igual = (a: unknown, b: unknown) => !nulo(a) && !nulo(b) && String(a) === String(b);
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Ordem do Postgres: nulos no fim (ascendente); horários comparados como horário. */
function comparar(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (nulo(a) || nulo(b)) return nulo(a) && nulo(b) ? 0 : nulo(a) ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const sa = String(a), sb = String(b);
  if (ISO.test(sa) && ISO.test(sb)) {
    const ta = tempo(sa), tb = tempo(sb);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
  }
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function likeRe(padrao: string, flags: string) {
  const corpo = [...padrao].map((ch) => (ch === "%" || ch === "*" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp(`^${corpo}$`, `${flags}s`);
}

function valorIs(v: unknown) {
  if (v === null || v === "null") return null;
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return undefined; // não sei avaliar
}

/** Teste de uma operação do PostgREST; null = operação que só o banco avalia. */
function teste(op: string, col: string, v: unknown): Teste | null {
  switch (op) {
    case "eq": return (r) => igual(r[col], v);
    case "neq": return (r) => !nulo(r[col]) && !igual(r[col], v);
    case "gt": return (r) => !nulo(r[col]) && comparar(r[col], v) > 0;
    case "gte": return (r) => !nulo(r[col]) && comparar(r[col], v) >= 0;
    case "lt": return (r) => !nulo(r[col]) && comparar(r[col], v) < 0;
    case "lte": return (r) => !nulo(r[col]) && comparar(r[col], v) <= 0;
    case "like":
    case "ilike": {
      if (typeof v !== "string") return null;
      const re = likeRe(v, op === "ilike" ? "i" : "");
      return (r) => !nulo(r[col]) && re.test(String(r[col]));
    }
    case "is": {
      const alvo = valorIs(v);
      if (alvo === undefined) return null;
      return alvo === null ? (r) => nulo(r[col]) : (r) => r[col] === alvo;
    }
    case "in": {
      const lista = Array.isArray(v) ? v.map(String)
        : typeof v === "string" && /^\(.*\)$/.test(v) ? v.slice(1, -1).split(",").map((s) => s.trim().replace(/^"|"$/g, "")) : null;
      if (!lista) return null;
      return (r) => !nulo(r[col]) && lista.includes(String(r[col]));
    }
    default: return null;
  }
}

function compilarFiltro(chamadas: Chamada[]): { teste: Teste; colunas: string[] } | null {
  const testes: Teste[] = [];
  const colunas: string[] = [];
  for (const { op, args } of chamadas) {
    if (op === "match" && args[0] && typeof args[0] === "object") {
      for (const [c, v] of Object.entries(args[0] as Record<string, unknown>)) { testes.push((r) => igual(r[c], v)); colunas.push(c); }
      continue;
    }
    const col = args[0];
    if (typeof col !== "string") return null;
    let t: Teste | null;
    if (op === "not") {
      const base = teste(String(args[1]), col, args[2]);
      if (!base) return null;
      // NOT (col op v): com col nulo o SQL dá nulo (não passa), menos no "is"
      t = args[1] === "is" ? (r) => !base(r) : (r) => !nulo(r[col]) && !base(r);
    } else t = teste(op, col, args[1]);
    if (!t) return null;
    testes.push(t);
    colunas.push(col);
  }
  return { teste: (r) => testes.every((t) => t(r)), colunas };
}

// ---------- plano: o que dá para fazer só com o payload ----------
type Opts = {
  select?: string;
  order?: { column: string; ascending?: boolean };
  filter?: (q: any) => any;
  limit?: number;
  /** Mude este valor para recarregar com novos parâmetros (ex.: filtro por pessoa). */
  chave?: string | number | null;
};

type Plano = {
  pk: string[];
  todas: boolean; // select "*"
  colunas: string[]; // projeção quando não é "*"
  complexo: boolean; // join, alias ou cast: o payload não reproduz a linha
  filtro: Teste | null;
  filtroOk: boolean; // false = filtro com operação que só o banco avalia
  colsFiltro: string[];
  ordem?: { coluna: string; asc: boolean };
  limite?: number;
  semChaveLocal: boolean; // a projeção não guarda a chave primária ou a coluna da ordem
};

function montarPlano(tabela: string, o: Opts): Plano {
  const pk = chavesDe(tabela);
  const sel = (o.select ?? "*").replace(/\s+/g, "");
  const todas = sel === "*";
  const partes = todas ? [] : sel.split(",");
  const complexo = !todas && !partes.every((p) => /^[a-z_][a-z0-9_]*$/i.test(p));
  const colunas = complexo ? [] : partes;
  const chamadas = o.filter ? gravarFiltro(o.filter) : [];
  const compilado = chamadas && chamadas.length ? compilarFiltro(chamadas) : null;
  const filtroOk = !!chamadas && (!chamadas.length || !!compilado);
  const ordem = o.order ? { coluna: o.order.column, asc: o.order.ascending ?? true } : undefined;
  const guarda = (c: string) => todas || colunas.includes(c);
  return {
    pk, todas, colunas, complexo, filtro: compilado?.teste ?? null, filtroOk, colsFiltro: compilado?.colunas ?? [],
    ordem, limite: o.limit, semChaveLocal: !complexo && (!pk.every(guarda) || (!!ordem && !guarda(ordem.coluna))),
  };
}

const chaveDaLinha = (r: Linha, pk: string[]) => (pk.every((c) => !nulo(r[c])) ? pk.map((c) => String(r[c])).join("\u0001") : null);

function projetar(r: Linha, p: Plano): Linha {
  if (p.todas || p.complexo) return r;
  const o: Linha = {};
  for (const c of p.colunas) if (c in r) o[c] = r[c];
  return o;
}

function ordenar(lista: Linha[], o: { coluna: string; asc: boolean }) {
  return [...lista].sort((a, b) => (o.asc ? 1 : -1) * comparar(a[o.coluna], b[o.coluna]));
}

/** upsert = linha que existe e passa no filtro; remover = sai da lista (se estiver nela). */
type Op = { tipo: "upsert"; linha: Linha; completa: boolean } | { tipo: "remover"; chave: string };

function aplicarUm(rows: Linha[], op: Op, p: Plano): { rows: Linha[]; recarregar: boolean } {
  const cheia = !!p.limite && rows.length >= p.limite;
  const k = op.tipo === "remover" ? op.chave : chaveDaLinha(op.linha, p.pk);
  if (k === null) return { rows, recarregar: true };
  const i = rows.findIndex((r) => chaveDaLinha(r, p.pk) === k);
  if (op.tipo === "remover") {
    if (i < 0) return { rows, recarregar: false };
    // com limite e a janela cheia, outra linha deveria entrar no lugar: só o banco sabe qual
    return { rows: rows.filter((_, j) => j !== i), recarregar: cheia };
  }
  const nova = projetar(i >= 0 && !op.completa ? { ...rows[i], ...op.linha } : op.linha, p);
  let lista = i >= 0 ? rows.map((r, j) => (j === i ? nova : r)) : [...rows, nova];
  if (p.ordem) lista = ordenar(lista, p.ordem);
  if (p.limite && lista.length > p.limite) {
    const saiu = lista.indexOf(nova) >= p.limite;
    lista = lista.slice(0, p.limite);
    if (saiu && i >= 0) return { rows: lista, recarregar: true };
  }
  return { rows: lista, recarregar: false };
}

function aplicarOps(rows: Linha[], ops: Op[], p: Plano) {
  let lista = rows;
  let recarregar = false;
  for (const op of ops) {
    const r = aplicarUm(lista, op, p);
    lista = r.rows;
    recarregar ||= r.recarregar;
  }
  return { rows: lista, recarregar };
}

/** Espelho local de uma consulta: carrega, aplica as mudanças e sabe quando precisa ir ao banco. */
class Espelho {
  linhas: Linha[] = [];
  gen = 0; // muda quando a consulta muda ou o componente sai: respostas antigas são descartadas
  private seq = 0;
  private emCurso = false;
  private durante: Op[] = []; // mudanças que chegaram durante a recarga (reaplicadas por cima do retrato)
  private fila: Op[] = [];
  private buscar = new Set<string>();
  private tFila: Timer | null = null;
  private tRecarga: Timer | null = null;
  private tBusca: Timer | null = null;

  constructor(
    public tabela: string,
    private opts: () => Opts,
    private publicar: (r: Linha[]) => void,
    private aoResultado: (erro: ErroPg) => void,
  ) {}

  parar() {
    this.gen++;
    this.fila = []; this.buscar.clear(); this.durante = []; this.emCurso = false;
    for (const t of [this.tFila, this.tRecarga, this.tBusca]) if (t) clearTimeout(t);
    this.tFila = this.tRecarga = this.tBusca = null;
  }

  definir(r: Linha[]) { this.linhas = r; this.publicar(r); }

  async recarregar() {
    if (this.tRecarga) { clearTimeout(this.tRecarga); this.tRecarga = null; }
    const gen = this.gen;
    const meu = ++this.seq;
    this.emCurso = true;
    this.durante = [];
    const o = this.opts();
    let q: any = supabase.from(this.tabela).select(o.select ?? "*");
    if (o.filter) q = o.filter(q);
    if (o.order) q = q.order(o.order.column, { ascending: o.order.ascending ?? true });
    if (o.limit) q = q.limit(o.limit);
    const { data, error } = await q;
    if (gen !== this.gen || meu !== this.seq) return; // resposta de uma consulta que já mudou
    this.emCurso = false;
    if (!error) {
      let r = (data ?? []) as Linha[];
      if (this.durante.length) r = aplicarOps(r, this.durante, montarPlano(this.tabela, o)).rows;
      this.definir(r);
    } else if (tabelaAusente(error)) this.definir([]);
    this.durante = [];
    this.aoResultado(error);
  }

  agendarRecarga(ms = 150) {
    if (this.tRecarga) clearTimeout(this.tRecarga);
    this.tRecarga = setTimeout(() => { this.tRecarga = null; void this.recarregar(); }, ms);
  }

  receber(m: Mudanca) {
    const p = montarPlano(this.tabela, this.opts());
    if (m.tipo === "DELETE") {
      const k = chaveDaLinha(m.velho, p.pk);
      if (k === null) this.agendarRecarga(); else this.enfileirar({ tipo: "remover", chave: k });
      return;
    }
    if (p.semChaveLocal) { this.agendarRecarga(); return; }
    const r = m.novo;
    const tem = (c: string) => c in r;
    const k = chaveDaLinha(r, p.pk);
    if (k === null) { this.agendarRecarga(); return; }
    // 1) quando o filtro decide sozinho, a linha que não passa só sai da lista (nada de ir ao banco)
    if (!m.cortado && p.filtroOk && p.filtro && p.colsFiltro.every(tem) && !p.filtro(r)) {
      this.enfileirar({ tipo: "remover", chave: k });
      return;
    }
    // 2) o payload tem tudo o que a consulta mostra: aplica direto
    const basta = !m.cortado && !p.complexo && p.filtroOk && p.colsFiltro.every(tem) &&
      (!p.ordem || tem(p.ordem.coluna)) && (p.todas ? !m.restrito : p.colunas.every(tem));
    if (basta) { this.enfileirar({ tipo: "upsert", linha: r, completa: false }); return; }
    // 3) falta coluna (ou só o banco avalia o filtro): busca só esta linha
    if (p.pk.length !== 1) { this.agendarRecarga(); return; }
    this.buscar.add(String(r[p.pk[0]]));
    if (!this.tBusca) this.tBusca = setTimeout(() => { this.tBusca = null; void this.buscarLinhas(); }, 120);
  }

  private async buscarLinhas() {
    const ids = [...this.buscar];
    this.buscar.clear();
    if (!ids.length) return;
    if (ids.length > 40) { this.agendarRecarga(0); return; }
    const gen = this.gen;
    const o = this.opts();
    const p = montarPlano(this.tabela, o);
    let q: any = supabase.from(this.tabela).select(o.select ?? "*").in(p.pk[0], ids);
    if (o.filter) q = o.filter(q);
    const { data, error } = await q;
    if (gen !== this.gen) return;
    if (error) { this.agendarRecarga(); return; }
    const achadas = new Map(((data ?? []) as Linha[]).map((r) => [String(r[p.pk[0]]), r]));
    for (const id of ids) {
      const r = achadas.get(id);
      this.enfileirar(r ? { tipo: "upsert", linha: r, completa: true } : { tipo: "remover", chave: id });
    }
  }

  private enfileirar(op: Op) {
    this.fila.push(op);
    // junta as mudanças de uma rajada (ex.: links regravados) numa renderização só
    if (!this.tFila) this.tFila = setTimeout(() => this.aplicarFila(), 24);
  }

  private aplicarFila() {
    this.tFila = null;
    const ops = this.fila;
    this.fila = [];
    if (!ops.length) return;
    if (this.emCurso) this.durante.push(...ops);
    const { rows, recarregar } = aplicarOps(this.linhas, ops, montarPlano(this.tabela, this.opts()));
    if (rows !== this.linhas) this.definir(rows);
    if (recarregar) this.agendarRecarga();
  }
}

/**
 * Carrega uma tabela e a mantém em dia pelo Realtime (canal compartilhado, mudança aplicada no estado).
 * `semTabela` fica true quando a tabela ainda não existe no banco (migração pendente): a tela cai no
 * modo antigo e o hook confere de novo de tempos em tempos, sem abrir canal.
 */
export function useTable<T>(table: string, opts: Opts = {}) {
  const [rows, setRowsState] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semTabela, setSemTabela] = useState(() => ausentes.has(table));
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const espelho = useRef<Espelho | null>(null);
  if (!espelho.current || espelho.current.tabela !== table) {
    espelho.current?.parar();
    espelho.current = new Espelho(
      table,
      () => optsRef.current,
      (r) => setRowsState(r as T[]),
      (e) => {
        const falta = tabelaAusente(e);
        if (falta) ausentes.add(table); else if (!e) ausentes.delete(table);
        if (falta || !e) setSemTabela(falta);
        setErro(e ? e.message ?? "erro" : null);
        setLoading(false);
      },
    );
  }

  const reload = useCallback(() => espelho.current!.recarregar(), []);

  // quem chama setRows (atualização otimista) mantém o espelho em dia
  const setRows = useCallback((v: SetStateAction<T[]>) => {
    const e = espelho.current!;
    const novo = typeof v === "function" ? (v as (p: T[]) => T[])(e.linhas as T[]) : v;
    e.definir(novo as Linha[]);
  }, []);

  // carga inicial e recarga quando a tabela ou a chave mudam
  const chave = opts.chave;
  useEffect(() => {
    const e = espelho.current!;
    e.gen++;
    setLoading(true);
    void e.recarregar();
    return () => { e.parar(); };
  }, [table, chave]);

  // tempo real; sem a tabela, só confere de novo a cada 90 s (a migração pode chegar com a tela aberta)
  useEffect(() => {
    const e = espelho.current!;
    if (semTabela) {
      const t = setInterval(() => void e.recarregar(), 90_000);
      return () => clearInterval(t);
    }
    return ouvir(table, { mudou: (m) => e.receber(m), reconectou: () => e.agendarRecarga(300) });
  }, [table, semTabela]);

  return { rows, setRows, loading, erro, reload, semTabela };
}

/** Atualiza a tela a cada N segundos (para "há 3 min" e presença). Devolve um contador para usar em useMemo. */
export function useTick(ms = 30000) {
  const [n, set] = useState(0);
  useEffect(() => {
    const i = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(i);
  }, [ms]);
  return n;
}
