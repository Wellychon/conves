# Convés

Contexto compartilhado para times pequenos que trabalham com o Claude Code: notas em Markdown sincronizadas, presença, kanban e grafo, tudo conectado por MCP. Construído com Supabase, Next.js e um CLI sem dependências.

```
Claude Code ─MCP/HTTP─► Edge Function "mcp" ─► Postgres (Supabase) ◄─Realtime─► Web (Vercel)
     ▲ hooks                                         ▲
     └── CLI `conves` ◄── pasta local (Obsidian) ◄───┘
```

- `supabase/migrations/` — schema, RLS, funções (aplique-as no seu projeto Supabase).
- `supabase/functions/mcp/` — servidor MCP v2: **5 ferramentas** (`ctx`, `note`, `card`, `log`, `me`) + **prompts** que viram comandos de barra (`/mcp__conves__minhas`, `resolver`, `concluir`, `quadro`, `aprender`).
- `cli/conves.mjs` — sync bidirecional, hooks (`hook prompt|touch|stop`, `digest`), modo `privado` e `daemon install|uninstall|status` (launchd, opcional). Sem dependências (Node 20+).
- `web/` — kanban, grafo, notas, equipe e decisões (Next.js 16, identidade **Traço e Sombra**, sem Tailwind).

## Web (`web/`)

```bash
cd web && npm install && npm run dev      # http://localhost:3000
```

`.env.local` (valores públicos, a chave é a *publishable*):
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

- **Login:** link por e-mail (sem senha). O e-mail precisa estar em `members`; o trigger liga o usuário ao membro.
- **Quadro:** arrastar entre colunas (Realtime), painel de edição, filtro por pessoa. Colunas se distinguem por textura: mais tinta = mais perto de feito.
- **Grafo:** `d3-force` em SVG; textura por tipo de nota, hover isola vizinhança, arrastar nós, zoom, aba "Lista" (tabela gêmea).
- **Notas:** busca full-text em português, prévia markdown, editor com controle de versão (conflito nunca sobrescreve).
- **Estilos:** `src/styles/tokens.css` e `componentes.css` definem a identidade visual (**Traço e Sombra**); `app.css` é específico do Convés.

### Deploy na Vercel (projeto `web/`, configure `NEXT_PUBLIC_SUPABASE_URL` e a chave publicável)

1. Importar este repositório (Root Directory = `web`), framework Next.js.
2. Variáveis: as duas `NEXT_PUBLIC_*` acima.
3. No Supabase → Authentication → URL Configuration: **Site URL** e **Redirect URLs** com o domínio da Vercel (e `http://localhost:3000` para dev).
4. E-mail de login: o SMTP padrão do Supabase só envia para membros da organização Supabase e tem limite baixo. Para outras pessoas receberem o link, convide-as na organização ou configure um SMTP próprio.

## Instalar numa máquina nova

1. Receber um **token pessoal** (criado por quem administra; só o hash fica no banco).
2. Criar `~/.conves/config.json` (permissão 600):
   ```json
   { "url": "https://<seu-projeto>.supabase.co/functions/v1/mcp", "token": "cvs_…", "vault": "/caminho/da/pasta" }
   ```
3. Baixar as notas e manter sincronizado: `node cli/conves.mjs sync --watch`.
4. Registrar no Claude Code (dentro da pasta do vault):
   `claude mcp add --transport http --scope local conves <url> --header "Authorization: Bearer <token>"`
5. Hooks (`.claude/settings.local.json`): `SessionStart → conves digest`, `PostToolUse → conves ping`, `Stop → conves ping --force`.

## Comandos

| Comando | O que faz |
|---|---|
| `conves sync [--watch]` | Sincroniza a pasta local com a nuvem (a cada 5 s e ao salvar) |
| `conves import` | Sobe todas as `.md` da pasta (carga inicial) |
| `conves digest` | Resumo do que mudou (usado no início da sessão) |
| `conves ping [--force]` | Renova a presença |
| `conves status` | Quem está ativo e em quê |

## Conflitos

Se a mesma nota mudar dos dois lados, **ninguém é sobrescrito**: a versão da nuvem vai para `Nota.conflito-nuvem.md`, a sua fica como está, e o envio dessa nota pausa. Resolva editando a nota e apague o arquivo `.conflito` para retomar.

## Segurança

- Nada de segredos, contratos ou dados pessoais de clientes nas notas.
- Tokens são pessoais e revogáveis (`tokens.revoked_at`); o banco guarda só o hash SHA-256.
- RLS ativa em todas as tabelas; só membros da allowlist de e-mails.
- Projeto no plano gratuito **pausa por inatividade**: migrar para Pro quando o uso for diário.


## v2 — automação e economia de tokens

| O quê | Quem faz | Tokens |
|---|---|---|
| Sincronizar notas | `conves sync` (hooks `SessionStart`/`Stop` ou daemon) | 0 |
| "O que está fazendo" | hook `UserPromptSubmit` (80 caracteres do pedido) | 0 |
| Arquivar `.md` do Inbox pelo `tipo:` | triggers no Postgres (`note_destinations`) | 0 |
| Card ↔ frontmatter da nota (`status`, `dono`, `prioridade`, `prazo`) | triggers nos dois sentidos | 0 |
| Resumo do que mudou | `digest` compacto; vazio quando nada mudou | ~0–300 |
| Pendências, contexto e "quem resolve" (claude/humano) | `/mcp__conves__minhas` | ~250 |

Migrations 0006–0008: automação, executor/pendências, destinos e a pasta `00 Organização` (regras, mapa gerado, aprendizados das IAs).

## Licença

[MIT](LICENSE).
