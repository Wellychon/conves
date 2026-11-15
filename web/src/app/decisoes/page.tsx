"use client";
import { useState } from "react";
import { Icone } from "@/components/Defs";
import { useApp } from "@/components/Shell";
import { useTable } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { tocar } from "@/lib/som";
import { dataCurta, type Decision } from "@/lib/types";

export default function DecisoesPage() {
  const { me } = useApp();
  const { rows, reload, erro } = useTable<Decision>("decisions", { order: { column: "decided_on", ascending: false } });
  const [aberto, setAberto] = useState(false);
  const [decisao, setDecisao] = useState("");
  const [porque, setPorque] = useState("");
  const [status, setStatus] = useState<Decision["status"]>("tomada");
  const [revisar, setRevisar] = useState("");
  const [varrer, setVarrer] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!decisao.trim()) { tocar("erro"); return; }
    const { error } = await supabase.from("decisions").insert({
      decision: decisao.trim(), why: porque.trim(), status, review_on: revisar || null, who: [me.nome], created_by: me.id,
      sweep_pending: varrer,
    });
    if (error) { tocar("erro"); return; }
    setDecisao(""); setPorque(""); setRevisar(""); setStatus("tomada"); setVarrer(false); setAberto(false); reload();
  }

  return (
    <>
      <div className="cab-pag">
        <div>
          <h1 className="titulo-pag">O que já <span className="editorial">decidimos</span></h1>
          <p className="sub-pag">Uma linha por decisão, com o porquê. É o que evita rediscutir a mesma coisa daqui a dois meses.</p>
        </div>
        <button className="btn btn--primario" type="button" onClick={() => setAberto(!aberto)}><Icone id="i-mais" />Registrar decisão</button>
      </div>

      {aberto ? (
        <form className="cartao col-x" onSubmit={salvar} style={{ marginBottom: 30 }}>
          <label className="campo-g"><span className="rotulo">Decisão</span>
            <input className="campo" autoFocus value={decisao} onChange={(e) => setDecisao(e.target.value)} placeholder="Uma frase" /></label>
          <label className="campo-g"><span className="rotulo">Por quê</span>
            <textarea className="campo" value={porque} onChange={(e) => setPorque(e.target.value)} /></label>
          <div className="grade-2c">
            <label className="campo-g"><span className="rotulo">Situação</span>
              <select className="campo" value={status} onChange={(e) => setStatus(e.target.value as Decision["status"])}>
                <option value="tomada">Tomada</option><option value="pendente">Pendente</option><option value="revisar">Revisar</option>
              </select></label>
            <label className="campo-g"><span className="rotulo">Revisar em</span>
              <input className="campo" type="date" value={revisar} onChange={(e) => setRevisar(e.target.value)} /></label>
          </div>
          <label className="check-linha">
            <input type="checkbox" checked={varrer} onChange={(e) => setVarrer(e.target.checked)} />
            <span><strong>Pedir varredura da vault.</strong> Na próxima revisão diária o Claude procura os arquivos e as atividades afetados por esta decisão e atualiza tudo (o histórico de versões permite desfazer).</span>
          </label>
          <div className="linha">
            <button className="btn btn--primario" type="submit">Salvar</button>
            <button className="btn btn--fantasma" type="button" onClick={() => setAberto(false)}>Cancelar</button>
          </div>
        </form>
      ) : null}

      {erro ? <p className="vazio-nota" role="alert">{erro}</p> : null}
      <div className="cartao" style={{ padding: 0 }}>
        <div className="tabela-rolagem" style={{ maxHeight: "none" }}>
          <table className="tabela">
            <thead><tr><th>Data</th><th>Decisão</th><th>Por quê</th><th>Quem</th><th>Situação</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>{dataCurta(d.decided_on)}</td>
                  <td><strong>{d.decision}</strong></td>
                  <td>{d.why || "—"}</td>
                  <td>{d.who.join(", ")}</td>
                  <td>
                    {d.status === "tomada" ? "tomada" : <span className="carimbo carimbo--mini">{d.status}</span>}
                    {d.review_on ? <span className="vazio-nota"> · rever {dataCurta(d.review_on)}</span> : null}
                    {d.sweep_pending ? <span className="carimbo carimbo--mini" style={{ marginLeft: 6 }}>varredura pendente</span> : d.swept_at ? <span className="vazio-nota"> · vault varrida {dataCurta(d.swept_at)}</span> : null}
                  </td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={5} className="vazio-nota">Nenhuma decisão ainda. Registre a primeira.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
