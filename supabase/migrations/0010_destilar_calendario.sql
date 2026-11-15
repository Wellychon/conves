-- Convés · 0010 · botão "Destilar" (pedido que o próximo Claude conectado atende), calendário e personas

-- ---------- pedidos de destilação ----------
-- Um clique no quadro cria um pedido. O próximo Claude que abrir a sessão vê no digest,
-- reivindica (claim atômico), atualiza a vault com o que foi concluído e arquiva os cards.
create table public.destilacoes (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references public.members(id) on delete set null,
  requested_at timestamptz not null default now(),
  claimed_by uuid references public.members(id) on delete set null,
  claimed_at timestamptz,
  done_at timestamptz,
  summary text not null default ''
);
create index destilacoes_requested_by_idx on public.destilacoes (requested_by);
create index destilacoes_claimed_by_idx on public.destilacoes (claimed_by);
create index destilacoes_pendentes_idx on public.destilacoes (requested_at) where done_at is null;
alter table public.destilacoes enable row level security;
create policy "membros leem destilacoes" on public.destilacoes for select to authenticated
  using ((select private.is_member()));
alter publication supabase_realtime add table public.destilacoes;

-- pendente = não concluído e (ninguém pegou ou quem pegou sumiu há mais de 3 horas)
create function public.pedir_destilacao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.current_member_id(); v_id uuid;
begin
  if v_me is null then raise exception 'não autorizado' using errcode = '42501'; end if;
  select id into v_id from public.destilacoes
   where done_at is null and (claimed_at is null or claimed_at > now() - interval '3 hours')
   order by requested_at limit 1;
  if v_id is not null then return jsonb_build_object('ok', true, 'ja_pendente', true, 'id', v_id); end if;
  insert into public.destilacoes (requested_by) values (v_me) returning id into v_id;
  return jsonb_build_object('ok', true, 'ja_pendente', false, 'id', v_id);
end $$;
revoke all on function public.pedir_destilacao() from public, anon;
grant execute on function public.pedir_destilacao() to authenticated;

-- o Claude reivindica o pedido mais antigo; dois Claudes ao mesmo tempo não pegam o mesmo
create function public._destilar_claim(p_member uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.destilacoes set claimed_by = p_member, claimed_at = now()
   where id = (
     select id from public.destilacoes
      where done_at is null and (claimed_at is null or claimed_at < now() - interval '3 hours')
      order by requested_at limit 1 for update skip locked)
  returning id into v_id;
  return v_id;
end $$;

create function public._destilar_done(p_member uuid, p_summary text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.destilacoes set done_at = now(), summary = left(p_summary, 1500)
   where claimed_by = p_member and done_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0, 'n', v_n);
end $$;

revoke all on function public._destilar_claim(uuid) from public, anon, authenticated;
revoke all on function public._destilar_done(uuid, text) from public, anon, authenticated;
grant execute on function public._destilar_claim(uuid) to service_role;
grant execute on function public._destilar_done(uuid, text) to service_role;

-- ---------- calendário: datas avulsas (editais, hackathons, reuniões) ----------
-- prazos de cards (cards.due) e revisões de decisões (decisions.review_on) já entram sozinhos na tela.
create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  fim date,
  titulo text not null,
  tipo text not null default 'outro' check (tipo in ('edital', 'hackathon', 'reuniao', 'prazo', 'outro')),
  link text not null default '',
  nota text not null default '',
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index eventos_dia_idx on public.eventos (dia);
create index eventos_created_by_idx on public.eventos (created_by);
alter table public.eventos enable row level security;
create policy "membros operam eventos" on public.eventos for all to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
alter publication supabase_realtime add table public.eventos;

-- ---------- personas: pasta de destino para notas com tipo: persona ----------
insert into public.note_destinations (tipo, pasta) values ('persona', '00 Organização/Pessoas')
on conflict (tipo) do nothing;

-- ---------- concluídas: arquivar NÃO apaga o rastro ----------
-- antes, o filtro "archived_at is null" faria o card sumir da nota mensal ao ser destilado.
create or replace function public._regen_concluidas(p_month text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_dias text; v_body text; tz constant text := 'America/Sao_Paulo';
begin
  select string_agg(sec, E'\n\n' order by dia desc) into v_dias from (
    select dia, '## ' || dia || E'\n' || string_agg(
             '- ✅ **' || t.title || '**' ||
             coalesce(' — ' || nullif(replace(t.resultado, E'\n', ' '), ''), ' — concluída') ||
             ' (' || coalesce(t.quem, '?') || ')' || coalesce(' · [[' || t.nota || ']]', ''),
             E'\n' order by t.quando desc) as sec
    from (
      select to_char(c.concluido_em at time zone tz, 'YYYY-MM-DD') as dia, c.title, c.resultado, c.concluido_em as quando,
             m.nome as quem, n.title as nota
      from public.cards c
      left join public.members m on m.id = c.concluido_por
      left join public.notes n on n.id = c.note_id and n.deleted_at is null
      where c.status = 'feito'
        and to_char(c.concluido_em at time zone tz, 'YYYY-MM') = p_month
    ) t group by dia
  ) s;
  if v_dias is null then return; end if;
  v_body := E'---\ntipo: meta\n---\n\n# Atividades concluídas · ' || p_month ||
            E'\n\n> Gerado automaticamente a partir dos cards do Convés. Não edite aqui: edite o **resultado** no card.\n\n' || v_dias || E'\n';
  insert into public.notes (path, title, body, tipo)
  values ('07 Quadro/Concluídas/' || p_month || '.md', 'Concluídas ' || p_month, v_body, 'meta')
  on conflict (path) do update set body = excluded.body, deleted_at = null
  where public.notes.body is distinct from excluded.body or public.notes.deleted_at is not null;
end $$;
revoke all on function public._regen_concluidas(text) from public, anon, authenticated;

-- ---------- digest: avisa do pedido de destilação ----------
create or replace function public._digest_full(p_member uuid, p_mark boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_d text; v_p text; v_rev text := ''; v_dest text := ''; v_sweeps int; v_last timestamptz; v_quem text; v_n int;
  tz constant text := 'America/Sao_Paulo';
begin
  v_d := public._digest_txt(p_member, p_mark);
  select 'minhas pendências: ' || count(*) || ' (claude ' || count(*) filter (where executor = 'claude') ||
         ' · humano ' || count(*) filter (where executor = 'humano') ||
         ' · sem classificar ' || count(*) filter (where executor is null) || ')'
    into v_p
  from public.cards where assignee = p_member and status <> 'feito' and archived_at is null;
  if v_p like '%: 0 (%' then v_p := null; end if;

  select r.created_at, m.nome into v_last, v_quem from public.reviews r left join public.members m on m.id = r.member_id
   order by r.created_at desc limit 1;
  select count(*) into v_sweeps from public.decisions where sweep_pending;
  if v_last is null or v_last < now() - interval '20 hours' or v_sweeps > 0 then
    v_rev := 'revisão diária: pendente' ||
             case when v_sweeps > 0 then ' (' || v_sweeps || ' varredura(s) de decisão)' else '' end ||
             ' — /mcp__conves__revisao';
  end if;

  select count(*) into v_n from public.cards where status = 'feito' and archived_at is null;
  select 'DESTILAR pedido por ' || coalesce(m.nome, '?') || ' em ' || to_char(d.requested_at at time zone tz, 'DD/MM HH24:MI') ||
         ' (' || v_n || ' concluído(s) a arquivar) — rode /mcp__conves__destilar agora'
    into v_dest
  from public.destilacoes d left join public.members m on m.id = d.requested_by
  where d.done_at is null and (d.claimed_at is null or d.claimed_at < now() - interval '3 hours')
  order by d.requested_at limit 1;

  return concat_ws(E'\n', nullif(v_dest, ''), nullif(case when v_d = 'nada novo' then null else v_d end, ''), v_p, nullif(v_rev, ''))
         || case when v_d = 'nada novo' and v_p is null and v_rev = '' and coalesce(v_dest, '') = '' then 'nada novo' else '' end;
end $$;
revoke all on function public._digest_full(uuid, boolean) from public, anon, authenticated;
grant execute on function public._digest_full(uuid, boolean) to service_role;
