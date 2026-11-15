"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useSessoes, useWebOnline } from "@/lib/aovivo";
import { useTable, useTick } from "@/lib/hooks";
import { ha, type Atividade, type Destilacao, type Member, type Sessao } from "@/lib/types";
import { Disco } from "./Defs";
import { EquipeFaixa } from "./EquipeFaixa";
import { texturaDe, useApp } from "./Shell";

/** Estado que merece carimbo: destilando > esperando > privada. A sessão ativa comum não leva carimbo. */
export function rotuloSessao(s: Sessao, dono: Member | undefined, euId: string) {
  if (s.client === "runner" || s.destilacao_id) return { k: "runner", texto: "destilando" };
  if (s.estado === "esperando") return { k: "espera", texto: s.member_id === euId ? "esperando você" : `esperando ${dono?.nome ?? "resposta"}` };
  if (s.privado) return { k: "privada", texto: "privada" };
  return null;
}

/** Um chip por sessão: projeto · pedido · último passo · há X. Tudo vira texto (nunca HTML). */
export function SessaoChip({ s, dono, euId, completo = false }: { s: Sessao; dono?: Member; euId: string; completo?: boolean }) {
  const r = rotuloSessao(s, dono, euId);
  const pedido = s.doing || s.titulo || "trabalhando";
  const passo = s.privado ? null : s.ultimo_passo;
  const resumo = [dono?.nome, s.projeto, pedido, passo, ha(s.last_seen)].filter(Boolean).join(" · ");
  return (
    <div className={`sessao-chip sessao-chip--${r?.k ?? s.estado}${completo ? " sessao-chip--cheio" : ""}`} title={resumo} data-estado={s.estado}>
      <span className="sessao-chip__ponto" aria-hidden="true" />
      <div className="sessao-chip__corpo">
        <div className="sessao-chip__topo">
          {s.projeto ? <span className="etiqueta">{s.projeto}</span> : null}
          {r ? <span className={`carimbo carimbo--mini carimbo--${r.k}`}>{r.texto}</span> : null}
          {s.client === "web" ? <span className="etiqueta">web</span> : null}
          <small className="sessao-chip__quando">{ha(s.last_seen)}</small>
        </div>
        <span className="sessao-chip__pedido">{pedido}</span>
        {passo ? <small className="sessao-chip__passo">{passo}</small> : null}
        {completo && !s.privado && s.arquivos.length ? (
          <small className="sessao-chip__arquivos">{s.arquivos.slice(0, 3).join(" · ")}{s.arquivos.length > 3 ? ` · +${s.arquivos.length - 3}` : ""}</small>
        ) : null}
        {completo ? <small className="sessao-chip__passo">{s.passos} passo{s.passos === 1 ? "" : "s"} · começou {ha(s.started_at)}</small> : null}
      </div>
    </div>
  );
}

/** Faixa compacta do Quadro: por pessoa, um chip por sessão viva. Sem a tabela `sessoes`, volta para a faixa antiga (presence). */
export function AoVivoFaixa() {
  const { me, members } = useApp();
  const { vivas, loading, semTabela } = useSessoes();
  const web = useWebOnline();
  useTick(30000);

  const porPessoa = useMemo(() => {
    const m = new Map<string, Sessao[]>();
    for (const s of [...vivas].sort((a, b) => (a.started_at < b.started_at ? -1 : 1))) m.set(s.member_id, [...(m.get(s.member_id) ?? []), s]);
    return m;
  }, [vivas]);

  if (semTabela) return <EquipeFaixa />;
  if (loading) return <section className="vivo-faixa" aria-busy="true" aria-label="Equipe ao vivo"><span className="vazio-nota" role="status">conferindo as sessões…</span></section>;

  return (
    <section className="vivo-faixa" aria-label="Equipe ao vivo">
      {members.map((m) => {
        const lista = porPessoa.get(m.id) ?? [];
        const noWeb = web.includes(m.id);
        return (
          <div className="vivo-pessoa" key={m.id}>
            <div className="vivo-pessoa__nome">
              <Disco textura={texturaDe(m)} inicial={m.nome[0]} size={30} />
              <strong>{m.nome}</strong>
              {noWeb ? <small className="vazio-nota" title="Com o Convés aberto no navegador">no Convés</small> : null}
            </div>
            {lista.length
              ? <div className="vivo-pessoa__chips">{lista.map((s) => <SessaoChip key={s.id} s={s} dono={m} euId={me.id} />)}</div>
              : <small className="vazio-nota">sem sessão viva</small>}
          </div>
        );
      })}
      <Link className="vivo-faixa__mais" href="/aovivo">linha do tempo →</Link>
    </section>
  );
}

const VERBO: Record<Atividade["kind"], string> = { inicio: "começou", pedido: "pediu", arquivo: "editou", espera: "esperando", fim: "terminou", destilar: "destilar" };

/** Passos recentes de uma sessão (usado para acompanhar o runner da destilação). */
export function PassosDaSessao({ sessaoId }: { sessaoId: string }) {
  const { rows } = useTable<Atividade>("atividade", {
    filter: (q) => q.eq("sessao_id", sessaoId), order: { column: "created_at", ascending: false }, limit: 5, chave: sessaoId,
  });
  if (!rows.length) return null;
  return (
    <ol className="destilar-passos" aria-label="Últimos passos do runner">
      {rows.map((a) => <li key={a.id}><span className="mono">{VERBO[a.kind] ?? a.kind}</span> {a.texto}</li>)}
    </ol>
  );
}

/** Estado do botão Destilar: pedido → em andamento por X há Y → concluída com o resumo. */
export function DestilarEstado({ destilacoes, concluidos }: { destilacoes: Destilacao[]; concluidos: number }) {
  const { members } = useApp();
  const { vivas } = useSessoes();
  useTick(30000);
  const pedido = destilacoes.find((d) => !d.done_at && (!d.claimed_at || (Date.now() - new Date(d.claimed_at).getTime()) < 180 * 60000));
  const ultima = destilacoes.find((d) => d.done_at);
  const nome = (id: string | null) => members.find((m) => m.id === id)?.nome ?? "alguém";
  const runner = pedido ? vivas.find((s) => s.destilacao_id === pedido.id) : undefined;

  return (
    <>
      <small className="vazio-nota" role="status">
        {pedido
          ? pedido.claimed_at
            ? `em andamento por ${runner ? "o runner de " : ""}${nome(pedido.claimed_by)} ${ha(pedido.claimed_at)}`
            : `aguardando um Claude conectar · pedido de ${nome(pedido.requested_by)} ${ha(pedido.requested_at)}`
          : `${concluidos} concluído${concluidos === 1 ? "" : "s"} no quadro${ultima ? ` · última destilação ${ha(ultima.done_at)}` : ""}`}
      </small>
      {runner ? <PassosDaSessao sessaoId={runner.id} /> : null}
      {!pedido && ultima?.summary ? (
        <details className="destilar-resumo">
          <summary>concluída {ha(ultima.done_at)} · ver resumo</summary>
          <p>{ultima.summary}</p>
        </details>
      ) : null}
    </>
  );
}
