"use client";
// Editor markdown "ao vivo" (estilo Obsidian) sobre CodeMirror 6.
// O texto é sempre markdown puro; a "prévia" é só decoração: marcadores somem fora da linha do cursor.
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Annotation, EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { useEffect, useRef } from "react";

const externo = Annotation.define<boolean>();

/** Separa o bloco `---` (propriedades) do corpo. O editor só mexe no corpo. */
export function separarFrontmatter(texto: string) {
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? { fm: m[1], corpo: texto.slice(m[0].length) } : { fm: "", corpo: texto };
}
export function juntarFrontmatter(fm: string, corpo: string) {
  return fm.trim() ? `---\n${fm.trim()}\n---\n${corpo}` : corpo;
}

class Ponto extends WidgetType {
  toDOM() { const s = document.createElement("span"); s.className = "cm-bullet"; s.textContent = "◆"; return s; }
  eq(o: WidgetType) { return o instanceof Ponto; }
}
class Caixa extends WidgetType {
  constructor(readonly marcado: boolean) { super(); }
  eq(o: WidgetType) { return o instanceof Caixa && o.marcado === this.marcado; }
  toDOM(view: EditorView) {
    const b = document.createElement("input");
    b.type = "checkbox"; b.checked = this.marcado; b.className = "cm-check"; b.setAttribute("aria-label", "tarefa");
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(b);
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.marcado ? " " : "x" } });
    });
    return b;
  }
  ignoreEvent() { return false; }
}

const esconde = Decoration.replace({});

function linhaAtiva(state: EditorState, from: number, to: number) {
  const l1 = state.doc.lineAt(from).number, l2 = state.doc.lineAt(Math.min(to, state.doc.length)).number;
  return state.selection.ranges.some((r) => {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
    return a <= l2 && b >= l1;
  });
}

function construir(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const linha = (cls: string, pos: number) => out.push(Decoration.line({ class: cls }).range(pos));
  const marca = (cls: string, from: number, to: number, attrs?: Record<string, string>) =>
    from < to && out.push(Decoration.mark({ class: cls, attributes: attrs }).range(from, to));
  const some = (from: number, to: number) => from < to && out.push(esconde.range(from, to));
  const eachLine = (from: number, to: number, cls: string) => {
    for (let p = from; p <= to;) { const l = state.doc.lineAt(p); linha(cls, l.from); p = l.to + 1; }
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (n) => {
        const nome = n.name;
        const ativa = () => linhaAtiva(state, n.from, n.to);
        const h = nome.match(/^ATXHeading([1-6])$/);
        if (h) { linha(`cm-h${h[1]}`, state.doc.lineAt(n.from).from); return; }
        switch (nome) {
          case "HeaderMark": {
            if (ativa()) { marca("cm-dim", n.from, n.to); break; }
            const l = state.doc.lineAt(n.from);
            some(n.from, Math.min(n.to + 1, l.to));
            break;
          }
          case "StrongEmphasis": marca("cm-strong", n.from, n.to); break;
          case "Emphasis": marca("cm-em", n.from, n.to); break;
          case "Strikethrough": marca("cm-riscado", n.from, n.to); break;
          case "EmphasisMark": case "StrikethroughMark":
            ativa() ? marca("cm-dim", n.from, n.to) : some(n.from, n.to); break;
          case "InlineCode": marca("cm-icode", n.from, n.to); break;
          case "CodeMark":
            if (n.node.parent?.name === "InlineCode") ativa() ? marca("cm-dim", n.from, n.to) : some(n.from, n.to);
            else marca("cm-dim", n.from, n.to);
            break;
          case "Link": marca("cm-link", n.from, n.to); break;
          case "LinkMark": case "URL":
            if (n.node.parent?.name === "Link") ativa() ? marca("cm-dim", n.from, n.to) : some(n.from, n.to);
            break;
          case "Blockquote": eachLine(n.from, n.to, "cm-quote"); break;
          case "QuoteMark": {
            if (ativa()) { marca("cm-dim", n.from, n.to); break; }
            some(n.from, Math.min(n.to + 1, state.doc.lineAt(n.from).to));
            break;
          }
          case "ListMark": {
            const pai = n.node.parent;
            if (pai?.parent?.name === "OrderedList") { marca("cm-ordem", n.from, n.to); break; }
            if (ativa()) { marca("cm-dim", n.from, n.to); break; }
            const tarefa = pai?.getChild("Task");
            const fim = Math.min(n.to + 1, state.doc.lineAt(n.from).to);
            if (tarefa) some(n.from, fim);
            else out.push(Decoration.replace({ widget: new Ponto() }).range(n.from, fim));
            break;
          }
          case "TaskMarker": {
            const marcado = /x/i.test(state.sliceDoc(n.from, n.to));
            out.push(Decoration.replace({ widget: new Caixa(marcado) }).range(n.from, n.to));
            if (marcado) marca("cm-feito", n.to, state.doc.lineAt(n.to).to);
            break;
          }
          case "FencedCode": eachLine(n.from, n.to, "cm-codeblock"); break;
          case "HorizontalRule": linha("cm-hr", state.doc.lineAt(n.from).from); if (!ativa()) some(n.from, n.to); break;
          case "Table": eachLine(n.from, n.to, "cm-tabela"); break;
        }
      },
    });

    // [[wikilinks]] e #tags (não existem no parser markdown): regex nas linhas visíveis
    for (let p = from; p <= to;) {
      const l = state.doc.lineAt(p);
      const t = l.text;
      for (const m of t.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
        const ini = l.from + m.index!, fim = ini + m[0].length;
        const [alvo, rotulo] = m[1].split("|");
        const alvoLimpo = alvo.split("#")[0].trim();
        if (linhaAtiva(state, ini, fim)) {
          marca("cm-wikilink", ini, fim, { "data-alvo": alvoLimpo });
        } else if (rotulo !== undefined) {
          some(ini, ini + 2 + alvo.length + 1);
          marca("cm-wikilink", ini + 2 + alvo.length + 1, fim - 2, { "data-alvo": alvoLimpo });
          some(fim - 2, fim);
        } else {
          some(ini, ini + 2);
          marca("cm-wikilink", ini + 2, fim - 2, { "data-alvo": alvoLimpo });
          some(fim - 2, fim);
        }
      }
      for (const m of t.matchAll(/(^|\s)(#[\p{L}\d_-]+)/gu)) {
        const ini = l.from + m.index! + m[1].length;
        marca("cm-tag", ini, ini + m[2].length);
      }
      p = l.to + 1;
    }
  }
  return Decoration.set(out, true);
}

/* ---------- tabelas: viram <table> de verdade; o markdown aparece quando o cursor entra nelas ---------- */
const celulas = (linha: string) => linha.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** **negrito**, *itálico*, `código` e [[links]] dentro de uma célula, sem innerHTML. */
function inlineDom(texto: string): Node[] {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\*[^*\n]+\*)/g).filter(Boolean).map((p) => {
    if (p.startsWith("**")) { const e = document.createElement("strong"); e.textContent = p.slice(2, -2); return e; }
    if (p.startsWith("`")) { const e = document.createElement("code"); e.className = "cm-icode"; e.textContent = p.slice(1, -1); return e; }
    if (p.startsWith("[[")) {
      const [alvo, rotulo] = p.slice(2, -2).split("|");
      const e = document.createElement("span"); e.className = "cm-wikilink"; e.setAttribute("data-alvo", alvo.split("#")[0].trim());
      e.textContent = (rotulo ?? alvo).trim(); return e;
    }
    if (p.startsWith("*") && p.length > 2) { const e = document.createElement("em"); e.className = "cm-em"; e.textContent = p.slice(1, -1); return e; }
    return document.createTextNode(p);
  });
}

class TabelaWidget extends WidgetType {
  constructor(readonly fonte: string, readonly ini: number) { super(); }
  eq(o: WidgetType) { return o instanceof TabelaWidget && o.fonte === this.fonte && o.ini === this.ini; }
  toDOM(view: EditorView) {
    const linhas = this.fonte.split("\n").filter((l) => l.trim());
    const cab = celulas(linhas[0] ?? "");
    const alinha = celulas(linhas[1] ?? "").map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : "left"));
    const corpo = linhas.slice(2).map(celulas);
    const caixa = document.createElement("div");
    caixa.className = "cm-tabela-w";
    caixa.title = "Clique para editar a tabela";
    const tabela = document.createElement("table");
    const preencher = (tr: HTMLTableRowElement, cels: string[], tag: "th" | "td") => {
      cels.forEach((c, i) => {
        const td = document.createElement(tag);
        td.style.textAlign = alinha[i] ?? "left";
        inlineDom(c).forEach((n) => td.appendChild(n));
        tr.appendChild(td);
      });
    };
    if (cab.some((c) => c)) { // cabeçalho vazio (| | |) não vira linha vazia
      const th = tabela.createTHead().insertRow();
      preencher(th, cab, "th");
    }
    const tb = tabela.createTBody();
    corpo.forEach((r) => preencher(tb.insertRow(), r, "td"));
    caixa.appendChild(tabela);
    caixa.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest(".cm-wikilink")) return; // o link abre a nota
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.ini } });
      view.focus();
    });
    return caixa;
  }
  ignoreEvent() { return false; }
}

function construirTabelas(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const arvore = ensureSyntaxTree(state, state.doc.length, 60) ?? syntaxTree(state);
  arvore.iterate({
    enter: (n) => {
      if (n.name !== "Table") return;
      const dentro = state.selection.ranges.some((r) => r.from <= n.to && r.to >= n.from);
      if (!dentro) out.push(Decoration.replace({ widget: new TabelaWidget(state.sliceDoc(n.from, n.to), n.from), block: true }).range(n.from, n.to));
      return false;
    },
  });
  return Decoration.set(out, true);
}

const tabelas = StateField.define<DecorationSet>({
  create: (state) => construirTabelas(state),
  update: (v, tr) => (tr.docChanged || tr.selection ? construirTabelas(tr.state) : v),
  provide: (f) => EditorView.decorations.from(f),
});

function previa(aoAbrir: (alvo: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = construir(view); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState)) {
          this.decorations = construir(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e, view) {
          const el = (e.target as HTMLElement).closest?.(".cm-wikilink");
          if (!el) return false;
          const pos = view.posAtDOM(el);
          if (e.metaKey || e.ctrlKey || !linhaAtiva(view.state, pos, pos)) {
            e.preventDefault();
            aoAbrir(el.getAttribute("data-alvo") ?? "");
            return true;
          }
          return false;
        },
      },
    },
  );
}

type Props = {
  valor: string;
  /** muda quando o texto foi trocado de fora (nuvem, outra nota): o editor adota `valor` */
  revisao: number;
  aoMudar: (texto: string) => void;
  aoAbrirLink: (alvo: string) => void;
  titulos: () => string[];
  /** false = modo fonte (sem decoração) */
  ao_vivo?: boolean;
  placeholder?: string;
};

export function EditorMd({ valor, revisao, aoMudar, aoAbrirLink, titulos, ao_vivo = true }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const ref = useRef({ valor, aoMudar, aoAbrirLink, titulos });
  ref.current = { valor, aoMudar, aoAbrirLink, titulos };

  useEffect(() => {
    if (!host.current) return;
    const fonteWiki = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n]*$/);
      if (!m) return null;
      return { from: m.from + 2, options: ref.current.titulos().map((t) => ({ label: t, apply: `${t}]]` })), validFor: /^[^\]\n]*$/ };
    };
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: ref.current.valor,
        extensions: [
          history(), drawSelection(), EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          autocompletion({ override: [fonteWiki], icons: false }),
          ...(ao_vivo ? [tabelas, previa((a) => ref.current.aoAbrirLink(a))] : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(externo))) ref.current.aoMudar(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": "Conteúdo da nota", spellcheck: "true", autocapitalize: "sentences" }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, [ao_vivo]);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === ref.current.valor) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ref.current.valor }, annotations: externo.of(true) });
  }, [revisao]);

  return <div ref={host} className={`editor-md${ao_vivo ? "" : " editor-md--fonte"}`} />;
}
