-- Convés · 0003 · helpers de RLS fora do schema exposto na API (private)
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

alter function public.is_member() set schema private;
alter function public.current_member_id() set schema private;

-- upsert_note referenciava o helper pelo nome antigo
create or replace function public.upsert_note(
  p_path text, p_body text, p_base_version integer default null,
  p_title text default null, p_frontmatter jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'não autorizado' using errcode = '42501'; end if;
  return public._upsert_note(v_me, p_path, p_body, p_base_version, p_title, p_frontmatter);
end $$;
