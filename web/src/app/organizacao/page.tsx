"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Icone } from "@/components/Defs";
import { Markdown } from "@/components/Markdown";
import { useApp } from "@/components/Shell";
import { useTable } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { tocar } from "@/lib/som";
import { ha, TIPOS_APRENDIZADO, type Card, type Decision, type Learning, type NoteFull, type NoteRow, type Review } from "@/lib/types";

const ROTULO_TIPO: Record<Learning["kind"], string> = { erro: "erro", preferencia: "preferência", padrao: "padrão", atalho: "atalho", regra: "regra" };

function Doc({ nota, titulo, aoAbrir }: { nota?: NoteFull; titulo: string; aoAbrir: (alvo: string) => void }) {
  if (!nota) return <div className="cartao"><p className="vazio-nota">{titulo}: ainda não existe.</p></div>;
  return (
    <section className="cartao col-x">
      <div className="linha" style={{ justifyContent: "space-between" }}>
        <h2 className="ficha__nome" style={{ fontSize: "1.5rem" }}>{titulo}</h2>
        <Link className="btn btn--chip btn--fantasma" href={`/notas?path=${encodeURIComponent(nota.path)}`}>Abrir no editor <Icone id="i-seta" /></Link>
      </div>
      <span className="vazio-nota">atualizado {ha(nota.updated_at)} · v{nota.version}</span>
      <Markdown texto={nota.body} aoAbrirNota={aoAbrir} />
    </section>
  );
}

export default function OrganizacaoPage() {
  const router = useRouter();
  const { members } = useApp();
  const { rows: docs } = useTable<NoteFull>("notes", {
    // só Regras e Mapa precisam do corpo; as demais notas de 00 Organização não são baixadas
    select: "id,path,title,tipo,owner,version,updated_at,updated_by,in_graph,deleted_at,body",
    filter: (q) => q.like("path", "00 Organização/%").is("deleted_at", null).or("path.like.%/Regras.md,path.like.%/Mapa.md"),
  });
  const { rows: todas } = useTable<NoteRow>("notes", { select: "id,path,title", filter: (q) => q.is("deleted_at", null) });
  const { rows: licoes } = useTable<Learning>("learnings", { order: { column: "created_at", ascending: false }, limit: 60 });
  const { rows: revisoes } = useTable<Review>("reviews", { order: { column: "created_at", ascending: false }, limit: 1 });
  const { rows: varreduras } = useTable<Decision>("decisions", { filter: (q) => q.eq("sweep_pending", true) });
  const { rows: concluidas } = useTable<Card>("cards", {
    filter: (q) => q.eq("status", "feito").is("archived_at", null).not("concluido_em", "is", null),
    order: { column: "concluido_em", ascending: false }, limit: 8,
  });

  const [filtro, setFiltro] = useState<Learning["kind"] | "todos">("todos");
  const [tipo, setTipo] = useState<Learning["kind"]>("padrao");
  const [texto, setTexto] = useState("");
  const [msg, setMsg] = useState("");

  const abrir = useCallback((alvo: string) => {
    const a = alvo.toLowerCase();
    const n = todas.find((x) => x.title.toLowerCase() === a);
    if (n) router.push(`/notas?path=${encodeURIComponent(n.path)}`); else tocar("erro");
  }, [todas, router]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) { tocar("erro"); return; }
    const { error } = await supabase.rpc("learn", { p_kind: tipo, p_text: texto.trim() });
    if (error) { tocar("erro"); setMsg(error.message); return; }
    setTexto(""); setMsg("Registrado. As IAs recebem no próximo digest.");
  }

  const visiveis = licoes.filter((l) => filtro === "todos" || l.kind === filtro);
  const regras = docs.find((d) => d.path.endsWith("Regras.md"));
  const mapa = docs.find((d) => d.path.endsWith("Mapa.md"));
  const nome = (id: string | null) => members.find((m) => m.id === id)?.nome ?? "IA";

  return (
    <>
      <div className="cab-pag">
        <div>
          <h1 className="titulo-pag">A organização <span className="editorial">da casa</span></h1>
          <p className="sub-pag">Como a vault se organiza, o mapa gerado sozinho e as lições que as IAs da equipe registram para não repetir erros.</p>
        </div>
      </div>

      <div className="org-corpo">
        <div className="col-x" style={{ gap: 28 }}>
          <Doc nota={regras} titulo="Regras" aoAbrir={abrir} />
          <Doc nota={mapa} titulo="Mapa da vault" aoAbrir={abrir} />
        </div>

        <aside className="col-x" style={{ gap: 20 }}>
          <section className="cartao revisao">
            <h2 className="ficha__nome" style={{ fontSize: "1.5rem" }}>Revisão diária</h2>
            {(() => {
              const r = revisoes[0];
              const horas = r ? (Date.now() - new Date(r.created_at).getTime()) / 3600000 : null;
              const pendente = horas === null || horas > 20 || varreduras.length > 0;
              return (
                <>
                  <div className="linha">
                    <span className={`carimbo carimbo--mini${pendente ? "" : " carimbo--ok"}`}>{pendente ? "pendente" : "em dia"}</span>
                    <span className="vazio-nota">{r ? `última ${ha(r.created_at)} por ${nome(r.member_id)}` : "nunca rodou"}</span>
                  </div>
                  {r?.summary ? <p style={{ fontSize: "0.9rem", lineHeight: 1.45 }}>{r.summary}</p> : null}
                  {varreduras.length ? (
                    <p className="vazio-nota"><strong>{varreduras.length} decisão(ões) aguardando varredura:</strong> {varreduras.map((d) => d.decision).join(" · ")}</p>
                  ) : null}
                  <p className="vazio-nota">Quem abrir o Claude Code primeiro roda <span className="revisao__cmd">/mcp__conves__revisao</span>: ele conclui o que já foi feito, varre as decisões pendentes e atualiza os arquivos da vault.</p>
                </>
              );
            })()}
            <span className="rotulo" style={{ marginTop: 6 }}>Concluídas recentes</span>
            <div>
              {concluidas.map((c) => (
                <div className="concl" key={c.id}>
                  <strong>{c.title}</strong>
                  <span>{c.resultado?.trim() || "concluída"}</span>
                  <small>{c.concluido_em ? ha(c.concluido_em) : ""}{c.concluido_por ? ` · ${nome(c.concluido_por)}` : ""}</small>
                </div>
              ))}
              {!concluidas.length ? <p className="vazio-nota">Nada concluído ainda.</p> : null}
            </div>
            <Link className="btn btn--chip btn--fantasma" href={`/notas?path=${encodeURIComponent("07 Quadro/Concluídas/" + new Date().toISOString().slice(0, 7) + ".md")}`}>Abrir a nota de concluídas do mês <Icone id="i-seta" /></Link>
          </section>

          <section className="cartao col-x">
            <h2 className="ficha__nome" style={{ fontSize: "1.5rem" }}>Aprendizados das IAs</h2>
            <p className="vazio-nota">O Claude registra com <code>log op=learn</code>; vocês também podem escrever aqui. O resumo entra no digest das sessões.</p>

            <form className="col-x" onSubmit={registrar}>
              <div className="abas" data-unico role="group" aria-label="Tipo de aprendizado">
                {TIPOS_APRENDIZADO.map((t) => (
                  <button key={t} type="button" className="btn btn--chip" aria-pressed={tipo === t} onClick={() => setTipo(t)}>{ROTULO_TIPO[t]}</button>
                ))}
              </div>
              <textarea className="campo" value={texto} onChange={(e) => { setTexto(e.target.value); setMsg(""); }} placeholder="Uma frase útil e atemporal." style={{ minHeight: 84 }} />
              <div className="linha">
                <button className="btn btn--primario" type="submit">Registrar</button>
                {msg ? <span className="vazio-nota" role="status">{msg}</span> : null}
              </div>
            </form>
          </section>

          <section className="cartao">
            <div className="abas" data-unico role="group" aria-label="Filtrar" style={{ marginBottom: 6 }}>
              <button className="btn btn--chip" type="button" aria-pressed={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos</button>
              {TIPOS_APRENDIZADO.map((t) => (
                <button key={t} className="btn btn--chip" type="button" aria-pressed={filtro === t} onClick={() => setFiltro(t)}>{ROTULO_TIPO[t]}</button>
              ))}
            </div>
            {visiveis.map((l) => (
              <article key={l.id} className="aprend">
                <p>{l.body}</p>
                <div className="aprend__meta">
                  <span className="etiqueta">{ROTULO_TIPO[l.kind]}</span>
                  <span>{nome(l.member_id)}</span><span>{ha(l.created_at)}</span>
                </div>
              </article>
            ))}
            {!visiveis.length ? <p className="vazio-nota" style={{ paddingTop: 12 }}>Nenhum aprendizado ainda. O primeiro que o Claude registrar aparece aqui.</p> : null}
          </section>
        </aside>
      </div>
    </>
  );
}
