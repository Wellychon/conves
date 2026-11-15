-- Convés · 0002 · RLS, Realtime e carga inicial

alter table public.members enable row level security;
alter table public.tokens enable row level security;
alter table public.notes enable row level security;
alter table public.links enable row level security;
alter table public.boards enable row level security;
alter table public.cards enable row level security;
alter table public.card_events enable row level security;
alter table public.presence enable row level security;
alter table public.decisions enable row level security;

-- leitura: qualquer membro autenticado
create policy "membros leem membros" on public.members for select to authenticated
  using ((select public.is_member()));
create policy "membros leem notas" on public.notes for select to authenticated
  using ((select public.is_member()));
create policy "membros leem links" on public.links for select to authenticated
  using ((select public.is_member()));
create policy "membros leem eventos" on public.card_events for select to authenticated
  using ((select public.is_member()));
create policy "membros leem presenca" on public.presence for select to authenticated
  using ((select public.is_member()));

-- tokens: cada um vê só os seus (nunca escreve direto; criação é feita pelo servidor)
create policy "ver os proprios tokens" on public.tokens for select to authenticated
  using (member_id = (select public.current_member_id()));

-- quadro e decisões: membros leem e escrevem
create policy "membros operam quadros" on public.boards for all to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "membros operam cards" on public.cards for all to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "membros operam decisoes" on public.decisions for all to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));

-- tempo real
alter publication supabase_realtime add table
  public.notes, public.links, public.cards, public.card_events, public.presence, public.decisions;

-- ---------- carga inicial ----------
insert into public.members (email, nome, slug, textura)
values ('voce@exemplo.com', 'Welly', 'welly', 'hachura');

insert into public.boards (nome) values ('Piena');

insert into public.cards (board_id, title, status, prioridade, position, assignee, labels, body)
select b.id, c.title, c.status, c.prioridade, c.pos,
       case when c.dono = 'welly' then (select id from public.members where slug = 'welly') end,
       c.labels, c.body
from public.boards b
cross join (values
  ('Construir o Convés (MCP, kanban e grafo)', 'fazendo', 'alta', 1000, 'welly', array['convés'], 'Sistema central da Piena: contexto compartilhado, presença, kanban e grafo.'),
  ('Alinhar a definição de Crew (o que é, para quem, primeira tarefa)', 'a_fazer', 'alta', 1000, 'welly', array['crew'], 'Ver nota 01 Ideias/Crew.'),
  ('Definir o que é "ganhar dinheiro" para a Piena (meta e prazo)', 'a_fazer', 'alta', 2000, null, array['estratégia'], 'Receita recorrente, projeto ou produto?'),
  ('Esclarecer titularidade do código (Restauresse, Voyager/Thomas, Banco Laguna)', 'a_fazer', 'alta', 3000, 'welly', array['overflow'], 'Define o que a Piena pode reaproveitar. Ver Ativos da Overflow.'),
  ('Decidir o papel do Derik e da Overflow na transição', 'a_fazer', 'media', 4000, null, array['overflow'], ''),
  ('Definir pesos e regra de corte dos critérios de avaliação', 'a_fazer', 'media', 5000, null, array['ideias'], 'Ver 01 Ideias/Critérios de Avaliação.'),
  ('Primeira rodada de Terrenos para explorar', 'backlog', 'media', 1000, null, array['pesquisa'], ''),
  ('Jorge: listar suas ideias no Inbox', 'backlog', 'media', 2000, null, array['ideias'], ''),
  ('Confirmar se o AI4Good foi submetido (prazo era 2026-11-01)', 'backlog', 'baixa', 3000, 'welly', array['overflow'], '')
) as c(title, status, prioridade, pos, dono, labels, body)
where b.nome = 'Piena';
