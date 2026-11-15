-- Convés · 0004 · tipo/dono/in_graph deduzidos no servidor (frontmatter e caminho)
create or replace function public._upsert_note(
  p_member uuid, p_path text, p_body text,
  p_base_version integer default null,
  p_title text default null, p_frontmatter jsonb default null,
  p_tipo text default null, p_owner text default null, p_in_graph boolean default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cur public.notes%rowtype; res public.notes%rowtype;
  v_fm text; v_tipo text; v_owner text; v_graph boolean;
begin
  v_fm := substring(p_body from '(?s)^---\r?\n(.*?)\r?\n---');
  v_tipo := coalesce(p_tipo, nullif(btrim(substring(v_fm from '(?m)^tipo:[ \t]*(.+)$'), ' "'''), ''));
  v_owner := coalesce(p_owner, nullif(btrim(substring(v_fm from '(?m)^dono:[ \t]*(.+)$'), ' "'''), ''));
  v_graph := coalesce(p_in_graph, not (p_path ~ '^Templates/' or p_path ~ '(^|/)CLAUDE\.md$'));

  select * into cur from public.notes where path = p_path for update;
  if not found then
    insert into public.notes (path, title, body, frontmatter, tipo, owner, in_graph, updated_by)
    values (p_path, coalesce(p_title, public.note_title(p_path)), p_body,
            coalesce(p_frontmatter, '{}'::jsonb), v_tipo, v_owner, v_graph, p_member)
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
    tipo = v_tipo, owner = v_owner, in_graph = v_graph,
    updated_by = p_member, deleted_at = null
  where id = cur.id returning * into res;
  return jsonb_build_object('ok', true, 'conflict', false, 'note', to_jsonb(res) - 'tsv');
end $$;
