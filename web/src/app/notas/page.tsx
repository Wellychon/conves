"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icone } from "@/components/Defs";
import { NotaEditor } from "@/components/NotaEditor";
import { useTable } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { tocar } from "@/lib/som";
import { ha, type NoteRow } from "@/lib/types";

type No = { nome: string; caminho: string; pastas: Map<string, No>; notas: NoteRow[] };
const total = (no: No): number => no.notas.length + [...no.pastas.values()].reduce((s, p) => s + total(p), 0);

function montar(notas: NoteRow[]): No {
  const raiz: No = { nome: "", caminho: "", pastas: new Map(), notas: [] };
  for (const n of notas) {
    const partes = n.path.split("/");
    let no = raiz;
    for (let i = 0; i < partes.length - 1; i++) {
      if (!no.pastas.has(partes[i])) no.pastas.set(partes[i], { nome: partes[i], caminho: no.caminho ? `${no.caminho}/${partes[i]}` : partes[i], pastas: new Map(), notas: [] });
      no = no.pastas.get(partes[i])!;
    }
    no.notas.push(n);
  }
  return raiz;
}
// a pasta de organização fica sempre no topo
const ordem = (a: No, b: No) => (a.nome.startsWith("00 Organiza") ? -1 : b.nome.startsWith("00 Organiza") ? 1 : a.nome.localeCompare(b.nome, "pt", { numeric: true }));

function Pasta({ no, nivel, atual, aoAbrir, aoNova, aoSoltar }: {
  no: No; nivel: number; atual: string | null; aoAbrir: (p: string) => void;
  aoNova: (pasta: string) => void; aoSoltar: (pasta: string, e: React.DragEvent) => void;
}) {
  const contem = !!atual && atual.startsWith(no.caminho + "/");
  const [aberta, setAberta] = useState(nivel < 1 || contem);
  const [sobre, setSobre] = useState(false);
  const fixa = no.nome.startsWith("00 Organiza");
  return (
    <details className={fixa ? "fixa" : ""} open={aberta} onToggle={(e) => setAberta((e.currentTarget as HTMLDetailsElement).open)}>
      <summary
        className={sobre ? "alvo-solta" : ""}
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)}
        onDrop={(e) => { e.preventDefault(); setSobre(false); aoSoltar(no.caminho, e); }}
      >
        {no.nome}
        <span className="pasta-n">{total(no)}</span>
        <button className="pasta-mais" type="button" title={`Nova nota em ${no.nome}`} aria-label={`Nova nota em ${no.nome}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); aoNova(no.caminho); }}>+</button>
      </summary>
      <div className="filhos">
        {[...no.pastas.values()].sort(ordem).map((p) => <Pasta key={p.caminho} no={p} nivel={nivel + 1} atual={atual} aoAbrir={aoAbrir} aoNova={aoNova} aoSoltar={aoSoltar} />)}
        {no.notas.map((n) => (
          <button key={n.id} type="button" className="nota-item" draggable aria-current={n.path === atual}
            onDragStart={(e) => e.dataTransfer.setData("text/conves-path", n.path)} onClick={() => aoAbrir(n.path)}>{n.title}</button>
        ))}
      </div>
    </details>
  );
}

function Notas() {
  const router = useRouter();
  const params = useSearchParams();
  const caminho = params.get("path");

  const { rows: notas, reload } = useTable<NoteRow>("notes", {
    select: "id,path,title,tipo,owner,version,updated_at,updated_by,in_graph,deleted_at",
    filter: (q) => q.is("deleted_at", null), order: { column: "path" },
  });
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Set<string> | null>(null);
  const [soltando, setSoltando] = useState(false);

  useEffect(() => {
    const q = busca.trim();
    if (q.length < 3) { setAchados(null); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("notes").select("id").is("deleted_at", null).textSearch("tsv", q, { config: "portuguese", type: "websearch" });
      setAchados(new Set((data ?? []).map((n) => n.id as string)));
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  const arvore = useMemo(() => montar(notas), [notas]);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return null;
    return notas.filter((n) => n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || achados?.has(n.id));
  }, [notas, busca, achados]);

  const abrir = useCallback((p: string | null) => router.replace(p ? `/notas?path=${encodeURIComponent(p)}` : "/notas"), [router]);
  const titulos = useCallback(() => notas.map((n) => n.title), [notas]);
  const abrirPorTitulo = useCallback((alvo: string) => {
    const a = alvo.toLowerCase();
    const n = notas.find((x) => x.title.toLowerCase() === a || x.path.toLowerCase().replace(/\.md$/, "") === a);
    if (n) abrir(n.path); else tocar("erro");
  }, [notas, abrir]);

  async function gravarNova(p: string, body: string) {
    const { data, error } = await supabase.rpc("upsert_note", { p_path: p, p_body: body });
    if (error || data?.conflict) { tocar("erro"); return null; }
    return data.note.path as string;
  }

  async function nova(pasta: string) {
    const nome = window.prompt(`Nome da nota${pasta ? ` em "${pasta}"` : ""}`);
    if (!nome?.trim()) return;
    const limpo = nome.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/, "");
    const p = await gravarNova(`${pasta || "00 Inbox"}/${limpo}.md`, `# ${limpo}\n\n`);
    if (p) { reload(); abrir(p); }
  }

  async function importar(files: FileList | File[], pasta: string) {
    let ultimo: string | null = null;
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith(".md")) continue;
      const p = await gravarNova(`${pasta || "00 Inbox"}/${f.name}`, await f.text());
      if (p) ultimo = p;
    }
    if (ultimo) { reload(); abrir(ultimo); } else tocar("erro");
  }

  async function aoSoltar(pasta: string, e: React.DragEvent) {
    const origem = e.dataTransfer.getData("text/conves-path");
    if (origem) {
      const n = notas.find((x) => x.path === origem);
      const novo = `${pasta}/${origem.split("/").pop()}`;
      if (!n || novo === origem) return;
      const { data, error } = await supabase.rpc("move_note", { p_path: origem, p_new: novo, p_base_version: n.version });
      if (error || !data?.ok) { tocar("erro"); return; }
      reload();
      if (caminho === origem) abrir(novo);
    } else if (e.dataTransfer.files?.length) await importar(e.dataTransfer.files, pasta);
  }

  return (
    <>
      <div className="cab-pag">
        <div>
          <h1 className="titulo-pag">Notas <span className="editorial">compartilhadas</span></h1>
          <p className="sub-pag">{notas.length} notas. Escreva direto aqui, como no Obsidian: o que você digita chega ao outro sócio e ao Claude em segundos.</p>
        </div>
        <div className="linha">
          <label className="btn btn--fantasma" style={{ cursor: "pointer" }}>
            Importar .md
            <input type="file" accept=".md,text/markdown" multiple hidden onChange={(e) => { if (e.target.files) void importar(e.target.files, ""); e.target.value = ""; }} />
          </label>
          <button className="btn btn--primario" type="button" onClick={() => nova("")}><Icone id="i-mais" />Nova nota</button>
        </div>
      </div>

      <div className="notas-corpo">
        <div>
          <label style={{ display: "block", marginBottom: 14 }}>
            <span className="sr-only">Buscar notas</span>
            <input className="campo" type="search" placeholder="Buscar por título ou texto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
          <div className="cartao arvore" data-solta={soltando || undefined}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setSoltando(true); } }}
            onDragLeave={() => setSoltando(false)}
            onDrop={(e) => { if (e.dataTransfer.files?.length && !e.defaultPrevented) { e.preventDefault(); setSoltando(false); void importar(e.dataTransfer.files, ""); } }}>
            {filtradas ? (
              <>
                {filtradas.map((n) => (
                  <button key={n.id} type="button" className="nota-item" aria-current={n.path === caminho} onClick={() => abrir(n.path)}>
                    {n.title}<span className="nota-pasta">{n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "raiz"} · {ha(n.updated_at)}</span>
                  </button>
                ))}
                {!filtradas.length ? <p className="vazio-nota">Nada encontrado.</p> : null}
              </>
            ) : (
              <>
                {[...arvore.pastas.values()].sort(ordem).map((p) => <Pasta key={p.caminho} no={p} nivel={0} atual={caminho} aoAbrir={abrir} aoNova={nova} aoSoltar={aoSoltar} />)}
                {arvore.notas.map((n) => (
                  <button key={n.id} type="button" className="nota-item" draggable aria-current={n.path === caminho}
                    onDragStart={(e) => e.dataTransfer.setData("text/conves-path", n.path)} onClick={() => abrir(n.path)}>{n.title}</button>
                ))}
              </>
            )}
          </div>
          <p className="vazio-nota" style={{ marginTop: 10 }}>Arraste uma nota para uma pasta para movê-la; solte arquivos .md aqui para importar.</p>
        </div>

        <div>
          {caminho ? (
            <NotaEditor key={caminho} caminho={caminho} titulos={titulos} aoAbrirTitulo={abrirPorTitulo}
              aoMovida={(novo) => { reload(); abrir(novo); }} aoApagada={() => { reload(); abrir(null); }} />
          ) : (
            <div className="cartao ficha__vazio">
              <span className="carimbo">escolha uma nota</span>
              <h2 className="ficha__nome">Nenhuma nota aberta</h2>
              <p className="ficha__nota">Selecione uma nota na árvore, ou crie uma nova. Dica: nota nova no <code>00 Inbox</code> com <code>tipo:</code> no frontmatter é arquivada sozinha na pasta certa.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function NotasPage() {
  return <Suspense fallback={<p className="rotulo" role="status">carregando notas…</p>}><Notas /></Suspense>;
}
