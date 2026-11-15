"use client";
import { useMemo } from "react";
import { Disco } from "@/components/Defs";
import { texturaDe, useApp } from "@/components/Shell";
import { useTable, useTick } from "@/lib/hooks";
import { ha, minutosDesde, type Card, type CardEvent, type NoteRow, type Presence } from "@/lib/types";

const VERBO: Record<string, string> = { criado: "criou o card", movido: "moveu o card", atribuido: "atribuiu o card" };

export default function EquipePage() {
  const { members } = useApp();
  const { rows: presenca } = useTable<Presence>("presence");
  const { rows: cards } = useTable<Card>("cards", { filter: (q) => q.is("archived_at", null).eq("status", "fazendo") });
  const { rows: eventos } = useTable<CardEvent>("card_events", { order: { column: "created_at", ascending: false }, limit: 20 });
  const { rows: notas } = useTable<NoteRow>("notes", {
    select: "id,path,title,tipo,owner,version,updated_at,updated_by,in_graph,deleted_at",
    filter: (q) => q.is("deleted_at", null), order: { column: "updated_at", ascending: false }, limit: 15,
  });
  useTick(30000);

  const nome = (id: string | null) => members.find((m) => m.id === id)?.nome ?? "alguém";

  const feed = useMemo(() => {
    const itens = [
      ...eventos.map((e) => ({ t: e.created_at, quem: nome(e.member_id), texto: `${VERBO[e.kind] ?? e.kind} “${e.data.title ?? ""}”${e.data.para ? ` → ${e.data.para}` : ""}` })),
      ...notas.map((n) => ({ t: n.updated_at, quem: nome(n.updated_by), texto: `editou a nota “${n.title}” (v${n.version})` })),
    ];
    return itens.sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 25);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventos, notas, members]);

  return (
    <>
      <div className="cab-pag">
        <div>
          <h1 className="titulo-pag">Quem está <span className="editorial">em quê</span></h1>
          <p className="sub-pag">Presença vinda do Claude Code (cada sessão avisa o que está fazendo) e a atividade recente do quadro e das notas.</p>
        </div>
      </div>

      <div className="grade grade--2" style={{ marginBottom: 34 }}>
        {members.map((m) => {
          const p = presenca.find((x) => x.member_id === m.id);
          const min = minutosDesde(p?.last_seen);
          const ativo = min !== null && min <= 15;
          const meus = cards.filter((c) => c.assignee === m.id);
          return (
            <section className="cartao membro" key={m.id}>
              <div className="membro__topo">
                <Disco textura={texturaDe(m)} inicial={m.nome[0]} size={48} />
                <div>
                  <div className="membro__nome">{m.nome}</div>
                  {ativo ? <span className="carimbo carimbo--mini">agora</span> : <span className="vazio-nota">{p ? `visto ${ha(p.last_seen)}` : "ainda não apareceu"}</span>}
                </div>
              </div>
              <p className="membro__fazendo">{ativo ? p?.doing ?? "ativo, sem descrição" : "—"}</p>
              <dl>
                <div><dt>Cards em andamento</dt><dd>{meus.length}</dd></div>
                {meus.map((c) => <div key={c.id}><dt>·</dt><dd style={{ fontWeight: 500 }}>{c.title}</dd></div>)}
              </dl>
            </section>
          );
        })}
      </div>

      <h2 className="titulo-pag" style={{ fontSize: "var(--t-h2)", marginBottom: 14 }}>Atividade recente</h2>
      <div className="cartao" style={{ padding: 0 }}>
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead>
            <tbody>
              {feed.map((f, i) => (
                <tr key={i}><td className="num" style={{ whiteSpace: "nowrap" }}>{ha(f.t)}</td><td><strong>{f.quem}</strong></td><td>{f.texto}</td></tr>
              ))}
              {!feed.length ? <tr><td colSpan={3} className="vazio-nota">Sem atividade ainda.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
