-- Convés · 0008 · destinos de arquivamento configuráveis + pasta 00 Organização + learn para o front

create table public.note_destinations (
  tipo text primary key,
  pasta text not null
);
alter table public.note_destinations enable row level security;
create policy "membros leem destinos" on public.note_destinations for select to authenticated
  using ((select private.is_member()));

insert into public.note_destinations (tipo, pasta) values
  ('ideia', '01 Ideias'),
  ('pesquisa', '02 Pesquisa'), ('metodo', '02 Pesquisa'),
  ('entrevista', '02 Pesquisa/Entrevistas'), ('concorrente', '02 Pesquisa/Concorrentes'),
  ('dor', '02 Pesquisa/Dores'),
  ('decisao', '03 Decisões'), ('log', '03 Decisões'),
  ('reuniao', '04 Reuniões'),
  ('projeto', '06 Repertório/Projetos'), ('modulo', '06 Repertório/Módulos'),
  ('tarefa', '07 Quadro'),
  ('aprendizado', '00 Organização');

-- _upsert_note: o destino vem da tabela
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
  select pasta into v_dest from public.note_destinations where tipo = v_tipo;
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

  if v_path <> p_path then
    delete from public.notes where path = v_path and deleted_at is not null;
    update public.notes set path = v_path,
      title = case when res.title = public.note_title(p_path) then public.note_title(v_path) else res.title end
    where id = res.id returning * into res;
    perform public._tombstone(p_path, p_member);
  end if;
  return jsonb_build_object('ok', true, 'conflict', false, 'note', to_jsonb(res) - 'tsv');
end $$;

-- aprendizado registrado pelo front (membro logado)
create function public.learn(p_kind text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'não autorizado' using errcode = '42501'; end if;
  return public._learn(v_me, p_kind, p_text);
end $$;
revoke all on function public.learn(text, text) from public, anon;
grant execute on function public.learn(text, text) to authenticated;

-- ---------- 00 Organização: regras e aprendizados (o Mapa é gerado) ----------
insert into public.notes (path, title, body, tipo, updated_by)
select '00 Organização/Regras.md', 'Regras', $md$---
tipo: aprendizado
---

# Regras da vault

> Fonte única para humanos e IAs. A IA lê isto **sob demanda** (não precisa carregar a cada sessão).

## Onde cada coisa vai (arquivamento automático)

Uma nota nova solta em `00 Inbox` com `tipo:` no frontmatter é movida sozinha pelo Convés:

| tipo | pasta |
|---|---|
| ideia | 01 Ideias |
| pesquisa, metodo | 02 Pesquisa |
| entrevista, concorrente, dor | 02 Pesquisa/Entrevistas, /Concorrentes, /Dores |
| decisao, log | 03 Decisões |
| reuniao | 04 Reuniões |
| projeto, modulo | 06 Repertório/Projetos, /Módulos |
| tarefa | 07 Quadro |
| aprendizado | 00 Organização |

## Cards e notas

- Todo card pode ter um `.md` (propriedade `card:` no frontmatter). `status`, `dono`, `prioridade` e `prazo` são espelhados nos dois sentidos: mudar o `status:` no arquivo move o card.
- Cada card tem `executor`: **claude** (a IA resolve com as ferramentas), **humano** (exige decisão, pessoa, dinheiro ou acesso) ou **ambos**. O campo `como` guarda o passo a passo curto.

## Como a IA trabalha (economia de tokens)

1. **Edite o arquivo local**; o Convés sincroniza sozinho. Não use o MCP para ler ou gravar nota que já está na pasta.
2. O `digest` já roda ao abrir a sessão. Não repita.
3. Comandos: `/mcp__conves__minhas`, `/mcp__conves__resolver`, `/mcp__conves__concluir`, `/mcp__conves__quadro`, `/mcp__conves__aprender`.
4. Registre lições com `log op=learn` em **uma frase útil e atemporal**.
5. Nunca grave segredos, contratos ou dados pessoais de clientes.
6. Concluir cards em lote exige confirmação explícita do usuário.
$md$, 'aprendizado', (select id from public.members where slug = 'welly')
on conflict (path) do nothing;

insert into public.notes (path, title, body, tipo, updated_by)
select '00 Organização/Aprendizados das IAs.md', 'Aprendizados das IAs', $md$---
tipo: aprendizado
---

# Aprendizados das IAs

> Lições que as IAs da equipe registram para não repetir erros. Formato: `data · tipo · quem: lição`.
> Tipos: **erro**, **preferencia**, **padrao**, **atalho**, **regra**. O resumo vai no `digest`; este arquivo é o histórico.

## Registro
$md$, 'aprendizado', (select id from public.members where slug = 'welly')
on conflict (path) do nothing;

select public._regen_map((select id from public.members where slug = 'welly'));

-- ---------- permissões ----------
revoke all on function public._upsert_note(uuid, text, text, integer, text, jsonb, text, text, boolean) from public, anon, authenticated;
grant execute on function public._upsert_note(uuid, text, text, integer, text, jsonb, text, text, boolean) to service_role;
