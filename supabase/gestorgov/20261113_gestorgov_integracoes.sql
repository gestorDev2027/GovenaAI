-- =============================================================================
-- GestorGov — Central de integrações (rode DEPOIS das de 11 e 12/11/2026)
-- Pode rodar de novo: nada é duplicado.
--
-- As integrações externas de cada organização viram ferramentas dos agentes (agente/integracoes.py):
--   postgres | mysql  bancos de outros sistemas (e o nosso, só leitura e com o organizacao_id preso pelo servidor);
--   http              APIs REST;
--   mcp               servidores MCP externos;
--   memoria           a memória compartilhada (Mem0 auto-hospedado, vetores no nosso pgvector).
-- O MCP Toolbox for Databases serve as fontes postgres, mysql e http (GESTORGOV_TOOLBOX=sim); o servidor monta a
-- configuração dele lendo os segredos do Vault na hora. Cada agente usa só as integrações liberadas na ficha dele
-- (fichas_agente.integracoes).
--
-- Segredos (senha do banco, chave da API): no Vault, pelas funções integracao_* abaixo (prefixo "integracao:").
-- Nas tabelas fica só a referência (o nome no Vault) e os 4 últimos caracteres, para conferir.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Integrações
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.integracoes (
  id                  uuid primary key default extensions.gen_random_uuid(),
  organizacao_id      uuid not null references gestorgov.organizacoes(id) on delete cascade,
  nome                text not null,
  descricao           text not null default '',
  tipo                text not null check (tipo in ('postgres', 'mysql', 'http', 'mcp', 'memoria')),
  endereco            text,                                   -- host (bancos) ou URL base (http, mcp)
  porta               integer,
  banco               text,                                   -- nome do banco (postgres, mysql)
  usuario             text,                                   -- usuário do banco (a senha fica no Vault)
  config              jsonb not null default '{}'::jsonb,     -- o que não é segredo: cabeçalho da chave, sslmode, escopo da memória...
  nosso_banco         boolean not null default false,         -- fonte no banco do GestorGov: só leitura, organizacao_id preso
  hosts_liberados     jsonb not null default '[]'::jsonb,     -- ["api.exemplo.gov.br", ...]
  segredo_ref         text,                                   -- o nome do segredo no Vault (sem o prefixo); nunca o valor
  segredo_final       text,                                   -- os 4 últimos caracteres, para conferir
  situacao            text not null default 'ativa' check (situacao in ('ativa', 'pausada')),
  limite_por_minuto   integer not null default 30 check (limite_por_minuto between 1 and 600),
  ultimo_teste_em     timestamptz,
  ultimo_teste_ok     boolean,
  ultimo_teste_detalhe text,
  criado_por          text not null,
  criado_em           timestamptz not null default now(),
  atualizado_por      text,
  atualizado_em       timestamptz not null default now(),
  unique (organizacao_id, nome)
);
create index if not exists ix_integracoes_organizacao on gestorgov.integracoes (organizacao_id);
comment on table gestorgov.integracoes is
  'Central de integrações: as fontes externas de cada organização. O segredo fica no Vault (segredo_ref é só o nome).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. As ferramentas de cada integração
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.integracao_ferramentas (
  id                  uuid primary key default extensions.gen_random_uuid(),
  organizacao_id      uuid not null references gestorgov.organizacoes(id) on delete cascade,
  integracao_id       uuid not null references gestorgov.integracoes(id) on delete cascade,
  nome                text not null check (nome ~ '^[a-z][a-z0-9_]{2,40}$'),
  descricao           text not null,
  sql                 text,                                   -- postgres, mysql: a consulta, com $1, $2... (ou ?)
  metodo              text,                                   -- http: GET, POST, PUT, PATCH, DELETE
  caminho             text,                                   -- http: o caminho depois da URL base
  corpo               text,                                   -- http: o corpo, com {{.parametro}}
  parametros          jsonb not null default '[]'::jsonb,     -- [{nome, tipo, descricao, obrigatorio, local}]
  altera_dados        boolean not null default false,         -- altera dados: cada chamada espera uma pessoa aprovar
  ativa               boolean not null default true,
  criado_por          text not null,
  criado_em           timestamptz not null default now(),
  atualizado_por      text,
  atualizado_em       timestamptz not null default now(),
  unique (integracao_id, nome)
);
create index if not exists ix_integracao_ferramentas_organizacao on gestorgov.integracao_ferramentas (organizacao_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cada chamada (auditoria). Sem os dados: nem a resposta nem os argumentos. Os argumentos de um pedido que
--    espera aprovação ficam aqui só até a decisão (com CPF e cartão mascarados) e são apagados em seguida.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.integracao_chamadas (
  id                  bigint generated always as identity primary key,
  organizacao_id      uuid not null references gestorgov.organizacoes(id) on delete cascade,
  integracao_id       uuid references gestorgov.integracoes(id) on delete set null,
  ferramenta_id       uuid references gestorgov.integracao_ferramentas(id) on delete set null,
  ferramenta          text not null,                          -- o nome, para a auditoria continuar legível
  agente_id           text,
  quem                text not null,                          -- e-mail da pessoa ou "agente:<id>"
  sessao_id           text,
  em                  timestamptz not null default now(),
  situacao            text not null check (situacao in ('ok', 'erro', 'recusada', 'aguardando_aprovacao', 'negada')),
  duracao_ms          integer,
  detalhe             text,                                   -- o motivo do erro ou da recusa (nunca a resposta)
  argumentos          jsonb,                                  -- só enquanto aguarda aprovação
  decidido_por        text,
  decidido_em         timestamptz
);
create index if not exists ix_integracao_chamadas_organizacao on gestorgov.integracao_chamadas (organizacao_id, em desc);
create index if not exists ix_integracao_chamadas_limite on gestorgov.integracao_chamadas (integracao_id, em desc);

grant select, insert, update, delete on gestorgov.integracoes, gestorgov.integracao_ferramentas to gestorgov_app;
grant select, insert, update on gestorgov.integracao_chamadas to gestorgov_app;   -- auditoria: sem delete
grant usage, select on all sequences in schema gestorgov to gestorgov_app;

do $$
declare t text;
begin
  foreach t in array array['integracoes', 'integracao_ferramentas', 'integracao_chamadas'] loop
    execute format('alter table gestorgov.%I enable row level security', t);
    execute format('drop policy if exists servidor_gestorgov on gestorgov.%I', t);
    execute format('create policy servidor_gestorgov on gestorgov.%I for all to gestorgov_app using (true) with check (true)', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Segredos das integrações (Vault)
--    O mesmo modelo das funções da Fábrica, com prefixo próprio: estas só alcançam "integracao:<nome>".
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function gestorgov.integracao_salvar_segredo(p_nome text, p_valor text, p_descricao text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := 'integracao:' || p_nome;
  v_id uuid;
begin
  if p_nome is null or p_nome !~ '^[a-z0-9-]{3,80}$' then
    raise exception 'nome de segredo inválido';
  end if;
  if p_valor is null or length(p_valor) < 1 or length(p_valor) > 8000 then
    raise exception 'valor de segredo inválido';
  end if;
  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then
    v_id := vault.create_secret(p_valor, v_nome, coalesce(p_descricao, ''));
  else
    perform vault.update_secret(v_id, p_valor, v_nome, coalesce(p_descricao, ''));
  end if;
  return v_id;
end;
$$;

create or replace function gestorgov.integracao_ler_segredo(p_nome text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'integracao:' || p_nome;
$$;

create or replace function gestorgov.integracao_apagar_segredo(p_nome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'integracao:' || p_nome;
  return found;
end;
$$;

revoke all on function gestorgov.integracao_salvar_segredo(text, text, text) from public;
revoke all on function gestorgov.integracao_ler_segredo(text) from public;
revoke all on function gestorgov.integracao_apagar_segredo(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function gestorgov.integracao_salvar_segredo(text, text, text) from anon, authenticated';
    execute 'revoke all on function gestorgov.integracao_ler_segredo(text) from anon, authenticated';
    execute 'revoke all on function gestorgov.integracao_apagar_segredo(text) from anon, authenticated';
  end if;
end $$;
grant execute on function gestorgov.integracao_salvar_segredo(text, text, text) to gestorgov_app;
grant execute on function gestorgov.integracao_ler_segredo(text) to gestorgov_app;
grant execute on function gestorgov.integracao_apagar_segredo(text) to gestorgov_app;
