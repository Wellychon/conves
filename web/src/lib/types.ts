export type Member = {
  id: string;
  user_id: string | null;
  email: string;
  nome: string;
  slug: string;
  textura: string;
};

export type Status = "backlog" | "a_fazer" | "fazendo" | "revisao" | "feito";
export type Prioridade = "baixa" | "media" | "alta" | "urgente";

export type Card = {
  id: string;
  board_id: string;
  title: string;
  body: string;
  status: Status;
  position: number;
  assignee: string | null;
  prioridade: Prioridade;
  due: string | null;
  note_id: string | null;
  labels: string[];
  executor: "claude" | "humano" | "ambos" | null;
  como: string;
  resultado: string;
  concluido_em: string | null;
  concluido_por: string | null;
  archived_at: string | null;
  updated_at: string;
};

export type NoteRow = {
  id: string;
  path: string;
  title: string;
  tipo: string | null;
  owner: string | null;
  version: number;
  updated_at: string;
  updated_by: string | null;
  in_graph: boolean;
  deleted_at: string | null;
};

export type NoteFull = NoteRow & { body: string };
export type LinkRow = { src: string; dst: string | null; dst_title: string };
export type Presence = {
  member_id: string;
  doing: string | null;
  last_seen: string;
  card_id: string | null;
  note_id: string | null;
};
export type Decision = {
  id: string;
  decided_on: string;
  decision: string;
  why: string;
  who: string[];
  status: "tomada" | "pendente" | "revisar";
  review_on: string | null;
  sweep_pending: boolean;
  swept_at: string | null;
  created_at: string;
};
export type Destilacao = {
  id: string;
  requested_by: string | null;
  requested_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  done_at: string | null;
  summary: string;
};
export type TipoEvento = "edital" | "hackathon" | "reuniao" | "prazo" | "outro";
export type Evento = {
  id: string;
  dia: string;
  fim: string | null;
  titulo: string;
  tipo: TipoEvento;
  link: string;
  nota: string;
  created_by: string | null;
};
export const TIPOS_EVENTO: { id: TipoEvento; nome: string }[] = [
  { id: "edital", nome: "Edital" },
  { id: "hackathon", nome: "Hackathon" },
  { id: "reuniao", nome: "Reunião" },
  { id: "prazo", nome: "Prazo" },
  { id: "outro", nome: "Outro" },
];
export type Review = { id: string; member_id: string | null; summary: string; created_at: string };
export type Learning = {
  id: string;
  kind: "erro" | "preferencia" | "padrao" | "atalho" | "regra";
  body: string;
  member_id: string | null;
  created_at: string;
};
export const TIPOS_APRENDIZADO: Learning["kind"][] = ["erro", "preferencia", "padrao", "atalho", "regra"];

export type CardEvent = {
  id: number;
  kind: string;
  data: { title?: string; de?: string; para?: string };
  created_at: string;
  member_id: string | null;
};

// ---------- tempo real (migração 0011): uma linha por sessão de IA e a linha do tempo ----------
export type EstadoSessao = "ativa" | "esperando" | "encerrada";
export type ClienteSessao = "claude-code" | "web" | "runner";
export type Sessao = {
  id: string; // session_id do Claude Code
  member_id: string;
  client: ClienteSessao;
  projeto: string | null; // basename do cwd
  titulo: string | null; // 1º pedido (ou "Sessão privada")
  doing: string | null; // pedido atual
  ultimo_passo: string | null; // ex.: "Edit · 01 Ideias/Crew.md"
  card_id: string | null;
  destilacao_id: string | null; // sessão do runner que atende um pedido de destilação
  estado: EstadoSessao;
  privado: boolean;
  passos: number;
  arquivos: string[]; // últimos caminhos da vault editados (relativos)
  started_at: string;
  last_seen: string;
  ended_at: string | null;
};
export type TipoAtividade = "inicio" | "pedido" | "arquivo" | "espera" | "fim" | "destilar";
export type Atividade = {
  id: number;
  sessao_id: string | null;
  member_id: string | null;
  kind: TipoAtividade;
  texto: string;
  created_at: string;
};

/** Sessão viva = não encerrada e com sinal nos últimos 15 min (a mesma regra do servidor). */
export const VIVA_MS = 15 * 60_000;
export function sessaoViva(s: Pick<Sessao, "estado" | "last_seen">, agora = Date.now()) {
  const t = tempo(s.last_seen);
  return s.estado !== "encerrada" && !Number.isNaN(t) && agora - t < VIVA_MS;
}

// colunas: a cobertura de tinta cresce conforme o trabalho avança
export const COLUNAS: { id: Status; nome: string; textura: string; dica: string }[] = [
  { id: "backlog", nome: "Backlog", textura: "p-vazio", dica: "ainda sem data" },
  { id: "a_fazer", nome: "A fazer", textura: "p-pontos", dica: "próximos" },
  { id: "fazendo", nome: "Fazendo", textura: "p-hachura-aberta", dica: "em andamento" },
  { id: "revisao", nome: "Revisão", textura: "p-quadriculado", dica: "esperando olhar" },
  { id: "feito", nome: "Feito", textura: "p-solido", dica: "concluído" },
];

export const TEXTURA_MEMBRO: Record<string, string> = {
  hachura: "p-hachura-densa",
  cruzes: "p-cruzes",
  pontos: "p-pontos",
  quadriculado: "p-quadriculado",
};

export const FAMILIAS: { id: string; nome: string; textura: string; tipos: string[] }[] = [
  { id: "ideias", nome: "Ideias", textura: "p-pontos", tipos: ["ideia"] },
  { id: "pesquisa", nome: "Pesquisa", textura: "p-hachura-aberta", tipos: ["pesquisa", "metodo", "entrevista", "concorrente"] },
  { id: "projetos", nome: "Projetos e contexto", textura: "p-solido", tipos: ["projeto", "contexto", "historico"] },
  { id: "analise", nome: "Análise", textura: "p-quadriculado", tipos: ["analise", "sintese", "criterios"] },
  { id: "registros", nome: "Decisões e registros", textura: "p-cruzes", tipos: ["decisao", "log", "reuniao"] },
  { id: "estrutura", nome: "Estrutura", textura: "p-vazio", tipos: ["home", "guia", "meta", "indice", "inbox"] },
];

export function familiaDe(tipo: string | null) {
  return FAMILIAS.find((f) => tipo && f.tipos.includes(tipo)) ?? FAMILIAS[FAMILIAS.length - 1];
}

/** Horário do banco em ms. Aceita também "2026-11-06 12:00:00+00" (o Safari recusa o espaço e o fuso curto). */
export function tempo(iso: string | null | undefined) {
  if (!iso) return NaN;
  let s = iso.trim();
  if (s.length > 10 && s[10] === " ") s = `${s.slice(0, 10)}T${s.slice(11)}`;
  if (/T\d\d:\d\d.*[+-]\d\d$/.test(s)) s += ":00";
  return Date.parse(s);
}

export function minutosDesde(iso: string | null | undefined) {
  const t = tempo(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

/** "14:05" no fuso de quem está olhando. */
export function horaCurta(iso: string | null | undefined) {
  const t = tempo(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ha(iso: string | null | undefined) {
  const m = minutosDesde(iso);
  if (m === null) return "nunca";
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  if (m < 1440) return `há ${Math.round(m / 60)} h`;
  return `há ${Math.round(m / 1440)} d`;
}

export function dataCurta(iso: string | null) {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}
