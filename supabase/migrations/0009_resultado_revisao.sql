-- Convés · 0009 · resposta da atividade, concluídas na vault, histórico de versões, revisão diária e varredura por decisão

-- ---------- cards: resposta e conclusão ----------
alter table public.cards
  add column resultado text not null default '',
  add column concluido_em timestamptz,
  add column concluido_por uuid references public.members(id) on delete set null;
create index cards_concluido_por_idx on public.cards (concluido_por);
update public.cards set concluido_em = updated_at where status = 'feito' and concluido_em is null;

-- ---------- decisões podem pedir varredura da vault ----------
alter table public.decisions
  add column sweep_pending boolean not null default false,
  add column swept_at timestamptz;

-- ---------- revisões diárias ----------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  summary text not null default '',
  created_at timestamptz not null default now()
);
create index reviews_member_idx on public.reviews (member_id);
create index reviews_created_idx on public.reviews (created_at desc);
alter table public.reviews enable row level security;
create policy "membros leem revisoes" on public.reviews for select to authenticated
  using ((select private.is_member()));
alter publication supabase_realtime add table public.reviews;

-- ---------- histórico de versões das notas (rede de segurança para varreduras em massa) ----------
create table public.note_history (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.notes(id) on delete cascade,
  version integer not null,
  path text not null,
  body text not null,
  updated_by uuid references public.members(id) on delete set null,
  saved_at timestamptz not null default now()
);
create index note_history_note_idx on public.note_history (note_id, version desc);
create index note_history_by_idx on public.note_history (updated_by);
alter table public.note_history enable row level security;
create policy "membros leem historico" on public.note_history for select to authenticated
  using ((select private.is_member()));

create function public.notes_hist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.body is distinct from new.body or old.path is distinct from new.path then
    insert into public.note_history (note_id, version, path, body, updated_by)
    values (old.id, old.version, old.path, old.body, old.updated_by);
  end if;
  return new;
end $$;
create trigger notes_hist before update on public.notes
  for each row when (old.deleted_at is null) execute function public.notes_hist();

-- ---------- conclusão: carimba quando e por quem ----------
create function public.cards_concluir() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'feito' and old.status is distinct from 'feito' then
    new.concluido_em := now(); new.concluido_por := new.updated_by;
  elsif new.status <> 'feito' and old.status = 'feito' then
    new.concluido_em := null; new.concluido_por := null;
  end if;
  return new;
end $$;
create trigger cards_z_concluir before update of status on public.cards
  for each row execute function public.cards_concluir();

-- ---------- "Atividades concluídas": nota mensal gerada a partir dos cards ----------
create function public._regen_concluidas(p_month text) returns void
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
      where c.status = 'feito' and c.archived_at is null
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

create function public.cards_concluidas_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public._regen_concluidas(to_char(new.concluido_em at time zone 'America/Sao_Paulo', 'YYYY-MM'));
  return new;
end $$;
create trigger cards_concluidas_log after update of status, resultado, title on public.cards
  for each row when (new.status = 'feito' and new.concluido_em is not null)
  execute function public.cards_concluidas_log();

select public._regen_concluidas(to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'));

-- ---------- revisão: registrar e consultar ----------
create function public._review_done(p_member uuid, p_summary text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reviews (member_id, summary) values (p_member, left(p_summary, 1500));
  return jsonb_build_object('ok', true);
end $$;

create function public._sweep_done(p_member uuid, p_prefix text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.decisions set sweep_pending = false, swept_at = now()
   where sweep_pending and id::text like lower(replace(p_prefix, '#', '')) || '%';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

-- restaurar uma versão antiga cria uma NOVA versão (nada se perde)
create function public._restore_note(p_member uuid, p_path text, p_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_h public.note_history%rowtype; v_cur public.notes%rowtype;
begin
  select * into v_cur from public.notes where path = p_path and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'nao_encontrada'); end if;
  select h.* into v_h from public.note_history h where h.note_id = v_cur.id and h.version = p_version order by h.id desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'versao_inexistente'); end if;
  return public._upsert_note(p_member, p_path, v_h.body, v_cur.version);
end $$;

-- ---------- digest: avisa da revisão diária e das varreduras pendentes ----------
create or replace function public._digest_txt(p_member uuid, p_mark boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_since timestamptz; v_n text; v_c text; v_d text; v_a text; v_l text; v_out text := '';
  tz constant text := 'America/Sao_Paulo';
begin
  select coalesce(last_digest_at, now() - interval '3 days') into v_since from public.members where id = p_member;

  select string_agg(x, '; ') into v_n from (
    select n.title || ' (' || coalesce(m.nome, '?') || ' v' || n.version || ')' as x
    from public.notes n left join public.members m on m.id = n.updated_by
    where n.updated_at > v_since and n.updated_by is distinct from p_member and n.deleted_at is null
      and n.path not like '00 Organização/Mapa%' and n.path not like '07 Quadro/Concluídas/%'
    order by n.updated_at desc limit 8) t;

  select string_agg(x, '; ') into v_c from (
    select coalesce(m.nome, '?') || ' ' || e.kind || ' "' || left(coalesce(e.data->>'title', ''), 40) || '"' ||
           coalesce(' → ' || (e.data->>'para'), '') as x
    from public.card_events e left join public.members m on m.id = e.member_id
    where e.created_at > v_since and e.member_id is distinct from p_member
    order by e.created_at desc limit 8) t;

  select string_agg(x, '; ') into v_d from (
    select left(d.decision, 70) || ' [' || d.status || ']' || case when d.sweep_pending then ' ⟳varrer' else '' end as x
    from public.decisions d
    where d.created_at > v_since and d.created_by is distinct from p_member
    order by d.created_at desc limit 5) t;

  select string_agg(x, '; ') into v_a from (
    select m.nome || ': ' || coalesce(left(p.doing, 80), 'ativo') || coalesce(' [' || left(c.title, 30) || ']', '') as x
    from public.presence p join public.members m on m.id = p.member_id
    left join public.cards c on c.id = p.card_id
    where p.last_seen > now() - interval '15 minutes' and p.member_id <> p_member) t;

  select string_agg(x, E'\n') into v_l from (
    select '  ' || l.kind || ': ' || left(l.body, 140) || ' (' || coalesce(m.nome, '?') || ')' as x
    from public.learnings l left join public.members m on m.id = l.member_id
    where l.created_at > v_since and l.member_id is distinct from p_member
    order by l.created_at desc limit 3) t;

  if v_n is not null then v_out := v_out || E'\nnotas: ' || v_n; end if;
  if v_c is not null then v_out := v_out || E'\ncards: ' || v_c; end if;
  if v_d is not null then v_out := v_out || E'\ndecisões: ' || v_d; end if;
  if v_a is not null then v_out := v_out || E'\nagora: ' || v_a; end if;
  if v_l is not null then v_out := v_out || E'\naprendizados:\n' || v_l; end if;

  if p_mark then update public.members set last_digest_at = now() where id = p_member; end if;
  if v_out = '' then return 'nada novo'; end if;
  return 'desde ' || to_char(v_since at time zone tz, 'DD/MM HH24:MI') || v_out;
end $$;

create or replace function public._digest_full(p_member uuid, p_mark boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare v_d text; v_p text; v_rev text := ''; v_sweeps int; v_last timestamptz; v_quem text;
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

  return concat_ws(E'\n', nullif(case when v_d = 'nada novo' then null else v_d end, ''), v_p, nullif(v_rev, ''))
         || case when v_d = 'nada novo' and v_p is null and v_rev = '' then 'nada novo' else '' end;
end $$;

-- ---------- permissões ----------
revoke all on function public.notes_hist() from public, anon, authenticated;
revoke all on function public.cards_concluir() from public, anon, authenticated;
revoke all on function public._regen_concluidas(text) from public, anon, authenticated;
revoke all on function public.cards_concluidas_log() from public, anon, authenticated;
revoke all on function public._review_done(uuid, text) from public, anon, authenticated;
revoke all on function public._sweep_done(uuid, text) from public, anon, authenticated;
revoke all on function public._restore_note(uuid, text, integer) from public, anon, authenticated;
grant execute on function public._review_done(uuid, text) to service_role;
grant execute on function public._sweep_done(uuid, text) to service_role;
grant execute on function public._restore_note(uuid, text, integer) to service_role;
