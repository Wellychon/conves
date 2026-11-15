-- Convés · 0006 · automação sem tokens: arquivar notas, espelho card↔nota, aprendizados, digest compacto

-- ---------- helpers de frontmatter ----------
create function public.fm_get(p_body text, p_key text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(substring(substring(p_body from '(?s)^---\r?\n(.*?)\r?\n---') from ('(?m)^' || p_key || ':[ \t]*(.+)$')), ' "'''), '')
$$;

create function public.fm_set(p_body text, p_key text, p_val text) returns text
language plpgsql immutable set search_path = '' as $$
declare fm text; novo text; v text := replace(coalesce(p_val, ''), '\', '\\');
begin
  if p_body ~ '(?s)^---\r?\n.*?\r?\n---' then
    fm := substring(p_body from '(?s)^---\r?\n(.*?)\r?\n---');
    if fm ~ ('(?m)^' || p_key || ':') then
      novo := regexp_replace(fm, '(?m)^' || p_key || ':.*$', p_key || ': ' || v);
    else
      novo := fm || E'\n' || p_key || ': ' || coalesce(p_val, '');
    end if;
    return regexp_replace(p_body, '(?s)^---\r?\n.*?\r?\n---', '---' || E'\n' || replace(novo, '\', '\\') || E'\n' || '---');
  end if;
  return '---' || E'\n' || p_key || ': ' || coalesce(p_val, '') || E'\n---\n' || p_body;
end $$;

-- ---------- tombstone e mover nota ----------
create function public._tombstone(p_path text, p_member uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notes (path, title, body, deleted_at, updated_by, in_graph)
  values (p_path, public.note_title(p_path), '', now(), p_member, false)
  on conflict (path) do update set deleted_at = now(), body = '', updated_by = p_member
$$;

create function public._move_note(p_member uuid, p_path text, p_new text, p_base_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur public.notes%rowtype; res public.notes%rowtype;
begin
  select * into cur from public.notes where path = p_path and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'nao_encontrada'); end if;
  if p_base_version is distinct from cur.version then
    return jsonb_build_object('ok', false, 'conflict', true, 'note', to_jsonb(cur) - 'tsv');
  end if;
  if exists (select 1 from public.notes where path = p_new and deleted_at is null) then
    return jsonb_build_object('ok', false, 'error', 'destino_existe');
  end if;
  delete from public.notes where path = p_new and deleted_at is not null;
  update public.notes set
    path = p_new,
    title = case when cur.title = public.note_title(p_path) then public.note_title(p_new) else cur.title end,
    updated_by = p_member
  where id = cur.id returning * into res;
  perform public._tombstone(p_path, p_member);
  return jsonb_build_object('ok', true, 'note', to_jsonb(res) - 'tsv');
end $$;

-- ---------- _upsert_note: agora arquiva por tipo ----------
create or replace function public._upsert_note(
  p_member uuid, p_path text, p_body text,
  p_base_version integer default null,
  p_title text default null, p_frontmatter jsonb default null,
  p_tipo text default null, p_owner text default null, p_in_graph boolean default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cur public.notes%rowtype; res public.notes%rowtype; v_exists boolean;
  v_fm text; v_tipo text; v_owner text; v_graph boolean; v_dest text; v_path text; v_base text;
begin
  v_fm := substring(p_body from '(?s)^---\r?\n(.*?)\r?\n---');
  v_tipo := coalesce(p_tipo, nullif(btrim(substring(v_fm from '(?m)^tipo:[ \t]*(.+)$'), ' "'''), ''));
  v_owner := coalesce(p_owner, nullif(btrim(substring(v_fm from '(?m)^dono:[ \t]*(.+)$'), ' "'''), ''));
  v_graph := coalesce(p_in_graph, not (p_path ~ '^Templates/' or p_path ~ '(^|/)CLAUDE\.md$'));
  v_dest := case v_tipo
    when 'ideia' then '01 Ideias'
    when 'pesquisa' then '02 Pesquisa' when 'metodo' then '02 Pesquisa'
    when 'entrevista' then '02 Pesquisa' when 'concorrente' then '02 Pesquisa'
    when 'decisao' then '03 Decisões' when 'log' then '03 Decisões'
    when 'reuniao' then '04 Reuniões' when 'tarefa' then '06 Quadro'
    when 'aprendizado' then '00 Organização' else null end;
  v_base := regexp_replace(p_path, '^.*/', '');
  v_path := p_path;
  if v_dest is not null and (p_path !~ '/' or p_path ~ '^00 Inbox/')
     and not exists (select 1 from public.notes where path = v_dest || '/' || v_base and deleted_at is null) then
    v_path := v_dest || '/' || v_base;
  end if;

  select * into cur from public.notes where path = p_path for update;
  v_exists := found;
  if not v_exists then
    insert into public.notes (path, title, body, frontmatter, tipo, owner, in_graph, updated_by)
    values (v_path, coalesce(p_title, public.note_title(v_path)), p_body,
            coalesce(p_frontmatter, '{}'::jsonb), v_tipo, v_owner, v_graph, p_member)
    returning * into res;
    return jsonb_build_object('ok', true, 'conflict', false, 'created', true, 'note', to_jsonb(res) - 'tsv');
  end if;

  if cur.deleted_at is null
     and p_base_version is distinct from cur.version
     and cur.body is distinct from p_body then
    return jsonb_build_object('ok', false, 'conflict', true, 'note', to_jsonb(cur) - 'tsv');
  end if;

  if cur.deleted_at is null and cur.body = p_body and v_path = p_path
     and (p_title is null or p_title = cur.title)
     and (p_frontmatter is null or p_frontmatter = cur.frontmatter) then
    return jsonb_build_object('ok', true, 'conflict', false, 'unchanged', true, 'note', to_jsonb(cur) - 'tsv');
  end if;

  update public.notes set
    body = p_body,
    title = coalesce(p_title, cur.title),
    frontmatter = coalesce(p_frontmatter, cur.frontmatter),
    tipo = v_tipo, owner = v_owner, in_graph = v_graph,
    updated_by = p_member, deleted_at = null
  where id = cur.id returning * into res;

  if v_path <> p_path then  -- nota do Inbox ganhou tipo: vai para a pasta certa
    delete from public.notes where path = v_path and deleted_at is not null;
    update public.notes set path = v_path,
      title = case when res.title = public.note_title(p_path) then public.note_title(v_path) else res.title end
    where id = res.id returning * into res;
    perform public._tombstone(p_path, p_member);
  end if;
  return jsonb_build_object('ok', true, 'conflict', false, 'note', to_jsonb(res) - 'tsv');
end $$;

-- ---------- espelho nota → card ----------
create function public.notes_to_card() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id text := public.fm_get(new.body, 'card');
  c public.cards%rowtype; v_status text; v_prio text; v_dono text; v_prazo text;
  n_status text; n_prio text; n_assignee uuid; n_due date;
begin
  if v_id is null or v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return new; end if;
  select * into c from public.cards where id = v_id::uuid;
  if not found then return new; end if;
  v_status := public.fm_get(new.body, 'status');
  v_prio := public.fm_get(new.body, 'prioridade');
  v_dono := public.fm_get(new.body, 'dono');
  v_prazo := public.fm_get(new.body, 'prazo');
  n_status := case when v_status in ('backlog','a_fazer','fazendo','revisao','feito') then v_status else c.status end;
  n_prio := case when v_prio in ('baixa','media','alta','urgente') then v_prio else c.prioridade end;
  n_assignee := case when v_dono is null then c.assignee
                     else coalesce((select id from public.members where lower(slug) = lower(v_dono)), c.assignee) end;
  n_due := case when v_prazo ~ '^\d{4}-\d{2}-\d{2}$' then v_prazo::date else c.due end;
  if n_status is distinct from c.status or n_prio is distinct from c.prioridade
     or n_assignee is distinct from c.assignee or n_due is distinct from c.due then
    update public.cards set
      status = n_status, prioridade = n_prio, assignee = n_assignee, due = n_due,
      position = case when n_status is distinct from c.status
        then (select coalesce(max(position), 0) + 1000 from public.cards where board_id = c.board_id and status = n_status)
        else c.position end,
      updated_by = new.updated_by
    where id = c.id;
  end if;
  return new;
end $$;
create trigger notes_to_card after insert or update of body on public.notes
  for each row when (new.deleted_at is null) execute function public.notes_to_card();

-- ---------- espelho card → nota ----------
create function public.cards_to_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n public.notes%rowtype; b text; v_slug text;
begin
  if new.note_id is null then return new; end if;
  select * into n from public.notes where id = new.note_id and deleted_at is null;
  if not found then return new; end if;
  b := n.body;
  if public.fm_get(b, 'card') is distinct from new.id::text then b := public.fm_set(b, 'card', new.id::text); end if;
  if public.fm_get(b, 'status') is distinct from new.status then b := public.fm_set(b, 'status', new.status); end if;
  if public.fm_get(b, 'prioridade') is distinct from new.prioridade then b := public.fm_set(b, 'prioridade', new.prioridade); end if;
  select slug into v_slug from public.members where id = new.assignee;
  if coalesce(public.fm_get(b, 'dono'), '') is distinct from coalesce(v_slug, '') then b := public.fm_set(b, 'dono', coalesce(v_slug, '')); end if;
  if coalesce(public.fm_get(b, 'prazo'), '') is distinct from coalesce(new.due::text, '') then b := public.fm_set(b, 'prazo', coalesce(new.due::text, '')); end if;
  if b is distinct from n.body then
    update public.notes set body = b, updated_by = new.updated_by where id = n.id;
  end if;
  return new;
end $$;
create trigger cards_to_note after insert or update of status, assignee, prioridade, due, note_id on public.cards
  for each row execute function public.cards_to_note();

-- ---------- presença liga sozinha ao card ----------
create or replace function public._ping(
  p_member uuid, p_doing text, p_card uuid default null,
  p_note uuid default null, p_client text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_card uuid := p_card;
begin
  if v_card is null then
    select id into v_card from public.cards
     where assignee = p_member and status = 'fazendo' and archived_at is null
     order by updated_at desc limit 1;
  end if;
  insert into public.presence (member_id, card_id, note_id, doing, client, last_seen)
  values (p_member, v_card, p_note, p_doing, p_client, now())
  on conflict (member_id) do update set
    card_id = excluded.card_id, note_id = excluded.note_id,
    doing = excluded.doing, client = coalesce(excluded.client, public.presence.client),
    last_seen = now();
end $$;

-- ---------- append atômico e aprendizados ----------
create function public._append_note(p_member uuid, p_path text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res public.notes%rowtype;
begin
  insert into public.notes (path, title, body, updated_by)
  values (p_path, public.note_title(p_path), p_text || E'\n', p_member)
  on conflict (path) do update set
    body = case when public.notes.deleted_at is not null then excluded.body
                else rtrim(public.notes.body, E'\n') || E'\n' || p_text || E'\n' end,
    updated_by = p_member, deleted_at = null
  returning * into res;
  return jsonb_build_object('ok', true, 'v', res.version);
end $$;

create table public.learnings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('erro', 'preferencia', 'padrao', 'atalho', 'regra')),
  body text not null,
  member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index learnings_member_idx on public.learnings (member_id);
create index learnings_created_idx on public.learnings (created_at desc);
alter table public.learnings enable row level security;
create policy "membros leem aprendizados" on public.learnings for select to authenticated
  using ((select private.is_member()));
alter publication supabase_realtime add table public.learnings;

create function public._learn(p_member uuid, p_kind text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  select nome into v_nome from public.members where id = p_member;
  insert into public.learnings (kind, body, member_id) values (p_kind, left(p_text, 600), p_member);
  perform public._append_note(p_member, '00 Organização/Aprendizados das IAs.md',
    '- ' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') || ' · **' || p_kind || '** · ' ||
    coalesce(v_nome, '?') || ': ' || replace(left(p_text, 600), E'\n', ' '));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- digest compacto (texto) ----------
create function public._digest_txt(p_member uuid, p_mark boolean default true) returns text
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
      and n.path not like '00 Organização/Mapa%'
    order by n.updated_at desc limit 8) t;

  select string_agg(x, '; ') into v_c from (
    select coalesce(m.nome, '?') || ' ' || e.kind || ' "' || left(coalesce(e.data->>'title', ''), 40) || '"' ||
           coalesce(' → ' || (e.data->>'para'), '') as x
    from public.card_events e left join public.members m on m.id = e.member_id
    where e.created_at > v_since and e.member_id is distinct from p_member
    order by e.created_at desc limit 8) t;

  select string_agg(x, '; ') into v_d from (
    select left(d.decision, 70) || ' [' || d.status || ']' as x from public.decisions d
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

-- ---------- mapa da vault (gerado) ----------
create function public._regen_map(p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pastas text; v_tipos text; v_top text; v_total int; v_body text;
begin
  select count(*) into v_total from public.notes where deleted_at is null;
  select string_agg('| ' || pasta || ' | ' || n || ' |', E'\n' order by pasta) into v_pastas from (
    select coalesce(nullif(substring(path from '^([^/]+)/'), ''), '(raiz)') as pasta, count(*) as n
    from public.notes where deleted_at is null group by 1) t;
  select string_agg('| ' || coalesce(tipo, '(sem)') || ' | ' || n || ' |', E'\n' order by n desc) into v_tipos from (
    select tipo, count(*) as n from public.notes where deleted_at is null group by 1) t;
  select string_agg('- [[' || title || ']] (' || n || ' links)', E'\n' order by n desc) into v_top from (
    select nt.title, count(*) as n from public.links l join public.notes nt on nt.id = l.dst
    where nt.deleted_at is null group by nt.title order by 2 desc limit 8) t;

  v_body := E'---\ntipo: meta\n---\n\n# Mapa da vault\n\n> Gerado automaticamente pelo Convés. Não edite: as mudanças são sobrescritas.\n\n' ||
    '**' || v_total || ' notas.**\n\n## Por pasta\n\n| Pasta | Notas |\n|---|---|\n' || coalesce(v_pastas, '') ||
    E'\n\n## Por tipo\n\n| Tipo | Notas |\n|---|---|\n' || coalesce(v_tipos, '') ||
    E'\n\n## Mais ligadas\n\n' || coalesce(v_top, '') || E'\n\nAtualizado em ' ||
    to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') || E'.\n';

  insert into public.notes (path, title, body, tipo, updated_by)
  values ('00 Organização/Mapa.md', 'Mapa', v_body, 'meta', p_member)
  on conflict (path) do update set body = excluded.body, deleted_at = null, updated_by = p_member
  where public.notes.body is distinct from excluded.body or public.notes.deleted_at is not null;
  return jsonb_build_object('ok', true, 'notas', v_total);
end $$;

-- ---------- permissões ----------
revoke all on function public.fm_get(text, text) from public, anon, authenticated;
revoke all on function public.fm_set(text, text, text) from public, anon, authenticated;
revoke all on function public.notes_to_card() from public, anon, authenticated;
revoke all on function public.cards_to_note() from public, anon, authenticated;
revoke all on function public._tombstone(text, uuid) from public, anon, authenticated;
revoke all on function public._move_note(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public._append_note(uuid, text, text) from public, anon, authenticated;
revoke all on function public._learn(uuid, text, text) from public, anon, authenticated;
revoke all on function public._digest_txt(uuid, boolean) from public, anon, authenticated;
revoke all on function public._regen_map(uuid) from public, anon, authenticated;
grant execute on function public._move_note(uuid, text, text, integer) to service_role;
grant execute on function public._append_note(uuid, text, text) to service_role;
grant execute on function public._learn(uuid, text, text) to service_role;
grant execute on function public._digest_txt(uuid, boolean) to service_role;
grant execute on function public._regen_map(uuid) to service_role;

-- mover nota pelo front (membro logado)
create function public.move_note(p_path text, p_new text, p_base_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'não autorizado' using errcode = '42501'; end if;
  return public._move_note(v_me, p_path, p_new, p_base_version);
end $$;
revoke all on function public.move_note(text, text, integer) from public, anon;
grant execute on function public.move_note(text, text, integer) to authenticated;
