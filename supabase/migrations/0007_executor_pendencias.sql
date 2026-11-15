-- Convés · 0007 · quem resolve (claude/humano) e como; pendências compactas para o Claude

alter table public.cards
  add column executor text check (executor in ('claude', 'humano', 'ambos')),
  add column como text not null default '';

-- pendências de uma pessoa, em texto curto (o Claude lê isso em vez de abrir o quadro todo)
create function public._mine(p_member uuid, p_detail boolean default true) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_head text; v_lines text; v_free int;
begin
  select 'pendentes: ' || count(*) ||
         ' (claude ' || count(*) filter (where executor = 'claude') ||
         ' · humano ' || count(*) filter (where executor = 'humano') ||
         ' · ambos ' || count(*) filter (where executor = 'ambos') ||
         ' · sem classificar ' || count(*) filter (where executor is null) || ')'
    into v_head
  from public.cards
  where assignee = p_member and status <> 'feito' and archived_at is null;

  select string_agg(
           '#' || left(id::text, 8) || ' [' || status || '|' || prioridade ||
           coalesce('|até ' || to_char(due, 'DD/MM'), '') || '|' || coalesce(executor, '?') || '] ' || title ||
           case when p_detail and body <> '' then E'\n  ctx: ' || left(replace(body, E'\n', ' '), 220) else '' end ||
           case when p_detail and como <> '' then E'\n  como: ' || left(replace(como, E'\n', ' '), 220) else '' end,
           E'\n' order by
             case status when 'fazendo' then 0 when 'revisao' then 1 when 'a_fazer' then 2 else 3 end,
             case prioridade when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end,
             due nulls last)
    into v_lines
  from public.cards
  where assignee = p_member and status <> 'feito' and archived_at is null;

  select count(*) into v_free from public.cards where assignee is null and status <> 'feito' and archived_at is null;

  return v_head || coalesce(E'\n' || v_lines, '') ||
         case when v_free > 0 then E'\nsem dono: ' || v_free else '' end;
end $$;

-- digest completo = o que mudou + minhas pendências (uma linha)
create function public._digest_full(p_member uuid, p_mark boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare v_d text; v_p text;
begin
  v_d := public._digest_txt(p_member, p_mark);
  select 'minhas pendências: ' || count(*) || ' (claude ' || count(*) filter (where executor = 'claude') ||
         ' · humano ' || count(*) filter (where executor = 'humano') ||
         ' · sem classificar ' || count(*) filter (where executor is null) || ')'
    into v_p
  from public.cards where assignee = p_member and status <> 'feito' and archived_at is null;
  if v_p like '%: 0 (%' then return v_d; end if;
  if v_d = 'nada novo' then return v_p; end if;
  return v_d || E'\n' || v_p;
end $$;

revoke all on function public._mine(uuid, boolean) from public, anon, authenticated;
revoke all on function public._digest_full(uuid, boolean) from public, anon, authenticated;
grant execute on function public._mine(uuid, boolean) to service_role;
grant execute on function public._digest_full(uuid, boolean) to service_role;
