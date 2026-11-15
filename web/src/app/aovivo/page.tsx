"use client";
import { useMemo, useState } from "react";
import { SessaoChip } from "@/components/AoVivo";
import { Disco } from "@/components/Defs";
import { EquipeFaixa } from "@/components/EquipeFaixa";
import { texturaDe, useApp } from "@/components/Shell";
import { useSessoes, useWebOnline } from "@/lib/aovivo";
import { useTable, useTick } from "@/lib/hooks";
import { ha, horaCurta, type Atividade, type Sessao } from "@/lib/types";

const VERBO: Record<Atividade["kind"], string> = {
  inicio: "começou uma sessão", pedido: "pediu", arquivo: "editou", espera: "parou e espera resposta", fim: "terminou a sessão", destilar: "destilar",
};

function LinhaDoTempo({ sessoes }: { sessoes: Map<string, Sessao> }) {
  const { members } = useApp();
  const [filtro, setFiltro] = useState("todos");
  const { rows, loading, erro } = useTable<Atividade>("atividade", {
    filter: (q) => (filtro === "todos" ? q : q.eq("member_id", filtro)),
    order: { column: "created_at", ascending: false }, limit: 40, chave: filtro,
  });
  useTick(30000);

  return (
    <section aria-labelledby="h-tempo">
      <div className="linha" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <h2 id="h-tempo" className="titulo-pag" style={{ fontSize: "var(--t-h2)" }}>Linha do tempo</h2>
        <div className="abas" data-unico role="group" aria-label="Filtrar por pessoa">
          <button className="btn btn--chip" type="button" aria-pressed={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos</button>
          {members.map((m) => (
            <button key={m.id} className="btn btn--chip" type="button" aria-pressed={filtro === m.id} onClick={() => setFiltro(m.id)}>{m.nome}</button>
          ))}
        </div>
      </div>
      {erro ? <p className="vazio-nota" role="alert">Não consegui carregar a atividade: {erro}</p> : null}
      <div className="cartao" style={{ padding: 0 }}>
        <ol className="tempo" aria-live="polite">
          {rows.map((a) => {
            const m = members.find((x) => x.id === a.member_id);
            const projeto = a.sessao_id ? sessoes.get(a.sessao_id)?.projeto : null;
            return (
              <li key={a.id} className="tempo__item">
                <time className="mono tempo__hora" dateTime={a.created_at} title={ha(a.created_at)}>{horaCurta(a.created_at)}</time>
                {m ? <Disco textura={texturaDe(m)} inicial={m.nome[0]} size={24} /> : <span className="tempo__vazio" aria-hidden="true" />}
                <div className="tempo__texto">
                  <strong>{m?.nome ?? "alguém"}</strong> {VERBO[a.kind] ?? a.kind}{a.texto ? <> <span className="tempo__detalhe">{a.texto}</span></> : null}
                  {projeto ? <small className="vazio-nota"> · {projeto}</small> : null}
                </div>
              </li>
            );
          })}
          {!rows.length ? <li className="vazio-nota" style={{ padding: 18 }}>{loading ? "carregando…" : "Sem atividade ainda. Ela aparece aqui quando alguém usar o Claude Code com o Convés."}</li> : null}
        </ol>
      </div>
    </section>
  );
}

export default function AoVivoPage() {
  const { me, members } = useApp();
  const { vivas, rows, semTabela, loading, erro } = useSessoes();
  const web = useWebOnline();

  const porPessoa = useMemo(() => {
    const m = new Map<string, Sessao[]>();
    for (const s of [...vivas].sort((a, b) => (a.started_at < b.started_at ? -1 : 1))) m.set(s.member_id, [...(m.get(s.member_id) ?? []), s]);
    return m;
  }, [vivas]);
  const porId = useMemo(() => new Map(rows.map((s) => [s.id, s])), [rows]);

  return (
    <>
      <div className="cab-pag">
        <div>
          <h1 className="titulo-pag">Ao <span className="editorial">vivo</span></h1>
          <p className="sub-pag">Cada sessão do Claude Code que está rodando agora, o que ela pediu e o último passo. Atualiza sozinho, sem recarregar.</p>
        </div>
        {!semTabela ? <span className="carimbo" role="status">{vivas.length} sessão{vivas.length === 1 ? "" : "ões"} viva{vivas.length === 1 ? "" : "s"}</span> : null}
      </div>

      {semTabela ? (
        <>
          <div className="cartao estado-tela">
            <span className="carimbo">ainda não ligado</span>
            <h2 className="ficha__nome">O tempo real por sessão ainda não está no banco</h2>
            <p className="vazio-nota">A tabela <code>sessoes</code> chega com a migração 0011. Enquanto isso, a presença antiga (uma linha por pessoa) segue valendo:</p>
          </div>
          <div style={{ marginTop: 22 }}><EquipeFaixa /></div>
        </>
      ) : (
        <>
          {erro ? <p className="vazio-nota" role="alert">Não consegui carregar as sessões: {erro}</p> : null}
          {loading ? <p className="rotulo" role="status">conferindo as sessões…</p> : null}
          <div className="vivo-grade">
            {members.map((m) => {
              const lista = porPessoa.get(m.id) ?? [];
              return (
                <section className="cartao vivo-cartao" key={m.id} aria-label={`Sessões de ${m.nome}`}>
                  <div className="membro__topo">
                    <Disco textura={texturaDe(m)} inicial={m.nome[0]} size={44} />
                    <div>
                      <div className="membro__nome">{m.nome}</div>
                      <span className="vazio-nota">{web.includes(m.id) ? "com o Convés aberto" : lista.length ? "no Claude Code" : "sem sessão viva"}</span>
                    </div>
                  </div>
                  {lista.map((s) => <SessaoChip key={s.id} s={s} dono={m} euId={me.id} completo />)}
                </section>
              );
            })}
          </div>
          <LinhaDoTempo sessoes={porId} />
        </>
      )}
    </>
  );
}
