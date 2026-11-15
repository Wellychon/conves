-- Convés · 0005 · apagar nota pelo front (membro logado, com checagem de versão)
create function public.delete_note(p_path text, p_base_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'não autorizado' using errcode = '42501'; end if;
  return public._delete_note(v_me, p_path, p_base_version);
end $$;
revoke all on function public.delete_note(text, integer) from public, anon;
grant execute on function public.delete_note(text, integer) to authenticated;
