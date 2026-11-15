"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { tocar } from "@/lib/som";
import { COLUNAS, type Card, type Member, type Prioridade, type Status } from "@/lib/types";
import { Amostra, Icone } from "./Defs";
import { NotaDoCard } from "./NotaDoCard";

const PRIORIDADES: Prioridade[] = ["baixa", "media", "alta", "urgente"];

export function PainelCard({ card, members, onClose, onSaved }: {
  card: Card; members: Member[]; onClose: () => void; onSaved: () => void;
}) {
  const [titulo, setTitulo] = useState(card.title);
  const [corpo, setCorpo] = useState(card.body);
  const [status, setStatus] = useState<Status>(card.status);
  const [prio, setPrio] = useState<Prioridade>(card.prioridade);
  const [dono, setDono] = useState(card.assignee ?? "");
  const [prazo, setPrazo] = useState(card.due ?? "");
  const [labels, setLabels] = useState(card.labels.join(", "));
  const [executor, setExecutor] = useState<Card["executor"]>(card.executor);
  const [como, setComo] = useState(card.como ?? "");
  const [resultado, setResultado] = useState(card.resultado ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function salvar() {
    if (!titulo.trim()) { tocar("erro"); setErro("O card precisa de um título."); return; }
    setSalvando(true);
    const patch: Record<string, unknown> = {
      title: titulo.trim(), body: corpo, prioridade: prio, assignee: dono || null,
      due: prazo || null, labels: labels.split(",").map((s) => s.trim()).filter(Boolean),
      executor, como, resultado,
    };
    if (status !== card.status) patch.status = status;
    const { error } = await supabase.from("cards").update(patch).eq("id", card.id);
    setSalvando(false);
    if (error) { tocar("erro"); setErro(error.message); return; }
    onSaved(); onClose();
  }

  async function arquivar() {
    const { error } = await supabase.from("cards").update({ archived_at: new Date().toISOString() }).eq("id", card.id);
    if (error) { tocar("erro"); setErro(error.message); return; }
    onSaved(); onClose();
  }

  return (
    <>
      <div className="painel-fundo" onClick={onClose} />
      <aside className="painel" role="dialog" aria-modal="true" aria-label="Editar card">
        <div className="painel__cab">
          <h2>Editar card</h2>
          <button className="btn btn--icone btn--chip" type="button" aria-label="Fechar" onClick={onClose}><Icone id="i-x" /></button>
        </div>

        <label className="campo-g">
          <span className="rotulo">Título</span>
          <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </label>

        <label className="campo-g">
          <span className="rotulo">Descrição</span>
          <textarea className="campo" value={corpo} onChange={(e) => setCorpo(e.target.value)} />
        </label>

        <div className="campo-g">
          <span className="rotulo">Coluna</span>
          <div className="abas" data-unico role="group" aria-label="Coluna">
            {COLUNAS.map((c) => (
              <button key={c.id} type="button" className="btn btn--chip" aria-pressed={status === c.id} onClick={() => setStatus(c.id)}>
                <Amostra textura={c.textura} w={26} h={14} />{c.nome}
              </button>
            ))}
          </div>
        </div>

        <div className="campo-g">
          <span className="rotulo">Prioridade</span>
          <div className="abas" data-unico role="group" aria-label="Prioridade">
            {PRIORIDADES.map((p) => (
              <button key={p} type="button" className="btn btn--chip" aria-pressed={prio === p} onClick={() => setPrio(p)}>
                <span className={`prio-ponto prio-ponto--${p}`} aria-hidden="true" />{p === "media" ? "média" : p}
              </button>
            ))}
          </div>
        </div>

        <div className="grade-2c">
          <label className="campo-g">
            <span className="rotulo">Responsável</span>
            <select className="campo" value={dono} onChange={(e) => setDono(e.target.value)}>
              <option value="">— ninguém —</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
          <label className="campo-g">
            <span className="rotulo">Prazo</span>
            <input className="campo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </label>
        </div>

        <div className="campo-g">
          <span className="rotulo">Quem resolve</span>
          <div className="abas" data-unico role="group" aria-label="Quem resolve">
            {([["claude", "Claude"], ["humano", "Humano"], ["ambos", "Ambos"]] as const).map(([v, n]) => (
              <button key={v} type="button" className="btn btn--chip" aria-pressed={executor === v} onClick={() => setExecutor(executor === v ? null : v)}>{n}</button>
            ))}
          </div>
        </div>

        <label className="campo-g">
          <span className="rotulo">Como resolver (o Claude lê isto)</span>
          <textarea className="campo" value={como} onChange={(e) => setComo(e.target.value)} placeholder="Passos curtos, onde está o contexto, o que depende de uma pessoa" />
        </label>

        <label className="campo-g">
          <span className="rotulo">Resposta / resultado {status === "feito" ? "(vai para as concluídas da vault)" : "(preencha ao concluir)"}</span>
          <textarea className="campo" value={resultado} onChange={(e) => setResultado(e.target.value)}
            placeholder="O que foi feito e onde está (nota, arquivo, link). Pode ficar vazio: a atividade só vai para concluída." />
        </label>

        {card.concluido_em ? <p className="vazio-nota">concluída em {card.concluido_em.slice(0, 10)}</p> : null}

        <label className="campo-g">
          <span className="rotulo">Etiquetas (separadas por vírgula)</span>
          <input className="campo" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="crew, overflow" />
        </label>

        <NotaDoCard card={card} aoMudar={onSaved} />

        {erro && <p className="vazio-nota" role="alert">{erro}</p>}

        <div className="linha">
          <button className="btn btn--primario" type="button" onClick={salvar} aria-disabled={salvando}>Salvar</button>
          <button className="btn btn--fantasma" type="button" onClick={arquivar}>Arquivar</button>
        </div>
      </aside>
    </>
  );
}
