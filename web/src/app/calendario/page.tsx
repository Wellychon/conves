"use client";
import { useMemo, useState } from "react";
import { Icone } from "@/components/Defs";
import { useApp } from "@/components/Shell";
import { useTable } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { urlSegura } from "@/lib/urlSegura";
import { tocar } from "@/lib/som";
import { dataCurta, TIPOS_EVENTO, type Card, type Decision, type Evento, type TipoEvento } from "@/lib/types";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (a: number, m: number, d: number) => `${a}-${p2(m + 1)}-${p2(d)}`;
const hojeIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };

/** Tudo que aparece no calendário, venha de onde vier. */
type Item = { dia: string; fim?: string | null; texto: string; tipo: TipoEvento | "card" | "decisao"; link?: string; feito?: boolean };

function Chip({ i }: { i: Item }) {
  const corpo = <><span className="cal-chip__t">{i.tipo === "card" ? "card" : i.tipo === "decisao" ? "rever" : i.tipo}</span> {i.texto}</>;
  const cls = `cal-chip cal-chip--${i.tipo}${i.feito ? " cal-chip--feito" : ""}`;
  const link = urlSegura(i.link);
  return link
    ? <a className={cls} href={link} target="_blank" rel="noreferrer noopener" title={i.texto}>{corpo}</a>
    : <span className={cls} title={i.texto}>{corpo}</span>;
}

export default function CalendarioPage() {
  const { me } = useApp();
  const { rows: eventos, reload, erro } = useTable<Evento>("eventos", { order: { column: "dia" } });
  const { rows: cards } = useTable<Card>("cards", { filter: (q) => q.is("archived_at", null).not("due", "is", null) });
  const { rows: decisoes } = useTable<Decision>("decisions", { filter: (q) => q.not("review_on", "is", null) });

  const agora = new Date();
  const [ano, setAno] = useState(agora.getFullYear());
  const [mes, setMes] = useState(agora.getMonth());
  const [aberto, setAberto] = useState(false);
  const [dia, setDia] = useState(hojeIso());
  const [fim, setFim] = useState("");
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<TipoEvento>("edital");
  const [link, setLink] = useState("");

  const itens = useMemo<Item[]>(() => [
    ...eventos.map((e) => ({ dia: e.dia, fim: e.fim, texto: e.titulo, tipo: e.tipo, link: e.link || undefined })),
    ...cards.map((c) => ({ dia: c.due as string, texto: c.title, tipo: "card" as const, feito: c.status === "feito" })),
    ...decisoes.map((d) => ({ dia: d.review_on as string, texto: d.decision, tipo: "decisao" as const })),
  ], [eventos, cards, decisoes]);

  // dia -> itens (evento com "fim" ocupa todos os dias do intervalo)
  const porDia = useMemo(() => {
    const m = new Map<string, Item[]>();
    const por = (d: string, i: Item) => m.set(d, [...(m.get(d) ?? []), i]);
    for (const i of itens) {
      if (!i.fim || i.fim <= i.dia) { por(i.dia, i); continue; }
      const [a, mm, d] = i.dia.split("-").map(Number);
      for (let k = 0; k < 62; k++) {
        const x = new Date(a, mm - 1, d + k);
        const s = iso(x.getFullYear(), x.getMonth(), x.getDate());
        if (s > i.fim) break;
        por(s, i);
      }
    }
    return m;
  }, [itens]);

  const celulas = useMemo(() => {
    const primeiro = new Date(ano, mes, 1).getDay();
    const total = new Date(ano, mes + 1, 0).getDate();
    const lista: (number | null)[] = Array(primeiro).fill(null);
    for (let d = 1; d <= total; d++) lista.push(d);
    while (lista.length % 7) lista.push(null);
    return lista;
  }, [ano, mes]);

  const hoje = hojeIso();
  const proximos = useMemo(
    () => itens.filter((i) => (i.fim ?? i.dia) >= hoje && !i.feito).sort((a, b) => a.dia.localeCompare(b.dia)).slice(0, 12),
    [itens, hoje],
  );

  function mover(delta: number) {
    const d = new Date(ano, mes + delta, 1);
    setAno(d.getFullYear()); setMes(d.getMonth());
  }

  function novoEm(d: string) { setDia(d); setFim(""); setAberto(true); }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || !dia) { tocar("erro"); return; }
    const { error } = await supabase.from("eventos").insert({
      dia, fim: fim && fim > dia ? fim : null, titulo: titulo.trim(), tipo, link: link.trim(), created_by: me.id,
    });
    if (error) { tocar("erro"); return; }
    setTitulo(""); setLink(""); setFim(""); setAberto(false); reload();
  }

  return (
    <>
      <div className="cab-pag">
        <div>
          <h1 className="titulo-pag">Quando <span className="editorial">acontece</span></h1>
          <p className="sub-pag">Editais, hackathons, reuniões, prazos de cards e revisões de decisões num lugar só. Prazos de cards e decisões entram sozinhos; o resto você (ou o Claude) adiciona aqui.</p>
        </div>
        <button className="btn btn--primario" type="button" onClick={() => novoEm(hoje)}><Icone id="i-mais" />Nova data</button>
      </div>

      {aberto ? (
        <form className="cartao col-x" onSubmit={salvar} style={{ marginBottom: 26 }}>
          <label className="campo-g"><span className="rotulo">O que é</span>
            <input className="campo" autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Edital Fapeal — prazo de inscrição" /></label>
          <div className="grade-2c">
            <label className="campo-g"><span className="rotulo">Dia</span>
              <input className="campo" type="date" value={dia} onChange={(e) => setDia(e.target.value)} required /></label>
            <label className="campo-g"><span className="rotulo">Até (se durar mais de um dia)</span>
              <input className="campo" type="date" value={fim} min={dia} onChange={(e) => setFim(e.target.value)} /></label>
          </div>
          <div className="grade-2c">
            <label className="campo-g"><span className="rotulo">Tipo</span>
              <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoEvento)}>
                {TIPOS_EVENTO.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select></label>
            <label className="campo-g"><span className="rotulo">Link da fonte</span>
              <input className="campo" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" /></label>
          </div>
          <div className="linha">
            <button className="btn btn--primario" type="submit">Salvar</button>
            <button className="btn btn--fantasma" type="button" onClick={() => setAberto(false)}>Cancelar</button>
          </div>
        </form>
      ) : null}

      {erro ? <p className="vazio-nota" role="alert">Não consegui carregar o calendário: {erro}</p> : null}

      <div className="cal-layout">
        <section className="cartao cal" aria-label={`Calendário de ${MESES[mes]} de ${ano}`}>
          <header className="cal__cab">
            <button className="btn btn--chip btn--icone" type="button" aria-label="Mês anterior" onClick={() => mover(-1)}><span aria-hidden="true">‹</span></button>
            <h2 className="cal__mes">{MESES[mes]} <span className="mono">{ano}</span></h2>
            <button className="btn btn--chip btn--icone" type="button" aria-label="Próximo mês" onClick={() => mover(1)}><span aria-hidden="true">›</span></button>
            <button className="btn btn--chip btn--fantasma" type="button" onClick={() => { setAno(agora.getFullYear()); setMes(agora.getMonth()); }}>Hoje</button>
          </header>
          <div className="cal__grade" role="grid">
            {DIAS.map((d) => <div key={d} className="cal__dia-semana rotulo" role="columnheader">{d}</div>)}
            {celulas.map((d, k) => {
              if (d === null) return <div key={k} className="cal__cel cal__cel--vazia" role="gridcell" aria-hidden="true" />;
              const s = iso(ano, mes, d);
              const lista = porDia.get(s) ?? [];
              return (
                <div key={k} className={`cal__cel${s === hoje ? " cal__cel--hoje" : ""}`} role="gridcell" aria-label={`${d} de ${MESES[mes]}${lista.length ? `, ${lista.length} item(ns)` : ""}`}>
                  <button className="cal__num mono" type="button" title="Adicionar data neste dia" onClick={() => novoEm(s)}>{d}</button>
                  {lista.slice(0, 3).map((i, n) => <Chip key={n} i={i} />)}
                  {lista.length > 3 ? <span className="vazio-nota">+{lista.length - 3}</span> : null}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="cartao cal-prox" aria-label="Próximas datas">
          <h2 className="rotulo">Próximas datas</h2>
          {proximos.length ? (
            <ul className="cal-prox__lista">
              {proximos.map((i, n) => (
                <li key={n}>
                  <span className="mono cal-prox__data">{dataCurta(i.dia)}{i.fim && i.fim > i.dia ? `–${dataCurta(i.fim)}` : ""}</span>
                  <Chip i={i} />
                </li>
              ))}
            </ul>
          ) : <p className="vazio-nota">Nada agendado. Clique em um dia ou em “Nova data”.</p>}
        </aside>
      </div>
    </>
  );
}
