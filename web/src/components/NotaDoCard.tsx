"use client";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useTable } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { tocar } from "@/lib/som";
import type { Card, NoteRow } from "@/lib/types";
import { NotaEditor } from "./NotaEditor";
import { NotaPicker } from "./NotaPicker";

const PASTA_CARDS = "07 Quadro";
const limpar = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

/** Seção "Nota (.md)" do card: cada card pode ter um markdown, arquivado na vault e espelhado (status, dono, prazo). */
export function NotaDoCard({ card, aoMudar }: { card: Card; aoMudar: () => void }) {
  const router = useRouter();
  const { rows: notas } = useTable<NoteRow>("notes", {
    select: "id,path,title,tipo,owner,version,updated_at,updated_by,in_graph,deleted_at",
    filter: (q) => q.is("deleted_at", null), order: { column: "path" },
  });
  const nota = notas.find((n) => n.id === card.note_id);
  const titulos = useCallback(() => notas.map((n) => n.title), [notas]);
  const abrirTitulo = useCallback((alvo: string) => {
    const n = notas.find((x) => x.title.toLowerCase() === alvo.toLowerCase());
    if (n) router.push(`/notas?path=${encodeURIComponent(n.path)}`); else tocar("erro");
  }, [notas, router]);

  async function anexar(id: string | null) {
    const { error } = await supabase.from("cards").update({ note_id: id }).eq("id", card.id);
    if (error) tocar("erro"); else aoMudar();
  }

  async function gravar(caminho: string, corpo: string) {
    let p = caminho;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { data, error } = await supabase.rpc("upsert_note", { p_path: p, p_body: corpo, p_base_version: null });
      if (error) return null;
      if (!data.conflict) return data.note as NoteRow;
      p = p.replace(/\.md$/, ` ${Date.now() % 100000}.md`); // já existe uma nota com esse nome
    }
    return null;
  }

  async function criar() {
    const nome = limpar(card.title) || "Tarefa";
    const corpo = `---\ntipo: tarefa\ncard: ${card.id}\n---\n# ${card.title}\n\n${card.body}\n`;
    const n = await gravar(`${PASTA_CARDS}/${nome}.md`, corpo);
    if (!n) { tocar("erro"); return; }
    await anexar(n.id);
  }

  async function importar(f: File) {
    if (!f.name.toLowerCase().endsWith(".md")) { tocar("erro"); return; }
    const n = await gravar(`${PASTA_CARDS}/${f.name}`, await f.text());
    if (!n) { tocar("erro"); return; }
    await anexar(n.id);
  }

  return (
    <section className="nota-card" aria-label="Nota do card">
      <span className="rotulo">Nota (.md)</span>
      {nota ? (
        <>
          <p className="nota-pasta">{nota.path}</p>
          <NotaEditor key={nota.path} caminho={nota.path} compacto titulos={titulos} aoAbrirTitulo={abrirTitulo} aoMovida={() => aoMudar()} />
          <div className="linha">
            <button className="btn btn--chip btn--fantasma" type="button" onClick={() => router.push(`/notas?path=${encodeURIComponent(nota.path)}`)}>Abrir na vault</button>
            <button className="btn btn--chip btn--fantasma" type="button" onClick={() => anexar(null)}>Desanexar</button>
          </div>
        </>
      ) : (
        <>
          <p className="vazio-nota">Sem nota. Crie uma, anexe uma existente ou importe um .md: ele é arquivado em <code>{PASTA_CARDS}</code> e o status do card passa a espelhar o frontmatter.</p>
          <div className="linha">
            <button className="btn btn--chip btn--primario" type="button" onClick={criar}>Criar nota</button>
            <label className="btn btn--chip btn--fantasma" style={{ cursor: "pointer" }}>
              Importar .md
              <input type="file" accept=".md,text/markdown" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importar(f); e.target.value = ""; }} />
            </label>
          </div>
          <NotaPicker notas={notas} aoEscolher={(id) => void anexar(id)} />
        </>
      )}
    </section>
  );
}
