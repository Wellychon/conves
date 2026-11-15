"use client";
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useRef, useState } from "react";
import { Amostra, Disco, Icone } from "@/components/Defs";
import { AoVivoFaixa, DestilarEstado } from "@/components/AoVivo";
import { PainelCard } from "@/components/PainelCard";
import { texturaDe, useApp } from "@/components/Shell";
import { useSessoes } from "@/lib/aovivo";
import { useTable, useTick } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { tocar } from "@/lib/som";
import { COLUNAS, dataCurta, minutosDesde, type Card, type Destilacao, type Member, type Presence, type Status } from "@/lib/types";

const hoje = () => new Date().toISOString().slice(0, 10);

/** Quem está trabalhando neste card agora (presença ativa nos últimos 15 min). */
type Vivo = { nome: string; textura: string; inicial: string; doing: string | null; selo: string };

function CardCorpo({ card, dono, levantado, vivo }: { card: Card; dono?: Member; levantado?: boolean; vivo?: Vivo }) {
  const atrasado = card.due && card.status !== "feito" && card.due < hoje();
  return (
    <>
      {vivo ? (
        <div className="card-k__agora" title={vivo.doing ?? ""}>
          <Disco textura={vivo.textura} inicial={vivo.inicial} size={22} />
          <span className="carimbo carimbo--mini">{vivo.selo}</span>
          <strong>{vivo.nome}</strong>
          <span className="doing">{vivo.doing ?? "trabalhando"}</span>
        </div>
      ) : null}
      <h3>{card.title}</h3>
      {card.status === "feito" && !levantado ? (
        <p className="card-k__resultado"><strong>✓ resposta</strong> {card.resultado?.trim() || "concluída"}</p>
      ) : card.body && !levantado ? <p>{card.body}</p> : null}
      <div className="card-k__meta">
        <span className={`prio prio--${card.prioridade}`} title={`prioridade ${card.prioridade}`}>{card.prioridade === "media" ? "média" : card.prioridade}</span>
        {card.due ? <span className={`mono${atrasado ? " atrasado" : ""}`}>até {dataCurta(card.due)}</span> : null}
        {card.executor ? <span className={`etiqueta etiqueta--${card.executor}`} title="quem resolve">{card.executor}</span> : null}
        {card.labels.slice(0, 2).map((l) => <span className="etiqueta" key={l}>{l}</span>)}
        {dono ? <span style={{ marginLeft: "auto" }} title={dono.nome}><Disco textura={texturaDe(dono)} inicial={dono.nome[0]} size={26} /></span> : null}
      </div>
    </>
  );
}

function CardK({ card, dono, vivo, onAbrir }: { card: Card; dono?: Member; vivo?: Vivo; onAbrir: (id: string) => void }) {
  const drag = useDraggable({ id: card.id });
  const drop = useDroppable({ id: card.id });
  const ref = (el: HTMLElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); };
  return (
    <article
      ref={ref} {...drag.listeners} {...drag.attributes}
      className={`cartao card-k${vivo ? " card-k--vivo" : ""}`} data-arrastando={drag.isDragging || undefined}
      onClick={() => onAbrir(card.id)}
      onKeyDown={(e) => { if (e.key === "Enter") onAbrir(card.id); }}
      aria-label={`Card: ${card.title}${vivo ? `, ${vivo.nome} está trabalhando agora` : ""}`}
    >
      {vivo ? <svg className="card-k__formigas" aria-hidden="true"><rect width="100%" height="100%" rx="20" /></svg> : null}
      <CardCorpo card={card} dono={dono} vivo={vivo} />
    </article>
  );
}

function Coluna({ id, nome, textura, dica, cards, membros, vivos, onAbrir, onCriar }: {
  id: Status; nome: string; textura: string; dica: string; cards: Card[]; membros: Member[]; vivos: Map<string, Vivo>;
  onAbrir: (id: string) => void; onCriar: (status: Status, titulo: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${id}` });
  const [novo, setNovo] = useState(false);
  const [titulo, setTitulo] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return;
    await onCriar(id, titulo.trim());
    setTitulo(""); setNovo(false);
  }

  return (
    <section className="coluna" aria-label={nome}>
      <header className="coluna__cab">
        <Amostra textura={textura} />
        <div><h2>{nome}</h2><small>{dica}</small></div>
        <span className="coluna__n" aria-label={`${cards.length} cards`}>{cards.length}</span>
      </header>
      <div className="coluna__corpo" ref={setNodeRef} data-sobre={isOver || undefined}>
        {cards.map((c) => <CardK key={c.id} card={c} vivo={vivos.get(c.id)} dono={membros.find((m) => m.id === c.assignee)} onAbrir={onAbrir} />)}
        {novo ? (
          <form className="nova-card" onSubmit={enviar}>
            <input className="campo" autoFocus placeholder="Título do card" value={titulo} onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setNovo(false); setTitulo(""); } }} />
            <div className="linha">
              <button className="btn btn--chip btn--primario" type="submit">Criar</button>
              <button className="btn btn--chip btn--fantasma" type="button" onClick={() => { setNovo(false); setTitulo(""); }}>Cancelar</button>
            </div>
          </form>
        ) : (
          <div><button className="btn btn--chip btn--fantasma" type="button" onClick={() => setNovo(true)}><Icone id="i-mais" />Novo card</button></div>
        )}
      </div>
    </section>
  );
}

export default function QuadroPage() {
  const { me, members } = useApp();
  const { rows, setRows, reload, loading, erro } = useTable<Card>("cards", {
    filter: (q) => q.is("archived_at", null), order: { column: "position" },
  });
  const { rows: boards } = useTable<{ id: string; nome: string }>("boards", { limit: 1 });
  const { rows: presenca } = useTable<Presence>("presence");
  const { rows: destilacoes, reload: recarregarDestilacoes } = useTable<Destilacao>("destilacoes", {
    order: { column: "requested_at", ascending: false }, limit: 5,
  });
  const [filtro, setFiltro] = useState("todos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [ativo, setAtivo] = useState<string | null>(null);
  const soltouEm = useRef(0);
  useTick(60000);

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const porColuna = useMemo(() => {
    const m = new Map<Status, Card[]>();
    COLUNAS.forEach((c) => m.set(c.id, []));
    rows
      .filter((c) => filtro === "todos" || (filtro === "nenhum" ? !c.assignee : c.assignee === filtro))
      .forEach((c) => m.get(c.status)?.push(c));
    m.forEach((l) => l.sort((a, b) => a.position - b.position));
    return m;
  }, [rows, filtro]);

  // card_id -> quem está nele agora: sessão viva vinculada (ao vivo) ou, sem a tabela de sessões, a presença antiga
  const { vivas, semTabela: semSessoes } = useSessoes();
  const vivos = useMemo(() => {
    const m = new Map<string, Vivo>();
    if (!semSessoes) {
      for (const s of vivas) {
        const pessoa = members.find((x) => x.id === s.member_id);
        if (!s.card_id || !pessoa) continue;
        m.set(s.card_id, { nome: pessoa.nome, textura: texturaDe(pessoa), inicial: pessoa.nome[0], doing: s.privado ? "sessão privada" : s.doing, selo: "ao vivo" });
      }
      return m;
    }
    for (const p of presenca) {
      const min = minutosDesde(p.last_seen);
      if (!p.card_id || min === null || min > 15) continue;
      const pessoa = members.find((x) => x.id === p.member_id);
      if (pessoa) m.set(p.card_id, { nome: pessoa.nome, textura: texturaDe(pessoa), inicial: pessoa.nome[0], doing: p.doing, selo: "agora" });
    }
    return m;
  }, [presenca, members, vivas, semSessoes]);

  // soltar arquivos .md no quadro: cria um card + a nota arquivada em 07 Quadro, já anexada
  const [soltando, setSoltando] = useState(false);
  async function soltarMd(files: FileList) {
    const board = boards[0];
    if (!board) return;
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith(".md")) continue;
      const texto = await f.text();
      const titulo = texto.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.name.replace(/\.md$/i, "");
      let caminho = `07 Quadro/${f.name}`;
      let nota: { id: string } | null = null;
      for (let t = 0; t < 2 && !nota; t++) {
        const { data } = await supabase.rpc("upsert_note", { p_path: caminho, p_body: texto, p_base_version: null });
        if (data && !data.conflict) nota = data.note; else caminho = caminho.replace(/\.md$/i, ` ${Date.now() % 100000}.md`);
      }
      if (!nota) { tocar("erro"); continue; }
      const fim = Math.max(0, ...rows.filter((c) => c.status === "backlog").map((c) => c.position)) + 1000;
      await supabase.from("cards").insert({ board_id: board.id, title: titulo, status: "backlog", position: fim, created_by: me.id, note_id: nota.id });
    }
    reload();
  }

  function abrir(id: string) {
    if (Date.now() - soltouEm.current < 250) return; // clique fantasma logo após arrastar
    setAberto(id);
  }

  async function criar(status: Status, titulo: string) {
    const board = boards[0];
    if (!board) { tocar("erro"); return; }
    const fim = Math.max(0, ...rows.filter((c) => c.status === status).map((c) => c.position)) + 1000;
    const { error } = await supabase.from("cards").insert({ board_id: board.id, title: titulo, status, position: fim, created_by: me.id });
    if (error) tocar("erro"); else reload();
  }

  function aoSoltar(e: DragEndEvent) {
    setAtivo(null);
    soltouEm.current = Date.now();
    const id = String(e.active.id);
    if (!e.over) return;
    const alvoId = String(e.over.id);
    const card = rows.find((c) => c.id === id);
    if (!card || alvoId === id) return;

    let status: Status;
    let pos: number;
    if (alvoId.startsWith("col:")) {
      status = alvoId.slice(4) as Status;
      const col = rows.filter((c) => c.status === status && c.id !== id).sort((a, b) => a.position - b.position);
      pos = (col.at(-1)?.position ?? 0) + 1000;
    } else {
      const alvo = rows.find((c) => c.id === alvoId);
      if (!alvo) return;
      status = alvo.status;
      const col = rows.filter((c) => c.status === status).sort((a, b) => a.position - b.position);
      const semAtivo = col.filter((c) => c.id !== id);
      const i = semAtivo.findIndex((c) => c.id === alvo.id);
      const descendo = card.status === status && col.findIndex((c) => c.id === id) < col.findIndex((c) => c.id === alvo.id);
      if (descendo) {
        const prox = semAtivo[i + 1];
        pos = prox ? (alvo.position + prox.position) / 2 : alvo.position + 1000;
      } else {
        const ant = semAtivo[i - 1];
        pos = ant ? (ant.position + alvo.position) / 2 : alvo.position - 1000;
      }
    }
    setRows((rs) => rs.map((c) => (c.id === id ? { ...c, status, position: pos } : c)));
    supabase.from("cards").update({ status, position: pos }).eq("id", id).then(({ error }) => {
      if (error) { tocar("erro"); reload(); } else tocar("solta");
    });
  }

  const cardAtivo = ativo ? rows.find((c) => c.id === ativo) : undefined;
  const cardAberto = aberto ? rows.find((c) => c.id === aberto) : undefined;
  const total = rows.length;

  // Destilar: o clique só cria o pedido; o próximo Claude conectado faz o trabalho (ver /mcp__conves__destilar)
  const concluidos = rows.filter((c) => c.status === "feito").length;
  const pedido = destilacoes.find((d) => !d.done_at && (!d.claimed_at || (minutosDesde(d.claimed_at) ?? 0) < 180));
  const [pedindo, setPedindo] = useState(false);
  async function destilar() {
    setPedindo(true);
    const { error } = await supabase.rpc("pedir_destilacao");
    setPedindo(false);
    if (error) tocar("erro"); else { tocar("solta"); recarregarDestilacoes(); }
  }

  return (
    <>
      <div className="cab-pag">
        <div>
          <h1 className="titulo-pag">O que está <span className="editorial">rolando</span></h1>
          <p className="sub-pag">{total} cards no quadro da Piena. Arraste entre colunas: quanto mais tinta, mais perto de feito.</p>
        </div>
        <div className="destilar">
          <button className="btn btn--primario" type="button" onClick={destilar}
            aria-disabled={!!pedido || pedindo} disabled={!!pedido || pedindo}
            title="O próximo Claude conectado passa os concluídos para a vault (contexto, decisões, personas, calendário) e arquiva os cards">
            <Icone id="i-alvo" />{pedido ? (pedido.claimed_at ? "Destilando…" : "Destilação pedida") : "Destilar"}
          </button>
          <DestilarEstado destilacoes={destilacoes} concluidos={concluidos} />
        </div>
      </div>

      <AoVivoFaixa />

      <div className="abas" data-unico role="group" aria-label="Filtrar por responsável" style={{ marginBottom: 22 }}>
        <button className="btn btn--chip" type="button" aria-pressed={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos</button>
        {members.map((m) => (
          <button key={m.id} className="btn btn--chip" type="button" aria-pressed={filtro === m.id} onClick={() => setFiltro(m.id)}>{m.nome}</button>
        ))}
        <button className="btn btn--chip" type="button" aria-pressed={filtro === "nenhum"} onClick={() => setFiltro("nenhum")}>Sem dono</button>
      </div>

      {erro ? <p className="vazio-nota" role="alert">Não consegui carregar o quadro: {erro}</p> : null}
      {loading ? <p className="rotulo" role="status">carregando o quadro…</p> : null}

      <DndContext sensors={sensores} onDragStart={(e: DragStartEvent) => { setAtivo(String(e.active.id)); tocar("clique"); }}
        onDragEnd={aoSoltar} onDragCancel={() => setAtivo(null)}>
        <div className={`quadro${soltando ? " solta-md" : ""}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setSoltando(true); } }}
          onDragLeave={() => setSoltando(false)}
          onDrop={(e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); setSoltando(false); void soltarMd(e.dataTransfer.files); } }}>
          {COLUNAS.map((c) => (
            <Coluna key={c.id} {...c} cards={porColuna.get(c.id) ?? []} membros={members} vivos={vivos} onAbrir={abrir} onCriar={criar} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
          {cardAtivo ? (
            <article className="cartao card-k card-k--levantado">
              <CardCorpo card={cardAtivo} dono={members.find((m) => m.id === cardAtivo.assignee)} levantado />
            </article>
          ) : null}
        </DragOverlay>
      </DndContext>

      {cardAberto ? <PainelCard key={cardAberto.id} card={cardAberto} members={members} onClose={() => setAberto(null)} onSaved={reload} /> : null}
    </>
  );
}
