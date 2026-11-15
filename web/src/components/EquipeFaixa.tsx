"use client";
import { useApp, texturaDe } from "./Shell";
import { Disco } from "./Defs";
import { useTable, useTick } from "@/lib/hooks";
import { ha, minutosDesde, type Presence } from "@/lib/types";

/** Faixa "quem está em quê agora": presença vinda do Claude Code e do app. */
export function EquipeFaixa() {
  const { members } = useApp();
  const { rows } = useTable<Presence>("presence");
  useTick(30000);

  return (
    <section className="equipe-faixa" aria-label="Equipe agora">
      {members.map((m) => {
        const p = rows.find((x) => x.member_id === m.id);
        const min = minutosDesde(p?.last_seen);
        const ativo = min !== null && min <= 15;
        return (
          <div className="pessoa-chip" key={m.id}>
            <Disco textura={texturaDe(m)} inicial={m.nome[0]} size={34} />
            <div>
              <strong>{m.nome}</strong>{" "}
              {ativo ? <span className="carimbo carimbo--mini">agora</span> : null}
              <small>{ativo ? p?.doing ?? "ativo" : p ? `visto ${ha(p.last_seen)}` : "ainda não apareceu"}</small>
            </div>
          </div>
        );
      })}
    </section>
  );
}
