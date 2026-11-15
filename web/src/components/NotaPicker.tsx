"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ha, type NoteRow } from "@/lib/types";
import { Icone } from "./Defs";

const pasta = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "raiz");

/** Seletor de nota com busca: recentes primeiro, filtra ao digitar, setas + Enter. */
export function NotaPicker({ notas, aoEscolher }: { notas: NoteRow[]; aoEscolher: (id: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);

  const itens = useMemo(() => {
    const base = notas.filter((n) => !n.path.startsWith("Templates/"));
    const t = q.trim().toLowerCase();
    if (!t) return [...base].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 8);
    return base
      .filter((n) => n.title.toLowerCase().includes(t) || n.path.toLowerCase().includes(t))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(t)) - Number(a.title.toLowerCase().startsWith(t)))
      .slice(0, 30);
  }, [notas, q]);

  useEffect(() => setAtivo(0), [q, aberto]);
  useEffect(() => {
    lista.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [ativo]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function escolher(n: NoteRow) { setAberto(false); setQ(""); aoEscolher(n.id); }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(i + 1, itens.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (itens[ativo]) escolher(itens[ativo]); }
    else if (e.key === "Escape") { e.stopPropagation(); setAberto(false); }
  }

  return (
    <div className="picker" ref={caixa}>
      <button className="btn btn--chip btn--fantasma" type="button" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <Icone id="i-lupa" />Anexar nota existente
      </button>
      {aberto ? (
        <div className="picker__caixa" role="dialog" aria-label="Escolher nota">
          <input className="campo" autoFocus type="search" placeholder="Buscar por título ou pasta…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={teclas} role="combobox" aria-expanded="true" aria-controls="picker-lista" />
          <span className="picker__dica">{q.trim() ? `${itens.length} resultado(s)` : "mais recentes"}</span>
          <ul id="picker-lista" role="listbox" ref={lista} className="picker__lista">
            {itens.map((n, i) => (
              <li key={n.id} role="option" aria-selected={i === ativo} onMouseEnter={() => setAtivo(i)} onMouseDown={(e) => { e.preventDefault(); escolher(n); }}>
                <strong>{n.title}</strong>
                <span>{pasta(n.path)} · {ha(n.updated_at)}</span>
              </li>
            ))}
            {!itens.length ? <li className="picker__vazio">Nenhuma nota encontrada.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
