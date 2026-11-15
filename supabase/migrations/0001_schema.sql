-- Convés · 0001 · schema base: membros, tokens, notas, links, kanban, presença, decisões

-- ---------- membros e tokens ----------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  nome text not null,
  slug text not null unique,
  textura text not null default 'hachura',
  last_digest_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  nome text not null,
  hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index tokens_member_idx on public.tokens (member_id);

-- ---------- helpers de nome ----------
create function public.note_slug(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(regexp_replace(p, '^.*/', ''), '\.md$', ''))
$$;

create function public.note_title(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(p, '^.*/', ''), '\.md$', '')
$$;

-- ---------- notas e links ----------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  slug text generated always as (public.note_slug(path)) stored,
  title text not null,
  body text not null default '',
  frontmatter jsonb not null default '{}'::jsonb,
  tipo text,
  owner text,
  in_graph boolean not null default true,
  version integer not null default 1,
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tsv tsvector generated always as (
    setweight(to_tsvector('portuguese'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('portuguese'::regconfig, coalesce(body, '')), 'B')
  ) stored
);
create index notes_tsv_idx on public.notes using gin (tsv);
create index notes_slug_idx on public.notes (slug);
create index notes_updated_idx on public.notes (updated_at desc);
create index notes_updated_by_idx on public.notes (updated_by);

create table public.links (
  src uuid not null references public.notes(id) on delete cascade,
  dst_title text not null,
  dst uuid references public.notes(id) on delete set null,
  primary key (src, dst_title)
);
create index links_dst_idx on public.links (dst);

create function public.notes_bump() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;
create trigger notes_bump before update on public.notes
  for each row execute function public.notes_bump();

-- extrai [[wikilinks]] do corpo e resolve pelo nome do arquivo
create function public.notes_sync_links() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.links where src = new.id;
  insert into public.links (src, dst_title, dst)
  select new.id, t.target,
         (select n.id from public.notes n
           where n.slug = lower(t.target) and n.deleted_at is null and n.id <> new.id
           limit 1)
  from (
    select distinct btrim(m[1]) as target
    from regexp_matches(new.body, '\[\[([^\]\|#]+)', 'g') as m
  ) t
  where t.target <> '';
  if tg_op = 'INSERT' then
    update public.links set dst = new.id
     where dst is null and lower(dst_title) = new.slug and src <> new.id;
  end if;
  return new;
end $$;
create trigger notes_sync_links after insert or update of body on public.notes
  for each row execute function public.notes_sync_links();

-- ---------- kanban ----------
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now()
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null,
  body text not null default '',
  status text not null default 'backlog'
    check (status in ('backlog', 'a_fazer', 'fazendo', 'revisao', 'feito')),
  position double precision not null default 0,
  assignee uuid references public.members(id) on delete set null,
  prioridade text not null default 'media'
    check (prioridade in ('baixa', 'media', 'alta', 'urgente')),
  due date,
  note_id uuid references public.notes(id) on delete set null,
  labels text[] not null default '{}',
  created_by uuid references public.members(id) on delete set null,
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index cards_board_idx on public.cards (board_id, status, position);
create index cards_assignee_idx on public.cards (assignee);
create index cards_note_idx on public.cards (note_id);
create index cards_created_by_idx on public.cards (created_by);
create index cards_updated_by_idx on public.cards (updated_by);

create table public.card_events (
  id bigint generated always as identity primary key,
  card_id uuid references public.cards(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index card_events_card_idx on public.card_events (card_id);
create index card_events_member_idx on public.card_events (member_id);
create index card_events_created_idx on public.card_events (created_at desc);

-- ---------- presença e decisões ----------
create table public.presence (
  member_id uuid primary key references public.members(id) on delete cascade,
  card_id uuid references public.cards(id) on delete set null,
  note_id uuid references public.notes(id) on delete set null,
  doing text,
  client text,
  last_seen timestamptz not null default now()
);
create index presence_card_idx on public.presence (card_id);
create index presence_note_idx on public.presence (note_id);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  decided_on date not null default current_date,
  decision text not null,
  why text not null default '',
  who text[] not null default '{}',
  review_on date,
  status text not null default 'tomada' check (status in ('tomada', 'pendente', 'revisar')),
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index decisions_created_by_idx on public.decisions (created_by);

-- ---------- funções de acesso ----------
create function public.current_member_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where user_id = (select auth.uid())
$$;

create function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()))
$$;

-- liga o usuário do Auth ao membro pela allowlist de e-mails
create function public.link_member_on_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.members set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.link_member_on_signup();

-- ---------- triggers do kanban ----------
create function public.cards_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me uuid;
begin
  select id into v_me from public.members where user_id = (select auth.uid());
  if v_me is not null then new.updated_by := v_me; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger cards_touch before insert or update on public.cards
  for each row execute function public.cards_touch();

create function public.cards_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.card_events (card_id, member_id, kind, data)
    values (new.id, new.updated_by, 'criado',
            jsonb_build_object('title', new.title, 'status', new.status));
  elsif new.status is distinct from old.status then
    insert into public.card_events (card_id, member_id, kind, data)
    values (new.id, new.updated_by, 'movido',
            jsonb_build_object('title', new.title, 'de', old.status, 'para', new.status));
  elsif new.assignee is distinct from old.assignee then
    insert into public.card_events (card_id, member_id, kind, data)
    values (new.id, new.updated_by, 'atribuido',
            jsonb_build_object('title', new.title, 'assignee', new.assignee));
  end if;
  return new;
end $$;
create trigger cards_log after insert or update on public.cards
  for each row execute function public.cards_log();

-- ---------- operações do MCP/sync (só service_role) ----------
create function public._token_member(p_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.tokens set last_used_at = now()
   where hash = p_hash and revoked_at is null
   returning member_id into v_id;
  return v_id;
end $$;

-- grava nota com controle de versão: nunca sobrescreve em silêncio
create function public._upsert_note(
  p_member uuid, p_path text, p_body text,
  p_base_version integer default null,
  p_title text default null, p_frontmatter jsonb default null,
  p_tipo text default null, p_owner text default null, p_in_graph boolean default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.notes%rowtype; res public.notes%rowtype;
begin
  select * into cur from public.notes where path = p_path for update;
  if not found then
    insert into public.notes (path, title, body, frontmatter, tipo, owner, in_graph, updated_by)
    values (p_path, coalesce(p_title, public.note_title(p_path)), p_body,
            coalesce(p_frontmatter, '{}'::jsonb), p_tipo, p_owner,
            coalesce(p_in_graph, true), p_member)
    returning * into res;
    return jsonb_build_object('ok', true, 'conflict', false, 'created', true, 'note', to_jsonb(res) - 'tsv');
  end if;

  if cur.deleted_at is null
     and p_base_version is distinct from cur.version
     and cur.body is distinct from p_body then
    return jsonb_build_object('ok', false, 'conflict', true, 'note', to_jsonb(cur) - 'tsv');
  end if;

  if cur.deleted_at is null and cur.body = p_body
     and (p_title is null or p_title = cur.title)
     and (p_frontmatter is null or p_frontmatter = cur.frontmatter) then
    return jsonb_build_object('ok', true, 'conflict', false, 'unchanged', true, 'note', to_jsonb(cur) - 'tsv');
  end if;

  update public.notes set
    body = p_body,
    title = coalesce(p_title, cur.title),
    frontmatter = coalesce(p_frontmatter, cur.frontmatter),
    tipo = coalesce(p_tipo, cur.tipo),
    owner = coalesce(p_owner, cur.owner),
    in_graph = coalesce(p_in_graph, cur.in_graph),
    updated_by = p_member,
    deleted_at = null
  where id = cur.id returning * into res;
  return jsonb_build_object('ok', true, 'conflict', false, 'note', to_jsonb(res) - 'tsv');
end $$;

create function public._delete_note(p_member uuid, p_path text, p_base_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur public.notes%rowtype;
begin
  select * into cur from public.notes where path = p_path for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'nao_encontrada'); end if;
  if p_base_version is distinct from cur.version then
    return jsonb_build_object('ok', false, 'conflict', true, 'note', to_jsonb(cur) - 'tsv');
  end if;
  update public.notes set deleted_at = now(), updated_by = p_member where id = cur.id;
  return jsonb_build_object('ok', true);
end $$;

create function public._ping(
  p_member uuid, p_doing text, p_card uuid default null,
  p_note uuid default null, p_client text default null
) returns void language sql security definer set search_path = '' as $$
  insert into public.presence (member_id, card_id, note_id, doing, client, last_seen)
  values (p_member, p_card, p_note, p_doing, p_client, now())
  on conflict (member_id) do update set
    card_id = excluded.card_id, note_id = excluded.note_id,
    doing = excluded.doing, client = coalesce(excluded.client, public.presence.client),
    last_seen = now()
$$;

create function public._search(p_query text, p_limit integer default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r), '[]'::jsonb) from (
    select n.path, n.title, n.version, n.updated_at,
           ts_headline('portuguese'::regconfig, n.body, q, 'MaxFragments=2, MaxWords=24, MinWords=8') as trecho,
           ts_rank(n.tsv, q) as rank
    from public.notes n, websearch_to_tsquery('portuguese'::regconfig, p_query) q
    where n.deleted_at is null and n.tsv @@ q
    order by rank desc limit greatest(1, least(p_limit, 30))
  ) r
$$;

-- o que mudou desde a última vez que este membro olhou
create function public._digest(p_member uuid, p_mark boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_since timestamptz; v_out jsonb;
begin
  select coalesce(last_digest_at, now() - interval '7 days') into v_since
    from public.members where id = p_member;
  v_out := jsonb_build_object(
    'desde', v_since,
    'notas', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select n.path, n.title, n.version, n.updated_at, m.nome as por
        from public.notes n left join public.members m on m.id = n.updated_by
        where n.updated_at > v_since and n.updated_by is distinct from p_member and n.deleted_at is null
        order by n.updated_at desc limit 30) x),
    'cards', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select e.kind, e.data, e.created_at, m.nome as por
        from public.card_events e left join public.members m on m.id = e.member_id
        where e.created_at > v_since and e.member_id is distinct from p_member
        order by e.created_at desc limit 30) x),
    'decisoes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select d.decided_on, d.decision, d.status
        from public.decisions d
        where d.created_at > v_since and d.created_by is distinct from p_member
        order by d.created_at desc limit 20) x),
    'equipe', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select m.nome, p.doing, p.last_seen, c.title as card, n.title as nota
        from public.presence p
        join public.members m on m.id = p.member_id
        left join public.cards c on c.id = p.card_id
        left join public.notes n on n.id = p.note_id
        where p.last_seen > now() - interval '15 minutes' and p.member_id <> p_member) x)
  );
  if p_mark then
    update public.members set last_digest_at = now() where id = p_member;
  end if;
  return v_out;
end $$;

-- ---------- permissões das funções ----------
revoke all on function public.notes_bump() from public, anon, authenticated;
revoke all on function public.notes_sync_links() from public, anon, authenticated;
revoke all on function public.cards_touch() from public, anon, authenticated;
revoke all on function public.cards_log() from public, anon, authenticated;
revoke all on function public.link_member_on_signup() from public, anon, authenticated;
revoke all on function public.current_member_id() from public, anon;
revoke all on function public.is_member() from public, anon;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.is_member() to authenticated;

revoke all on function public._token_member(text) from public, anon, authenticated;
revoke all on function public._upsert_note(uuid, text, text, integer, text, jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public._delete_note(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._ping(uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._search(text, integer) from public, anon, authenticated;
revoke all on function public._digest(uuid, boolean) from public, anon, authenticated;
grant execute on function public._token_member(text) to service_role;
grant execute on function public._upsert_note(uuid, text, text, integer, text, jsonb, text, text, boolean) to service_role;
grant execute on function public._delete_note(uuid, text, integer) to service_role;
grant execute on function public._ping(uuid, text, uuid, uuid, text) to service_role;
grant execute on function public._search(text, integer) to service_role;
grant execute on function public._digest(uuid, boolean) to service_role;

-- versão para o front (usuário logado): grava como o próprio membro
create function public.upsert_note(
  p_path text, p_body text, p_base_version integer default null,
  p_title text default null, p_frontmatter jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.current_member_id();
begin
  if v_me is null then raise exception 'não autorizado' using errcode = '42501'; end if;
  return public._upsert_note(v_me, p_path, p_body, p_base_version, p_title, p_frontmatter);
end $$;
revoke all on function public.upsert_note(text, text, integer, text, jsonb) from public, anon;
grant execute on function public.upsert_note(text, text, integer, text, jsonb) to authenticated;
