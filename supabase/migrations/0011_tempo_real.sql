-- Convés · 0011 · tempo real: sessões vivas, linha do tempo, contexto por pedido, digest por sessão,
-- tokens com validade e quatro correções (mapa, varredura, concluídas, carimbo no INSERT)

-- ---------- helper de texto curto e seguro (uma linha, sem segredos, sem fechar o bloco de dados) ----------
create function public._limpar(p text, p_n integer) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p, ''), '(cvs_|sk-|eyJ)[A-Za-z0-9._-]{12,}', '[oculto]', 'g'),
             '<\s*/?\s*dados_do_quadro\s*>', '[dados_do_quadro]', 'gi'),
           '\s+', ' ', 'g')), greatest(p_n, 0))
$$;
revoke all on function public._limpar(text, integer) from public, anon, authenticated;
grant execute on function public._limpar(text, integer) to service_role;

-- ---------- tokens: validade opcional e last_used_at amostrado ----------
alter table public.tokens add column expires_at timestamptz;  -- null = não expira

create or replace function public._token_member(p_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_used timestamptz;
begin
  select member_id, last_used_at into v_id, v_used from public.tokens
   where hash = p_hash and revoked_at is null and (expires_at is null or expires_at > now());
  -- o retorno não depende do UPDATE; ele só roda se nunca foi usado ou passou mais de 1 minuto
  if v_id is not null and (v_used is null or v_used < now() - interval '1 minute') then
    update public.tokens set last_used_at = now() where hash = p_hash;
  end if;
  return v_id;
end $$;
revoke all on function public._token_member(text) from public, anon, authenticated;
grant execute on function public._token_member(text) to service_role;

-- ---------- sessões de IA (uma linha por sessão) ----------
create table public.sessoes (
  id text primary key,                         -- session_id do Claude Code
  member_id uuid not null references public.members(id) on delete cascade,
  client text not null default 'claude-code' check (client in ('claude-code', 'web', 'runner')),
  projeto text,                                -- basename do cwd (nunca caminho absoluto)
  titulo text,                                 -- 1º pedido limpo (até 80) ou 'Sessão privada'
  doing text,                                  -- pedido atual (até 80)
  ultimo_passo text,                           -- ex.: 'Edit · 01 Ideias/Crew.md' (até 120)
  card_id uuid references public.cards(id) on delete set null,
  destilacao_id uuid references public.destilacoes(id) on delete set null,
  estado text not null default 'ativa' check (estado in ('ativa', 'esperando', 'encerrada')),
  privado boolean not null default false,
  passos integer not null default 0,
  arquivos text[] not null default '{}',       -- últimos 10 caminhos da vault editados, do mais antigo ao mais novo
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  ended_at timestamptz
);
create index sessoes_member_idx on public.sessoes (member_id, last_seen desc);
create index sessoes_card_idx on public.sessoes (card_id);
create index sessoes_destilacao_idx on public.sessoes (destilacao_id);
create index sessoes_vivas_idx on public.sessoes (last_seen desc) where estado <> 'encerrada';

-- linha do tempo (só acrescenta; passo que não edita arquivo da vault não vira linha)
create table public.atividade (
  id bigint generated always as identity primary key,
  sessao_id text references public.sessoes(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  kind text not null check (kind in ('inicio', 'pedido', 'arquivo', 'espera', 'fim', 'destilar')),
  texto text not null default '',
  created_at timestamptz not null default now()
);
create index atividade_created_idx on public.atividade (created_at desc);
create index atividade_sessao_idx on public.atividade (sessao_id);
create index atividade_member_idx on public.atividade (member_id);

alter table public.sessoes enable row level security;
alter table public.atividade enable row level security;
create policy "membros leem sessoes" on public.sessoes for select to authenticated
  using ((select private.is_member()));
create policy "membros leem atividade" on public.atividade for select to authenticated
  using ((select private.is_member()));
-- nenhuma escrita direta: só pela RPC _sessao (service_role)
revoke insert, update, delete, truncate on public.sessoes, public.atividade from anon, authenticated;
revoke select on public.sessoes, public.atividade from anon;
alter publication supabase_realtime add table public.sessoes, public.atividade;

-- controle da limpeza barata (no máximo 1x a cada 10 min)
create table private.manutencao (chave text primary key, ultimo timestamptz not null);
alter table private.manutencao enable row level security;
insert into private.manutencao (chave, ultimo) values ('sessoes', now() - interval '1 day');

-- ---------- contexto por pedido: índices de texto em aprendizados e decisões ----------
-- pesos: sem eles o ts_rank (peso D) cai abaixo do corte de 0,05 e aprendizados/decisões nunca apareceriam
alter table public.learnings add column tsv tsvector generated always as (
  setweight(to_tsvector('portuguese'::regconfig, coalesce(body, '')), 'A') ||
  setweight(to_tsvector('portuguese'::regconfig, coalesce(kind, '')), 'C')
) stored;
create index learnings_tsv_idx on public.learnings using gin (tsv);

alter table public.decisions add column tsv tsvector generated always as (
  setweight(to_tsvector('portuguese'::regconfig, coalesce(decision, '')), 'A') ||
  setweight(to_tsvector('portuguese'::regconfig, coalesce(why, '')), 'B')
) stored;
create index decisions_tsv_idx on public.decisions using gin (tsv);

-- candidatos (aprendizados, decisões, notas) para uma consulta pronta; score = ts_rank normalizado (0 a 1)
create function public._contexto_busca(p_tq tsquery, p_limit integer default 8) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'tipo', r.tipo, 'texto', r.texto,
                                               'score', round(r.score::numeric, 3)) order by r.score desc, r.id), '[]'::jsonb)
  from (
    select c.id, c.tipo, c.score,
           case when c.tipo = 'nota'
                then public._limpar(c.base || ' · ' ||
                       regexp_replace(ts_headline('portuguese'::regconfig, c.corpo, p_tq,
                                                  'MaxFragments=1, MaxWords=18, MinWords=6'), '</?b>', '', 'g'), 200)
                else public._limpar(c.base, 200) end as texto
    from (
      select u.* from (
        select 'l:' || left(l.id::text, 8) as id, 'aprendizado'::text as tipo,
               ts_rank(l.tsv, p_tq, 32) as score, l.kind || ': ' || l.body as base, null::text as corpo
          from public.learnings l where l.tsv @@ p_tq
        union all
        select 'd:' || left(d.id::text, 8), 'decisao', ts_rank(d.tsv, p_tq, 32),
               to_char(d.decided_on, 'YYYY-MM-DD') || ' ' || d.decision ||
                 case when d.why <> '' then ' — ' || d.why else '' end, null
          from public.decisions d where d.tsv @@ p_tq
        union all
        select 'n:' || left(n.id::text, 8), 'nota', ts_rank(n.tsv, p_tq, 32), n.path, n.body
          from public.notes n
         where n.deleted_at is null and n.in_graph and n.tsv @@ p_tq
           and n.path not like 'Templates/%'
           and n.path not like '07 Quadro/Concluídas/%'
           and n.path not in ('00 Organização/Mapa.md', '00 Organização/Aprendizados das IAs.md')
      ) u
      where u.score >= 0.05
      order by u.score desc
      limit greatest(1, least(p_limit, 8))
    ) c
  ) r
$$;

-- tenta a consulta do websearch (todas as palavras); se nada passar do corte, tenta qualquer palavra (OU)
create function public._contexto(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := left(btrim(coalesce(p_q, '')), 500); v_tq tsquery; v_r jsonb; v_or text;
begin
  if length(v_q) < 3 then return '[]'::jsonb; end if;
  v_tq := websearch_to_tsquery('portuguese'::regconfig, v_q);
  if v_tq is not null and numnode(v_tq) > 0 then
    v_r := public._contexto_busca(v_tq);
    if jsonb_array_length(v_r) > 0 then return v_r; end if;
  end if;
  select string_agg('''' || translate(t.lexeme, E'\'\\', '') || '''', ' | ') into v_or
    from (select lexeme from unnest(to_tsvector('portuguese'::regconfig, v_q))
           where length(translate(lexeme, E'\'\\', '')) > 1 limit 20) t;
  if v_or is null then return '[]'::jsonb; end if;
  return public._contexto_busca(v_or::tsquery);
end $$;

revoke all on function public._contexto_busca(tsquery, integer) from public, anon, authenticated;
revoke all on function public._contexto(text) from public, anon, authenticated;
grant execute on function public._contexto_busca(tsquery, integer) to service_role;
grant execute on function public._contexto(text) to service_role;

-- ---------- RPC das sessões ----------
create function public._sessao(p_member uuid, p_id text, p_ev text, p_dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := case when jsonb_typeof(p_dados) = 'object' then p_dados else '{}'::jsonb end;
  s public.sessoes%rowtype;
  v_n integer; v_client text; v_priv boolean; v_dest uuid; v_proj text; v_text text; v_doing text;
  v_ctx jsonb := '[]'::jsonb; v_lote jsonb; v_cnt integer; v_ult jsonb; v_ultimo text;
  v_novos text[]; v_arq text[]; v_revive boolean;
begin
  if p_member is null or coalesce(p_id, '') = '' or length(p_id) > 128 then
    return jsonb_build_object('ok', false, 'error', 'sessao_invalida');
  end if;
  if coalesce(p_ev, '') not in ('inicio', 'pedido', 'passos', 'espera', 'fim') then
    return jsonb_build_object('ok', false, 'error', 'evento_invalido');
  end if;

  v_client := case when d->>'runner' in ('true', 't', '1') then 'runner'
                   when d->>'client' in ('claude-code', 'web', 'runner') then d->>'client'
                   else 'claude-code' end;
  v_priv := case when d->>'privado' is not null then d->>'privado' in ('true', 't', '1') end;  -- null = não informado
  v_proj := nullif(public._limpar(regexp_replace(coalesce(d->>'projeto', ''), '^.*[/\\]', ''), 60), '');
  select id into v_dest from public.destilacoes where id::text = lower(btrim(coalesce(d->>'destilacao', '')));

  -- garante a linha (o SessionStart pode ter falhado) e trava para serializar eventos da mesma sessão
  insert into public.sessoes (id, member_id, client, projeto, privado, destilacao_id)
  values (p_id, p_member, v_client, v_proj, coalesce(v_priv, false), v_dest)
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  select * into s from public.sessoes where id = p_id for update;
  if s.member_id <> p_member then
    return jsonb_build_object('ok', false, 'error', 'sessao_de_outro');
  end if;

  if p_ev = 'inicio' and v_n = 0 then  -- retomada: mantém passos e início, reabre
    update public.sessoes set client = v_client, projeto = coalesce(v_proj, projeto),
           privado = coalesce(v_priv, privado), destilacao_id = coalesce(v_dest, destilacao_id),
           estado = 'ativa', ended_at = null, last_seen = now()
     where id = p_id returning * into s;
  end if;
  if v_n > 0 or p_ev = 'inicio' then  -- sessão nova (mesmo criada por outro evento) ou início explícito
    insert into public.atividade (sessao_id, member_id, kind, texto)
    values (p_id, p_member, 'inicio', case when s.privado then 'sessão privada' else coalesce(s.projeto, '') end);
  end if;

  if p_ev = 'pedido' then
    v_priv := coalesce(v_priv, s.privado);
    v_text := nullif(public._limpar(d->>'text', 80), '');
    v_doing := case when v_priv then 'Sessão privada' else coalesce(v_text, 'Em sessão no Claude Code') end;
    update public.sessoes set
           doing = v_doing,
           titulo = case when v_priv then 'Sessão privada'
                         when titulo is null or titulo = 'Sessão privada' then v_doing
                         else titulo end,
           privado = v_priv, estado = 'ativa', ended_at = null, last_seen = now()
     where id = p_id returning * into s;
    insert into public.atividade (sessao_id, member_id, kind, texto)
    values (p_id, p_member, 'pedido', case when v_priv then 'pedido privado' else v_doing end);
    if not v_priv then v_ctx := public._contexto(d->>'q'); end if;  -- o texto do pedido (q) não é gravado

  elsif p_ev = 'passos' then
    -- lote limpo: até 200 passos, só objetos com ferramenta; alvo precisa ser caminho relativo
    select coalesce(jsonb_agg(jsonb_build_object('tool', x.tool, 'alvo', x.alvo) order by x.ord), '[]'::jsonb)
      into v_lote
      from (
        select t.ord, public._limpar(t.e->>'tool', 40) as tool,
               case when t.e->>'alvo' is null
                      or t.e->>'alvo' ~ '^(/|~|[A-Za-z]:)' or t.e->>'alvo' ~ '(^|[/\\])\.\.([/\\]|$)' then null
                    else nullif(public._limpar(t.e->>'alvo', 120), '') end as alvo
          from jsonb_array_elements(case when jsonb_typeof(d->'passos') = 'array' then d->'passos' else '[]'::jsonb end)
               with ordinality as t(e, ord)
         where t.ord <= 200 and jsonb_typeof(t.e) = 'object'
      ) x
     where x.tool <> '';
    v_cnt := jsonb_array_length(v_lote);
    v_revive := not (s.estado = 'encerrada' and s.ended_at > now() - interval '2 minutes');  -- flush atrasado após o fim não reabre

    if v_cnt > 0 and not s.privado then
      v_ult := v_lote->(v_cnt - 1);
      v_ultimo := left((v_ult->>'tool') || coalesce(' · ' || (v_ult->>'alvo'), ''), 120);
      select coalesce(array_agg(f.alvo order by f.ord), '{}') into v_novos from (
        select e->>'alvo' as alvo, max(o) as ord
          from jsonb_array_elements(v_lote) with ordinality as t(e, o)
         where e->>'tool' in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit') and e->>'alvo' is not null
         group by 1) f;
      -- uma linha 'arquivo' por alvo distinto do lote, na ordem da última ocorrência
      insert into public.atividade (sessao_id, member_id, kind, texto)
      select p_id, p_member, 'arquivo', f.tool || ' · ' || f.alvo
        from (select e->>'alvo' as alvo, (array_agg(e->>'tool' order by o desc))[1] as tool, max(o) as ord
                from jsonb_array_elements(v_lote) with ordinality as t(e, o)
               where e->>'tool' in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit') and e->>'alvo' is not null
               group by 1) f
       order by f.ord;
      -- 10 mais recentes, sem duplicar (vale a última ocorrência), do mais antigo ao mais novo
      select coalesce(array_agg(b.p order by b.o), '{}') into v_arq from (
        select a.p, a.o from (
          select t.p, t.o, row_number() over (partition by t.p order by t.o desc) as rn
            from unnest(s.arquivos || v_novos) with ordinality as t(p, o)) a
         where a.rn = 1 order by a.o desc limit 10) b;
    else
      v_arq := s.arquivos;
    end if;

    update public.sessoes set
           passos = passos + v_cnt,
           ultimo_passo = case when privado then null when v_cnt > 0 then v_ultimo else ultimo_passo end,
           arquivos = case when privado then arquivos else coalesce(v_arq, arquivos) end,
           last_seen = now(),
           estado = case when v_revive then 'ativa' else estado end,
           ended_at = case when v_revive then null else ended_at end
     where id = p_id returning * into s;

  elsif p_ev = 'espera' then
    update public.sessoes set estado = 'esperando', ended_at = null, last_seen = now()
     where id = p_id returning * into s;
    insert into public.atividade (sessao_id, member_id, kind, texto)
    values (p_id, p_member, 'espera', coalesce(s.doing, ''));

  elsif p_ev = 'fim' then
    update public.sessoes set estado = 'encerrada', ended_at = now(), last_seen = now()
     where id = p_id returning * into s;
    insert into public.atividade (sessao_id, member_id, kind, texto)
    values (p_id, p_member, 'fim', case when s.privado then 'sessão privada' else coalesce(s.projeto, '') end);
  end if;

  -- presença legada coerente (faixa antiga e CLI antigo); o card só entra por declaração
  if p_ev = 'fim' then
    if not exists (select 1 from public.sessoes o where o.member_id = p_member and o.estado <> 'encerrada'
                      and o.last_seen > now() - interval '15 minutes') then
      update public.presence set last_seen = least(last_seen, now() - interval '16 minutes') where member_id = p_member;
    end if;
  else
    perform public._ping(p_member,
      case when s.privado then 'Em sessão no Claude Code' else coalesce(s.doing, 'Sessão no Claude Code') end,
      s.card_id, null, s.client);
  end if;

  -- limpeza barata: no máximo 1x a cada 10 min
  update private.manutencao set ultimo = now() where chave = 'sessoes' and ultimo < now() - interval '10 minutes';
  if found then
    with enc as (
      update public.sessoes set estado = 'encerrada', ended_at = last_seen
       where estado <> 'encerrada' and last_seen < now() - interval '30 minutes'
       returning id, member_id)
    insert into public.atividade (sessao_id, member_id, kind, texto)
    select id, member_id, 'fim', 'sem sinal' from enc;
    delete from public.atividade where created_at < now() - interval '14 days';
    delete from public.sessoes where estado = 'encerrada' and last_seen < now() - interval '30 days';
  end if;

  return case when p_ev = 'pedido'
              then jsonb_build_object('ok', true, 'contexto', v_ctx)
              else jsonb_build_object('ok', true) end;
end $$;

-- vínculo declarado (me op=working card=…): sessão viva mais recente do membro
create function public._sessao_card(p_member uuid, p_card uuid) returns text
language sql security definer set search_path = '' as $$
  update public.sessoes set card_id = p_card
   where id = (select id from public.sessoes
                where member_id = p_member and estado <> 'encerrada' and last_seen > now() - interval '15 minutes'
                order by last_seen desc limit 1)
  returning id
$$;

revoke all on function public._sessao(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._sessao_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public._sessao(uuid, text, text, jsonb) to service_role;
grant execute on function public._sessao_card(uuid, uuid) to service_role;

-- ---------- digest por sessão ----------
alter table public.members add column prev_digest_at timestamptz;

-- corpo do digest desde um instante (sem marcar cursor); "agora" lista sessões vivas, inclusive outras do próprio membro
create function public._digest_corpo(p_member uuid, p_since timestamptz, p_sessao text default null) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_n text; v_c text; v_d text; v_a text; v_l text; v_out text := '';
  tz constant text := 'America/Sao_Paulo';
begin
  select string_agg(x, '; ') into v_n from (
    select n.title || ' (' || coalesce(m.nome, '?') || ' v' || n.version || ')' as x
    from public.notes n left join public.members m on m.id = n.updated_by
    where n.updated_at > p_since and n.updated_by is distinct from p_member and n.deleted_at is null
      and n.path not like '00 Organização/Mapa%' and n.path not like '07 Quadro/Concluídas/%'
    order by n.updated_at desc limit 8) t;

  select string_agg(x, '; ') into v_c from (
    select coalesce(m.nome, '?') || ' ' || e.kind || ' "' || left(coalesce(e.data->>'title', ''), 40) || '"' ||
           coalesce(' → ' || (e.data->>'para'), '') as x
    from public.card_events e left join public.members m on m.id = e.member_id
    where e.created_at > p_since and e.member_id is distinct from p_member
    order by e.created_at desc limit 8) t;

  select string_agg(x, '; ') into v_d from (
    select left(d.decision, 70) || ' [' || d.status || ']' || case when d.sweep_pending then ' ⟳varrer' else '' end as x
    from public.decisions d
    where d.created_at > p_since and d.created_by is distinct from p_member
    order by d.created_at desc limit 5) t;

  select string_agg(u.x, '; ' order by u.visto desc) into v_a from (
    select * from (
      select m.nome || coalesce('·' || s.projeto, '') || ': ' ||
             case when s.privado then 'sessão privada'
                  else coalesce(left(s.doing, 80), 'ativo') ||
                       case when s.estado = 'esperando' then ' (esperando resposta)'
                            when s.ultimo_passo ~ '^(Edit|Write|MultiEdit|NotebookEdit) ' and cardinality(s.arquivos) > 0
                              then ' (editando ' || s.arquivos[cardinality(s.arquivos)] || ')'
                            else '' end
             end || coalesce(' [' || left(c.title, 30) || ']', '') as x,
             s.last_seen as visto
        from public.sessoes s
        join public.members m on m.id = s.member_id
        left join public.cards c on c.id = s.card_id
       where s.estado <> 'encerrada' and s.last_seen > now() - interval '15 minutes'
         and s.id is distinct from p_sessao
      union all  -- quem ainda usa o CLI antigo aparece pela presença legada
      select m.nome || ': ' || coalesce(left(p.doing, 80), 'ativo') || coalesce(' [' || left(c.title, 30) || ']', ''),
             p.last_seen
        from public.presence p
        join public.members m on m.id = p.member_id
        left join public.cards c on c.id = p.card_id
       where p.last_seen > now() - interval '15 minutes' and p.member_id <> p_member
         and not exists (select 1 from public.sessoes s where s.member_id = p.member_id
                            and s.estado <> 'encerrada' and s.last_seen > now() - interval '15 minutes')
    ) w order by w.visto desc limit 6) u;

  select string_agg(x, E'\n') into v_l from (
    select '  ' || l.kind || ': ' || left(l.body, 140) || ' (' || coalesce(m.nome, '?') || ')' as x
    from public.learnings l left join public.members m on m.id = l.member_id
    where l.created_at > p_since and l.member_id is distinct from p_member
    order by l.created_at desc limit 3) t;

  if v_n is not null then v_out := v_out || E'\nnotas: ' || v_n; end if;
  if v_c is not null then v_out := v_out || E'\ncards: ' || v_c; end if;
  if v_d is not null then v_out := v_out || E'\ndecisões: ' || v_d; end if;
  if v_a is not null then v_out := v_out || E'\nagora: ' || v_a; end if;
  if v_l is not null then v_out := v_out || E'\naprendizados:\n' || v_l; end if;

  if v_out = '' then return 'nada novo'; end if;
  return 'desde ' || to_char(p_since at time zone tz, 'DD/MM HH24:MI') || v_out;
end $$;

-- a assinatura muda (3º argumento): a versão antiga sai para a chamada de 2 argumentos não ficar ambígua
drop function public._digest_full(uuid, boolean);

create function public._digest_full(p_member uuid, p_mark boolean default true, p_sessao text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_d text; v_p text; v_rev text := ''; v_dest text := ''; v_sweeps int; v_last timestamptz; v_quem text;
  v_n int; v_cur timestamptz; v_prev timestamptz; v_since timestamptz; v_outra boolean;
  tz constant text := 'America/Sao_Paulo';
begin
  select last_digest_at, prev_digest_at into v_cur, v_prev from public.members where id = p_member for no key update;

  -- com outra sessão viva do mesmo membro o cursor não avança: as sessões paralelas veem o mesmo contexto
  v_outra := exists (select 1 from public.sessoes s
                      where s.member_id = p_member and s.id is distinct from p_sessao
                        and s.estado <> 'encerrada' and s.last_seen > now() - interval '15 minutes');
  v_since := case when v_outra then coalesce(v_prev, v_cur, now() - interval '3 days')
                  else coalesce(v_cur, now() - interval '3 days') end;
  if p_mark and not v_outra then
    update public.members set prev_digest_at = coalesce(last_digest_at, now() - interval '3 days'),
                              last_digest_at = now()
     where id = p_member;
  end if;

  v_d := public._digest_corpo(p_member, v_since, p_sessao);

  select 'minhas pendências: ' || count(*) || ' (claude ' || count(*) filter (where executor = 'claude') ||
         ' · humano ' || count(*) filter (where executor = 'humano') ||
         ' · ambos ' || count(*) filter (where executor = 'ambos') ||
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

revoke all on function public._digest_corpo(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public._digest_full(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public._digest_corpo(uuid, timestamptz, text) to service_role;
grant execute on function public._digest_full(uuid, boolean, text) to service_role;

-- ---------- correção 1: _regen_map com quebra de linha de verdade (antes saía "\n" literal) ----------
create or replace function public._regen_map(p_member uuid) returns jsonb
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
    '**' || v_total || E' notas.**\n\n## Por pasta\n\n| Pasta | Notas |\n|---|---|\n' || coalesce(v_pastas, '') ||
    E'\n\n## Por tipo\n\n| Tipo | Notas |\n|---|---|\n' || coalesce(v_tipos, '') ||
    E'\n\n## Mais ligadas\n\n' || coalesce(v_top, '') || E'\n\nAtualizado em ' ||
    to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') || E'.\n';

  insert into public.notes (path, title, body, tipo, updated_by)
  values ('00 Organização/Mapa.md', 'Mapa', v_body, 'meta', p_member)
  on conflict (path) do update set body = excluded.body, deleted_at = null, updated_by = p_member
  where public.notes.body is distinct from excluded.body or public.notes.deleted_at is not null;
  return jsonb_build_object('ok', true, 'notas', v_total);
end $$;
revoke all on function public._regen_map(uuid) from public, anon, authenticated;
grant execute on function public._regen_map(uuid) to service_role;

-- ---------- correção 2: _sweep_done não varre tudo com prefixo vazio ou curto ----------
create or replace function public._sweep_done(p_member uuid, p_prefix text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int; v_p text := lower(btrim(replace(coalesce(p_prefix, ''), '#', '')));
begin
  if v_p !~ '^[0-9a-f][0-9a-f-]{3,35}$' then
    return jsonb_build_object('ok', false, 'n', 0, 'error', 'prefixo_invalido');  -- mínimo de 4 caracteres hexadecimais
  end if;
  select count(*) into v_n from public.decisions where sweep_pending and id::text like v_p || '%';
  if v_n > 1 then
    return jsonb_build_object('ok', false, 'n', v_n, 'error', 'prefixo_ambiguo');
  end if;
  update public.decisions set sweep_pending = false, swept_at = now()
   where sweep_pending and id::text like v_p || '%';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;
revoke all on function public._sweep_done(uuid, text) from public, anon, authenticated;
grant execute on function public._sweep_done(uuid, text) to service_role;

-- ---------- correções 3 e 4: concluídas (saída de "feito" e carimbo no INSERT) ----------
-- nota mensal sem nenhum card concluído: em vez de ficar velha, vira "nenhuma atividade"
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
  v_body := E'---\ntipo: meta\n---\n\n# Atividades concluídas · ' || p_month ||
            E'\n\n> Gerado automaticamente a partir dos cards do Convés. Não edite aqui: edite o **resultado** no card.\n\n' ||
            coalesce(v_dias, '_Nenhuma atividade concluída neste mês._') || E'\n';
  if v_dias is null then  -- só atualiza uma nota que já existe; não cria nota vazia
    update public.notes set body = v_body
     where path = '07 Quadro/Concluídas/' || p_month || '.md' and deleted_at is null and body is distinct from v_body;
    return;
  end if;
  insert into public.notes (path, title, body, tipo)
  values ('07 Quadro/Concluídas/' || p_month || '.md', 'Concluídas ' || p_month, v_body, 'meta')
  on conflict (path) do update set body = excluded.body, deleted_at = null
  where public.notes.body is distinct from excluded.body or public.notes.deleted_at is not null;
end $$;
revoke all on function public._regen_concluidas(text) from public, anon, authenticated;

create or replace function public.cards_concluir() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'feito' and new.concluido_em is null then
      new.concluido_em := now(); new.concluido_por := coalesce(new.concluido_por, new.updated_by);
    end if;
  elsif new.status = 'feito' and old.status is distinct from 'feito' then
    new.concluido_em := now(); new.concluido_por := new.updated_by;
  elsif new.status <> 'feito' and old.status = 'feito' then
    new.concluido_em := null; new.concluido_por := null;
  end if;
  return new;
end $$;
drop trigger cards_z_concluir on public.cards;
create trigger cards_z_concluir before insert or update of status on public.cards
  for each row execute function public.cards_concluir();

create or replace function public.cards_concluidas_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tz constant text := 'America/Sao_Paulo'; v_novo text; v_velho text;
begin
  v_novo := case when new.status = 'feito' and new.concluido_em is not null
                 then to_char(new.concluido_em at time zone tz, 'YYYY-MM') end;
  v_velho := case when tg_op = 'UPDATE' and old.status = 'feito' and old.concluido_em is not null
                  then to_char(old.concluido_em at time zone tz, 'YYYY-MM') end;
  if v_novo is not null then perform public._regen_concluidas(v_novo); end if;
  -- saiu de "feito" (ou mudou de mês): regera o mês antigo para o card sumir da nota
  if v_velho is not null and v_velho is distinct from v_novo then perform public._regen_concluidas(v_velho); end if;
  return new;
end $$;
drop trigger cards_concluidas_log on public.cards;
create trigger cards_concluidas_log after update of status, resultado, title on public.cards
  for each row
  when ((new.status = 'feito' and new.concluido_em is not null) or (old.status = 'feito' and old.concluido_em is not null))
  execute function public.cards_concluidas_log();
create trigger cards_concluidas_log_ins after insert on public.cards
  for each row when (new.status = 'feito' and new.concluido_em is not null)
  execute function public.cards_concluidas_log();

revoke all on function public.cards_concluir() from public, anon, authenticated;
revoke all on function public.cards_concluidas_log() from public, anon, authenticated;

-- aplica a correção do mapa já (o Mapa.md da nuvem tem "\n" literal)
select public._regen_map((select id from public.members where slug = 'welly'));
