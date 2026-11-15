"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { tocar } from "@/lib/som";
import { ha, type LinkRow, type NoteFull, type NoteRow } from "@/lib/types";
import { EditorMd, juntarFrontmatter, separarFrontmatter } from "./EditorMd";

type Estado = "salvo" | "salvando" | "sujo" | "conflito" | "erro";
const ROTULO: Record<Estado, string> = { salvo: "salvo", salvando: "salvando…", sujo: "editando…", conflito: "conflito", erro: "erro ao salvar" };

/** Editor de uma nota: markdown ao vivo, autosave com versão (nunca sobrescreve em silêncio), propriedades e backlinks. */
export function NotaEditor({ caminho, compacto = false, titulos, aoAbrirTitulo, aoMovida, aoApagada }: {
  caminho: string; compacto?: boolean; titulos: () => string[]; aoAbrirTitulo: (t: string) => void;
  aoMovida?: (novo: string) => void; aoApagada?: () => void;
}) {
  const [nota, setNota] = useState<NoteFull | null>(null);
  const [naoAchou, setNaoAchou] = useState(false);
  const [fm, setFm] = useState("");
  const [corpo, setCorpo] = useState("");
  const [rev, setRev] = useState(0);
  const [aoVivo, setAoVivo] = useState(true);
  const [estado, setEstado] = useState<Estado>("salvo");
  const [msg, setMsg] = useState("");
  const [citada, setCitada] = useState<NoteRow[]>([]);
  const [remota, setRemota] = useState<NoteFull | null>(null);

  const fmRef = useRef(fm); fmRef.current = fm;
  const corpoRef = useRef(corpo); corpoRef.current = corpo;
  const salvoRef = useRef("");
  const baseRef = useRef(0);
  const conflitoRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef({ aoMovida, caminho });
  cb.current = { aoMovida, caminho };

  const adotar = useCallback((n: NoteFull) => {
    const { fm: f, corpo: c } = separarFrontmatter(n.body);
    setNota(n); setFm(f); setCorpo(c); setRev((r) => r + 1);
    salvoRef.current = n.body; baseRef.current = n.version;
    conflitoRef.current = false; setRemota(null); setEstado("salvo"); setMsg("");
  }, []);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("notes").select("*").eq("path", caminho).is("deleted_at", null).maybeSingle();
    if (!data) { setNaoAchou(true); return; }
    setNaoAchou(false);
    const n = data as NoteFull;
    adotar(n);
    const { data: ls } = await supabase.from("links").select("src").eq("dst", n.id);
    const ids = ((ls ?? []) as Pick<LinkRow, "src">[]).map((l) => l.src);
    if (!ids.length) { setCitada([]); return; }
    const { data: ns } = await supabase.from("notes").select("id,path,title,tipo,owner,version,updated_at,updated_by,in_graph,deleted_at").in("id", ids).is("deleted_at", null);
    setCitada((ns ?? []) as NoteRow[]);
  }, [caminho, adotar]);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = useCallback(async () => {
    const texto = juntarFrontmatter(fmRef.current, corpoRef.current);
    if (texto === salvoRef.current || conflitoRef.current) return;
    setEstado("salvando");
    const { data, error } = await supabase.rpc("upsert_note", { p_path: cb.current.caminho, p_body: texto, p_base_version: baseRef.current });
    if (error) { tocar("erro"); setEstado("erro"); setMsg(error.message); return; }
    if (data.conflict) {
      tocar("erro"); conflitoRef.current = true; setRemota(data.note as NoteFull); setEstado("conflito");
      setMsg("Alguém salvou esta nota antes de você. Nada foi sobrescrito.");
      return;
    }
    const n = data.note as NoteFull;
    salvoRef.current = n.body; baseRef.current = n.version; setNota(n);
    const atual = juntarFrontmatter(fmRef.current, corpoRef.current);
    setEstado(atual === n.body ? "salvo" : "sujo");
    if (n.path !== cb.current.caminho) cb.current.aoMovida?.(n.path); // o servidor arquivou a nota na pasta certa
  }, []);

  const agendar = useCallback(() => {
    setEstado((e) => (e === "conflito" ? e : "sujo"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void salvar(), 900);
  }, [salvar]);

  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void salvar(); } }, [salvar]);

  // mudança vinda de fora (outra pessoa, o Claude pelo sync, o kanban)
  useEffect(() => {
    const canal = supabase.channel(`nota-${caminho}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notes", filter: `path=eq.${caminho}` }, (p) => {
        const n = p.new as NoteFull;
        if (n.version === baseRef.current || n.deleted_at) return;
        const limpo = juntarFrontmatter(fmRef.current, corpoRef.current) === salvoRef.current;
        if (limpo) adotar(n); else { conflitoRef.current = true; setRemota(n); setEstado("conflito"); setMsg("A nota mudou na nuvem enquanto você editava."); }
      }).subscribe();
    return () => { void supabase.removeChannel(canal); };
  }, [caminho, adotar]);

  if (naoAchou) return <div className="cartao"><p className="vazio-nota">Nota não encontrada: {caminho}</p></div>;
  if (!nota) return <div className="cartao"><p className="vazio-nota" role="status">carregando…</p></div>;

  return (
    <div className={`nota-ed${compacto ? " nota-ed--compacto" : ""}`}>
      <div className="nota-ed__cab">
        <div>
          <span className="rotulo">{nota.tipo ?? "nota"} · v{baseRef.current} · {ha(nota.updated_at)}</span>
          {!compacto ? <p className="nota-pasta" style={{ marginTop: 4 }}>{caminho}</p> : null}
        </div>
        <div className="linha" style={{ gap: 10 }}>
          <span className={`carimbo carimbo--mini${estado === "salvo" ? " carimbo--ok" : ""}`} role="status">{ROTULO[estado]}</span>
          <div className="abas" data-unico role="group" aria-label="Modo do editor">
            <button className="btn btn--chip" type="button" aria-pressed={aoVivo} onClick={() => setAoVivo(true)}>Ao vivo</button>
            <button className="btn btn--chip" type="button" aria-pressed={!aoVivo} onClick={() => setAoVivo(false)}>Fonte</button>
          </div>
        </div>
      </div>

      {remota ? (
        <div className="ficha__nota" role="alert">
          <strong>Há uma versão mais nova na nuvem (v{remota.version}).</strong> {msg}{" "}
          <button className="linha-btn" type="button" onClick={() => adotar(remota)}>Carregar a da nuvem</button>
          {" · "}
          <button className="linha-btn" type="button" onClick={() => { baseRef.current = remota.version; conflitoRef.current = false; setRemota(null); void salvar(); }}>Manter o meu texto</button>
        </div>
      ) : estado === "erro" ? <p className="ficha__nota" role="alert">{msg}</p> : null}

      <EditorMd valor={corpo} revisao={rev} ao_vivo={aoVivo} titulos={titulos}
        aoMudar={(t) => { setCorpo(t); corpoRef.current = t; agendar(); }} aoAbrirLink={aoAbrirTitulo} />

      <details className="nota-ed__props">
        <summary className="rotulo">propriedades</summary>
        <textarea className="campo" spellCheck={false} value={fm} aria-label="Propriedades (frontmatter)"
          onChange={(e) => { setFm(e.target.value); fmRef.current = e.target.value; agendar(); }} placeholder={"tipo: ideia\ndono: welly"} />
      </details>

      {citada.length ? (
        <div className="col-x">
          <span className="rotulo">Citada por</span>
          <div className="backlinks">{citada.map((n) => <button key={n.id} className="btn btn--chip" type="button" onClick={() => aoAbrirTitulo(n.title)}>{n.title}</button>)}</div>
        </div>
      ) : null}

      {aoApagada ? (
        <div>
          <button className="btn btn--fantasma btn--chip" type="button" onClick={async () => {
            if (!window.confirm("Apagar esta nota para todos?")) return;
            const { data, error } = await supabase.rpc("delete_note", { p_path: caminho, p_base_version: baseRef.current });
            if (error || !data?.ok) { tocar("erro"); setMsg(data?.conflict ? "A nota mudou antes de você apagar." : error?.message ?? "Não foi possível apagar."); setEstado("erro"); } else aoApagada();
          }}>Apagar nota</button>
        </div>
      ) : null}
    </div>
  );
}
