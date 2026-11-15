"use client";
import Link from "next/link";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";
import { Amostra, Icone } from "@/components/Defs";
import { useApp } from "@/components/Shell";
import { useTable } from "@/lib/hooks";
import { FAMILIAS, familiaDe, ha, type LinkRow, type NoteRow } from "@/lib/types";

const W = 960;
const H = 640;

type N = SimulationNodeDatum & { id: string; path: string; title: string; tipo: string | null; owner: string | null; fam: string; textura: string; deg: number; r: number; version: number; updated_at: string };
type Aresta = { src: string; dst: string };

export default function GrafoPage() {
  const { members } = useApp();
  const { rows: notas, loading } = useTable<NoteRow>("notes", {
    select: "id,path,title,tipo,owner,version,updated_at,updated_by,in_graph,deleted_at",
    filter: (q) => q.eq("in_graph", true).is("deleted_at", null),
  });
  const { rows: links } = useTable<LinkRow>("links", { select: "src,dst,dst_title", filter: (q) => q.not("dst", "is", null) });

  const [aba, setAba] = useState<"grafo" | "lista">("grafo");
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [fam, setFam] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const [, setTick] = useState(0);
  const [dim, setDim] = useState({ w: W, h: H });
  const dimRef = useRef(dim);
  dimRef.current = dim;

  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<N, undefined> | null>(null);
  const nosRef = useRef<N[]>([]);
  const pos = useRef(new Map<string, { x: number; y: number }>());
  const tRef = useRef(t);
  tRef.current = t;
  const gesto = useRef<{ tipo: "no" | "pan"; id?: string; moveu: boolean; x0: number; y0: number; tx: number; ty: number } | null>(null);

  // grafo base: só links entre notas que estão no grafo
  const base = useMemo(() => {
    const ids = new Set(notas.map((n) => n.id));
    const arestas: Aresta[] = links
      .filter((l) => l.dst && ids.has(l.src) && ids.has(l.dst) && l.src !== l.dst)
      .map((l) => ({ src: l.src, dst: l.dst as string }));
    const dedup = [...new Map(arestas.map((a) => [`${a.src}>${a.dst}`, a])).values()];
    const deg = new Map<string, number>();
    dedup.forEach((a) => { deg.set(a.src, (deg.get(a.src) ?? 0) + 1); deg.set(a.dst, (deg.get(a.dst) ?? 0) + 1); });
    const nos = notas.map((n) => {
      const f = familiaDe(n.tipo);
      const d = deg.get(n.id) ?? 0;
      return { id: n.id, path: n.path, title: n.title, tipo: n.tipo, owner: n.owner, fam: f.id, textura: f.textura, deg: d, r: 8 + 2.4 * Math.sqrt(d), version: n.version, updated_at: n.updated_at } as N;
    });
    return { nos, arestas: dedup };
  }, [notas, links]);

  // simulação de forças
  const assinatura = base.nos.map((n) => n.id).sort().join() + "|" + base.arestas.length;
  useEffect(() => {
    if (!base.nos.length) return;
    const nos: N[] = base.nos.map((n) => ({ ...n, ...(pos.current.get(n.id) ?? {}) }));
    const arestas = base.arestas.map((a) => ({ source: a.src, target: a.dst }));
    const sim = forceSimulation<N>(nos)
      .force("link", forceLink<N, { source: string; target: string }>(arestas).id((d) => d.id).distance(120).strength(0.35))
      .force("charge", forceManyBody<N>().strength(-720))
      .force("center", forceCenter(dimRef.current.w / 2, dimRef.current.h / 2))
      .force("colide", forceCollide<N>().radius((d) => d.r + 22));
    sim.on("tick", () => {
      nos.forEach((n) => pos.current.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 }));
      setTick((x) => x + 1);
    });
    simRef.current = sim;
    nosRef.current = nos;
    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  // o SVG acompanha o tamanho real do contêiner (nada de grafo espremido)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.height > 50) setDim({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aba]);
  useEffect(() => {
    simRef.current?.force("center", forceCenter(dim.w / 2, dim.h / 2));
    simRef.current?.alpha(0.3).restart();
  }, [dim.w, dim.h]);

  // zoom com a roda (listener nativo para poder impedir a rolagem da página)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * dimRef.current.w;
      const py = ((e.clientY - r.top) / r.height) * dimRef.current.h;
      const cur = tRef.current;
      const k = Math.min(3, Math.max(0.35, cur.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const gx = (px - cur.x) / cur.k, gy = (py - cur.y) / cur.k;
      setT({ k, x: px - gx * k, y: py - gy * k });
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  }, [aba]);

  const nos = nosRef.current.length ? nosRef.current : base.nos;
  const porId = useMemo(() => new Map(nos.map((n) => [n.id, n])), [nos]);
  const vizinhos = useMemo(() => {
    const m = new Map<string, Set<string>>();
    base.arestas.forEach((a) => {
      if (!m.has(a.src)) m.set(a.src, new Set());
      if (!m.has(a.dst)) m.set(a.dst, new Set());
      m.get(a.src)!.add(a.dst); m.get(a.dst)!.add(a.src);
    });
    return m;
  }, [base]);

  const foco = hover ?? sel;
  const iso: Set<string> | null = useMemo(() => {
    if (foco) return new Set([foco, ...(vizinhos.get(foco) ?? [])]);
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      return new Set(base.nos.filter((n) => n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)).map((n) => n.id));
    }
    if (fam) return new Set(base.nos.filter((n) => n.fam === fam).map((n) => n.id));
    return null;
  }, [foco, busca, fam, vizinhos, base]);

  function ponto(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    return { px: ((e.clientX - r.left) / r.width) * dimRef.current.w, py: ((e.clientY - r.top) / r.height) * dimRef.current.h };
  }

  function aoApertar(e: React.PointerEvent<SVGSVGElement>) {
    const alvo = (e.target as Element).closest("[data-id]");
    const { px, py } = ponto(e);
    svgRef.current!.setPointerCapture(e.pointerId);
    if (alvo) {
      gesto.current = { tipo: "no", id: alvo.getAttribute("data-id")!, moveu: false, x0: e.clientX, y0: e.clientY, tx: 0, ty: 0 };
    } else {
      gesto.current = { tipo: "pan", moveu: false, x0: px, y0: py, tx: tRef.current.x, ty: tRef.current.y };
    }
  }
  function aoMover(e: React.PointerEvent<SVGSVGElement>) {
    const g = gesto.current;
    if (!g) return;
    const { px, py } = ponto(e);
    if (g.tipo === "pan") {
      g.moveu = true;
      setT({ k: tRef.current.k, x: g.tx + (px - g.x0), y: g.ty + (py - g.y0) });
      return;
    }
    if (!g.moveu && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 4) return;
    g.moveu = true;
    const n = nosRef.current.find((x) => x.id === g.id);
    if (!n) return;
    const cur = tRef.current;
    n.fx = (px - cur.x) / cur.k; n.fy = (py - cur.y) / cur.k;
    simRef.current?.alphaTarget(0.3).restart();
  }
  function aoSoltar() {
    const g = gesto.current;
    gesto.current = null;
    if (!g) return;
    if (g.tipo === "no") {
      const n = nosRef.current.find((x) => x.id === g.id);
      if (n) { n.fx = null; n.fy = null; }
      simRef.current?.alphaTarget(0);
      if (!g.moveu) setSel((s) => (s === g.id ? null : g.id!));
    } else if (!g.moveu) setSel(null);
  }

  const selNo = sel ? porId.get(sel) : undefined;
  const entradas = sel ? base.arestas.filter((a) => a.dst === sel).map((a) => porId.get(a.src)).filter(Boolean) as N[] : [];
  const saidas = sel ? base.arestas.filter((a) => a.src === sel).map((a) => porId.get(a.dst)).filter(Boolean) as N[] : [];
  const dono = (id: string | null) => members.find((m) => m.id === id)?.nome;
  void dono;

  return (
    <>
      <div className="cab-pag">
        <div>
          <h1 className="titulo-pag">O mapa do <span className="editorial">que sabemos</span></h1>
          <p className="sub-pag">{base.nos.length} notas, {base.arestas.length} ligações. Cada <code>[[link]]</code> entre notas vira uma linha; quanto mais ligada, maior o círculo.</p>
        </div>
        <div className="abas" data-unico role="group" aria-label="Visão">
          <button className="btn btn--chip" type="button" aria-pressed={aba === "grafo"} onClick={() => setAba("grafo")}><Icone id="i-grafo" />Grafo</button>
          <button className="btn btn--chip" type="button" aria-pressed={aba === "lista"} onClick={() => setAba("lista")}><Icone id="i-lista" />Lista</button>
        </div>
      </div>

      <div className="linha" style={{ marginBottom: 18 }}>
        <label style={{ flex: "1 1 260px", maxWidth: 380 }}>
          <span className="sr-only">Buscar no grafo</span>
          <input className="campo" type="search" placeholder="Buscar nota…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>

      <div className="legenda" role="group" aria-label="Tipos de nota (clique para isolar)">
        {FAMILIAS.map((f) => (
          <button key={f.id} type="button" className="btn btn--chip" aria-pressed={fam === f.id} onClick={() => setFam(fam === f.id ? null : f.id)}>
            <Amostra textura={f.textura} w={28} h={16} />{f.nome}
          </button>
        ))}
      </div>

      <div className="grafo-corpo">
        <div className="cartao grafo-fig">
          {loading ? <p className="rotulo" style={{ padding: 20 }} role="status">carregando…</p> : null}
          {aba === "grafo" ? (
            <>
              <div className="grafo-ctl">
                <button className="btn btn--chip btn--icone" type="button" aria-label="Centralizar" title="Centralizar" onClick={() => setT({ x: 0, y: 0, k: 1 })}><Icone id="i-alvo" /></button>
                <button className="btn btn--chip" type="button" onClick={() => simRef.current?.alpha(1).restart()}>Reorganizar</button>
              </div>
              <svg
                ref={svgRef} className={`grafo-svg${iso ? " grafo--isolando" : ""}`} viewBox={`0 0 ${dim.w} ${dim.h}`}
                data-arrastando={gesto.current?.tipo === "pan" && gesto.current.moveu ? "" : undefined}
                onPointerDown={aoApertar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}
                role="img" aria-label="Grafo de notas ligadas por links"
              >
                <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
                  {base.arestas.map((a) => {
                    const s = porId.get(a.src), d = porId.get(a.dst);
                    if (!s || !d) return null;
                    return <line key={`${a.src}>${a.dst}`} className="g-aresta" x1={s.x ?? dim.w / 2} y1={s.y ?? dim.h / 2} x2={d.x ?? dim.w / 2} y2={d.y ?? dim.h / 2}
                      data-iso={iso && iso.has(a.src) && iso.has(a.dst) ? "" : undefined} />;
                  })}
                  {nos.map((n) => {
                    const x = n.x ?? dim.w / 2, y = n.y ?? dim.h / 2;
                    return (
                      <g key={n.id} className="g-no" data-id={n.id} data-iso={iso?.has(n.id) ? "" : undefined} transform={`translate(${x} ${y})`}
                        tabIndex={0} role="button" aria-label={`${n.title}, ${n.deg} ligações`}
                        onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(n.id); } }}>
                        <circle r={n.r} cy={3.5} fill="var(--tinta)" />
                        <circle className="face" r={n.r} fill={`url(#${n.textura})`} />
                        {sel === n.id ? <circle className="g-formigas" r={n.r + 7} /> : null}
                        <text className="g-rotulo" y={n.r + 15}>{n.title.length > 28 ? n.title.slice(0, 27) + "…" : n.title}</text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </>
          ) : (
            <div className="tabela-rolagem" style={{ maxHeight: 640 }}>
              <table className="tabela">
                <thead><tr><th>Nota</th><th>Tipo</th><th className="num">Entra</th><th className="num">Sai</th><th>Atualizada</th></tr></thead>
                <tbody>
                  {[...base.nos].sort((a, b) => b.deg - a.deg).map((n) => (
                    <tr key={n.id} aria-selected={sel === n.id}>
                      <td><button className="linha-btn" type="button" onClick={() => setSel(n.id)}>{n.title}</button></td>
                      <td><span className="sit"><Amostra textura={n.textura} w={22} h={12} />{n.tipo ?? "—"}</span></td>
                      <td className="num">{base.arestas.filter((a) => a.dst === n.id).length}</td>
                      <td className="num">{base.arestas.filter((a) => a.src === n.id).length}</td>
                      <td>{ha(n.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="cartao ficha" aria-live="polite">
          {selNo ? (
            <>
              <span className="rotulo">{selNo.tipo ?? "nota"}{selNo.owner ? ` · ${selNo.owner}` : ""}</span>
              <h2 className="ficha__nome">{selNo.title}</h2>
              <dl>
                <div><dt>Caminho</dt><dd style={{ fontFamily: "var(--f-dados)", fontSize: "0.75rem" }}>{selNo.path}</dd></div>
                <div><dt>Versão</dt><dd>v{selNo.version}</dd></div>
                <div><dt>Atualizada</dt><dd>{ha(selNo.updated_at)}</dd></div>
                <div><dt>Ligações</dt><dd>{entradas.length} entram · {saidas.length} saem</dd></div>
              </dl>
              {saidas.length ? <div className="col-x"><span className="rotulo">Aponta para</span><div className="backlinks">{saidas.map((n) => <button key={n.id} className="btn btn--chip" type="button" onClick={() => setSel(n.id)}>{n.title}</button>)}</div></div> : null}
              {entradas.length ? <div className="col-x"><span className="rotulo">Citada por</span><div className="backlinks">{entradas.map((n) => <button key={n.id} className="btn btn--chip" type="button" onClick={() => setSel(n.id)}>{n.title}</button>)}</div></div> : null}
              <div><Link className="btn btn--primario" href={`/notas?path=${encodeURIComponent(selNo.path)}`}>Abrir nota <Icone id="i-seta" /></Link></div>
            </>
          ) : (
            <div className="ficha__vazio">
              <span className="carimbo">escolha um nó</span>
              <h2 className="ficha__nome">Clique numa nota</h2>
              <p className="ficha__nota">Passe o mouse para isolar a vizinhança, arraste os nós, use a roda para aproximar e arraste o fundo para mover. Em &quot;Lista&quot; está a mesma informação em tabela.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
