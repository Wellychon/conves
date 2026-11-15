"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { useTable, useTick } from "./hooks";
import { sessaoViva, type Sessao } from "./types";

/** Sessões de IA ainda não encerradas (a tabela vem da migração 0011; sem ela `semTabela` fica true). */
export function useSessoes() {
  const t = useTable<Sessao>("sessoes", {
    filter: (q) => q.neq("estado", "encerrada"),
    order: { column: "last_seen", ascending: false },
    limit: 60,
  });
  const tick = useTick(30000);
  // viva = com sinal nos últimos 15 min; o tick reavalia sem depender de novo evento
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vivas = useMemo(() => t.rows.filter((s) => sessaoViva(s)), [t.rows, tick]);
  return { ...t, vivas };
}

/* ---------- quem está com o Convés web aberto (Realtime Presence: efêmero, nada vai ao banco) ---------- */
let online: string[] = [];
const ouvintes = new Set<() => void>();
const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };

/** Ids dos membros com o Convés aberto agora. */
export function useWebOnline() {
  return useSyncExternalStore(assinar, () => online, () => online);
}

/** Entra no canal de presença enquanto o Shell estiver montado. */
export function usePresencaWeb(me: { id: string; nome: string }) {
  useEffect(() => {
    const canal = supabase.channel("web:presenca", { config: { presence: { key: me.id } } });
    const sincronizar = () => {
      const novo = Object.keys(canal.presenceState()).sort();
      if (novo.join() === online.join()) return;
      online = novo;
      ouvintes.forEach((f) => f());
    };
    canal
      .on("presence", { event: "sync" }, sincronizar)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void canal.track({ nome: me.nome });
      });
    return () => {
      online = [];
      ouvintes.forEach((f) => f());
      void supabase.removeChannel(canal);
    };
  }, [me.id, me.nome]);
}
