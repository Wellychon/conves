"use client";
import { Fragment, type ReactNode } from "react";

/** Prévia markdown mínima e segura (sem HTML cru): títulos, listas, tabelas, código, negrito, [[wikilinks]]. */
export function Markdown({ texto, aoAbrirNota }: { texto: string; aoAbrirNota: (alvo: string) => void }) {
  let corpo = texto;
  let front: string | null = null;
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) { front = m[1]; corpo = texto.slice(m[0].length); }

  const inline = (s: string, chave: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((p, i) => {
      const k = `${chave}-${i}`;
      if (p.startsWith("**")) return <strong key={k}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("`")) return <code key={k}>{p.slice(1, -1)}</code>;
      if (p.startsWith("[[")) {
        const [alvo, rotulo] = p.slice(2, -2).split("|");
        return <button key={k} type="button" className="linha-btn" onClick={() => aoAbrirNota(alvo.split("#")[0].trim())}>{(rotulo ?? alvo).trim()}</button>;
      }
      const l = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (l) return <a key={k} href={l[2]} target="_blank" rel="noreferrer noopener">{l[1]}</a>;
      return <Fragment key={k}>{p}</Fragment>;
    });

  const linhas = corpo.split(/\r?\n/);
  const blocos: ReactNode[] = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    const k = `b${i}`;
    if (l.startsWith("```")) {
      const cod: string[] = [];
      i++;
      while (i < linhas.length && !linhas[i].startsWith("```")) cod.push(linhas[i++]);
      i++;
      blocos.push(<pre key={k} className="md-codigo"><code>{cod.join("\n")}</code></pre>);
    } else if (/^\|.*\|\s*$/.test(l)) {
      const tab: string[] = [];
      while (i < linhas.length && /^\|.*\|\s*$/.test(linhas[i])) tab.push(linhas[i++]);
      const cel = (s: string) => s.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
      const [cab, , ...resto] = tab;
      blocos.push(
        <div className="tabela-rolagem" key={k}><table className="tabela">
          <thead><tr>{cel(cab).map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
          <tbody>{resto.map((r, j) => <tr key={j}>{cel(r).map((c, n) => <td key={n}>{inline(c, `${k}r${j}c${n}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
    } else if (/^#{1,3}\s/.test(l)) {
      const n = l.match(/^#+/)![0].length;
      const t = inline(l.replace(/^#+\s*/, ""), k);
      blocos.push(n === 1 ? <h1 key={k} className="md-h1">{t}</h1> : n === 2 ? <h2 key={k} className="md-h2">{t}</h2> : <h3 key={k} className="md-h3">{t}</h3>);
      i++;
    } else if (/^\s*([-*]|\d+\.)\s/.test(l)) {
      const itens: string[] = [];
      while (i < linhas.length && /^\s*([-*]|\d+\.)\s/.test(linhas[i])) itens.push(linhas[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      blocos.push(<ul key={k} className="md-lista">{itens.map((t, j) => <li key={j}>{inline(t, `${k}i${j}`)}</li>)}</ul>);
    } else if (l.startsWith(">")) {
      const q: string[] = [];
      while (i < linhas.length && linhas[i].startsWith(">")) q.push(linhas[i++].replace(/^>\s?/, ""));
      blocos.push(<blockquote key={k} className="ficha__nota">{inline(q.join(" "), k)}</blockquote>);
    } else if (l.trim() === "") {
      i++;
    } else {
      const p: string[] = [];
      while (i < linhas.length && linhas[i].trim() !== "" && !/^(#{1,3}\s|```|>|\||\s*([-*]|\d+\.)\s)/.test(linhas[i])) p.push(linhas[i++]);
      blocos.push(<p key={k} className="md-p">{inline(p.join(" "), k)}</p>);
    }
  }

  return (
    <div className="md">
      {front ? <details className="md-front"><summary className="rotulo">propriedades</summary><pre className="md-codigo"><code>{front}</code></pre></details> : null}
      {blocos}
    </div>
  );
}
