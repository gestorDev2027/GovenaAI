-- =============================================================================
-- GestorGov — banco (esquema consolidado de 11/11/2026)
-- Rode inteiro, de uma vez, no SQL Editor, num projeto Supabase novo. Depois rode, na ordem:
--   20261111_gestorgov_2_saude.sql    (catálogo do segmento Saúde pública)
--   20261111_gestorgov_3_empresa.sql  (catálogo do segmento Empresa)
-- Pode rodar de novo: nada é duplicado.
--
-- O GestorGov serve a organizações de vários SEGMENTOS (Saúde pública, Empresa...). Cada segmento tem os seus
-- modelos (tipos de área, de unidade, atividades, cargos e indicadores) e os nomes de tela dele
-- (agente/segmentos.py): na saúde, a organização é a Secretaria de Saúde e as áreas são os setores; numa empresa,
-- a organização é a empresa e as áreas são os departamentos.
--
--   Organização → Áreas → Atividades → Agente da área → Pessoa que aprova
--               → Unidades (UBS, UPA... ou filiais, lojas, depósitos)
--
-- O que este script faz:
--   1. Schema `gestorgov` e o papel do servidor `gestorgov_app` (sem login até você ligar, no fim).
--   2. Extensões: pgvector (busca por semelhança nos documentos) e pgcrypto (ids).
--   3. Buckets PRIVADOS no Storage: `agentes` (documentos) e `organizacoes` (fotos das unidades).
--   4. Cofre das chaves de API da Fábrica, no Vault do Supabase.
--   5. Tabelas: segmentos, catálogos, organizações, áreas, unidades, pessoas, atividades, agentes, organograma,
--      membros e convites, implantação, fichas dos agentes e auditoria. Tudo separado por organizacao_id.
--   6. Permissões e RLS.
--
-- O que ele NÃO cria (o servidor cria ao iniciar, dentro de `gestorgov`):
--   - as tabelas do Agno: sessões, memórias, avaliações, traces, agendamentos e as do CompanyOS;
--   - as do painel: fabrica_*, conhecimento_*, guardrail_frases, painel_usuarios, painel_contas etc.
--
-- Substitui as migrations de 06 a 10/11/2026 (inicial, atividades, organograma, unidades, prefeitura, agentes),
-- que nunca rodaram em produção.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema e papel do servidor
-- ─────────────────────────────────────────────────────────────────────────────
create schema if not exists gestorgov;
comment on schema gestorgov is
  'GestorGov: agentes de IA que trabalham com as pessoas de cada organização (secretarias de saúde, empresas...).';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'gestorgov_app') then
    create role gestorgov_app nologin;
  end if;
end $$;

-- O servidor usa e cria tabelas SÓ dentro de `gestorgov`. Não enxerga public, auth nem storage.
grant usage, create on schema gestorgov to gestorgov_app;

-- Ninguém de fora (chaves anon/authenticated da API) alcança o schema.
revoke all on schema gestorgov from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema gestorgov from anon, authenticated';
  end if;
end $$;

-- As tabelas que o SQL Editor criar no futuro neste schema já nascem liberadas para o servidor.
alter default privileges in schema gestorgov
  grant select, insert, update, delete on tables to gestorgov_app;
alter default privileges in schema gestorgov
  grant usage, select on sequences to gestorgov_app;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Extensões
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

grant usage on schema extensions to gestorgov_app;
alter role gestorgov_app set search_path = gestorgov, extensions, public;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Storage: buckets privados (sem políticas para anon/authenticated: só o servidor lê e grava)
--    agentes:      conhecimento/<agente>/<documento>/v<versão>/<arquivo>
--    organizacoes: <organizacao>/unidades/<unidade>/<foto>.jpg (fotos reduzidas, sem metadados)
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agentes',
  'agentes',
  false,
  26214400,  -- 25 MB por arquivo
  array[
    'application/pdf',
    'text/markdown',
    'text/plain',
    'text/csv',
    'application/rtf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   -- .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         -- .xlsx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'  -- .pptx
  ]
)
on conflict (id) do update
  set allowed_mime_types = excluded.allowed_mime_types,
      file_size_limit    = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organizacoes', 'organizacoes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set allowed_mime_types = excluded.allowed_mime_types,
      file_size_limit    = excluded.file_size_limit;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cofre das chaves de API (Vault)
--    O servidor não acessa o Vault direto: estas funções só alcançam segredos com o prefixo "fabrica:".
--    O painel nunca recebe o valor de volta.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function gestorgov.fabrica_salvar_segredo(p_nome text, p_valor text, p_descricao text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := 'fabrica:' || p_nome;
  v_id uuid;
begin
  if p_nome is null or p_nome !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'nome de chave inválido';
  end if;
  if p_valor is null or length(p_valor) < 8 or length(p_valor) > 4000 then
    raise exception 'valor de chave inválido';
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

create or replace function gestorgov.fabrica_ler_segredo(p_nome text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'fabrica:' || p_nome;
$$;

create or replace function gestorgov.fabrica_apagar_segredo(p_nome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'fabrica:' || p_nome;
  return found;
end;
$$;

revoke all on function gestorgov.fabrica_salvar_segredo(text, text, text) from public;
revoke all on function gestorgov.fabrica_ler_segredo(text) from public;
revoke all on function gestorgov.fabrica_apagar_segredo(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function gestorgov.fabrica_salvar_segredo(text, text, text) from anon, authenticated';
    execute 'revoke all on function gestorgov.fabrica_ler_segredo(text) from anon, authenticated';
    execute 'revoke all on function gestorgov.fabrica_apagar_segredo(text) from anon, authenticated';
  end if;
end $$;
grant execute on function gestorgov.fabrica_salvar_segredo(text, text, text) to gestorgov_app;
grant execute on function gestorgov.fabrica_ler_segredo(text) to gestorgov_app;
grant execute on function gestorgov.fabrica_apagar_segredo(text) to gestorgov_app;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Tabelas
-- ─────────────────────────────────────────────────────────────────────────────

-- Atualiza "atualizado_em" sozinho a cada alteração.
create or replace function gestorgov.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;


-- 5.1 Segmentos e catálogos (os modelos que a implantação sugere) ─────────────────
--     Os nomes de tela e os campos obrigatórios de cada segmento ficam em agente/segmentos.py.

create table if not exists gestorgov.segmentos (
  id          text primary key,                 -- saude_publica, empresa
  nome        text not null,
  descricao   text,
  ordem       smallint not null default 0
);
comment on table gestorgov.segmentos is 'Segmentos atendidos. Cada organização é de um segmento e usa os modelos dele.';

insert into gestorgov.segmentos (id, nome, descricao, ordem) values
  ('saude_publica', 'Saúde pública', 'Secretarias municipais de saúde: setores, unidades de saúde (CNES) e o SUS.', 1),
  ('empresa',       'Empresa',       'Empresas: departamentos, filiais e lojas, com os agentes de cada área.',      2)
on conflict (id) do update set nome = excluded.nome, descricao = excluded.descricao, ordem = excluded.ordem;


create table if not exists gestorgov.tipos_area (
  id           text primary key,                -- ex.: farmacia; numa empresa, emp_financeiro
  segmento_id  text not null references gestorgov.segmentos(id) on delete cascade,
  nome         text not null,
  descricao    text,
  icone        text,                            -- nome do ícone (lucide) no painel
  ordem        smallint not null default 0,
  padrao       boolean not null default true    -- a implantação já sugere esta área
);
create index if not exists ix_tipos_area_segmento on gestorgov.tipos_area (segmento_id, ordem);
comment on table gestorgov.tipos_area is
  'Áreas (setores, departamentos) que uma organização do segmento costuma ter. A implantação sugere as "padrao".';


create table if not exists gestorgov.tipos_unidade (
  id            text primary key,               -- ex.: ubs; numa empresa, emp_loja
  segmento_id   text references gestorgov.segmentos(id) on delete cascade,  -- vazio = serve a todos
  nome          text not null,
  codigos_cnes  text[] not null default '{}',   -- saúde: "Tipo de estabelecimento" do CNES que cai neste tipo
  icone         text,
  cor           text,                           -- cor do pino no mapa
  ordem         smallint not null default 0
);
comment on table gestorgov.tipos_unidade is
  'Tipos de unidade (os pinos do mapa). Na saúde, codigos_cnes liga o tipo do CNES ao tipo do GestorGov na importação.';

insert into gestorgov.tipos_unidade (id, segmento_id, nome, codigos_cnes, icone, cor, ordem) values
  ('outro', null, 'Outra unidade', '{}', 'map-pin', '#424E6B', 99)
on conflict (id) do update
  set segmento_id = excluded.segmento_id, nome = excluded.nome, codigos_cnes = excluded.codigos_cnes,
      icone = excluded.icone, cor = excluded.cor, ordem = excluded.ordem;


create table if not exists gestorgov.modelos_atividade (
  id               text primary key,                         -- ex.: compras_termo_referencia
  tipo_area_id     text not null references gestorgov.tipos_area(id) on delete cascade,
  nome             text not null,
  descricao        text not null,                            -- o que o agente faz
  tipo             text not null check (tipo in ('rotina', 'sob_demanda')),
  frequencia       text not null default 'sob_demanda'
                   check (frequencia in ('a_cada_hora', 'diaria', 'semanal', 'mensal', 'sob_demanda')),
  cron             text,                                     -- horário padrão da rotina (horário de Brasília)
  entregavel       text,                                     -- o que volta para a pessoa aprovar
  padrao           boolean not null default true,            -- a implantação já sugere marcada
  ordem            smallint not null default 0
);
create index if not exists ix_modelos_atividade_area on gestorgov.modelos_atividade (tipo_area_id, ordem);
comment on table gestorgov.modelos_atividade is
  'Atividades que cada tipo de área costuma ter. rotina: o agente faz sozinho, num horário; sob_demanda: alguém pede.';


create table if not exists gestorgov.modelos_cargo (
  id               text primary key,                          -- ex.: sup_aps
  segmento_id      text not null references gestorgov.segmentos(id) on delete cascade,
  nome             text not null,
  nivel            text not null
                   check (nivel in ('direcao', 'superintendencia', 'coordenacao', 'unidade', 'controle')),
  tipo_area_id     text references gestorgov.tipos_area(id) on delete set null,     -- a sala do prédio
  superior_id      text references gestorgov.modelos_cargo(id) on delete set null,  -- a quem se reporta
  atribuicoes      text not null,
  rotinas          jsonb not null default '[]'::jsonb,       -- [{frequencia, texto}]
  entregas         jsonb not null default '[]'::jsonb,       -- [{frequencia, texto}]
  padrao           boolean not null default true,
  ordem            smallint not null default 0
);
create index if not exists ix_modelos_cargo_segmento on gestorgov.modelos_cargo (segmento_id, ordem);


create table if not exists gestorgov.modelos_indicador (
  id               text primary key,                          -- ex.: sup_aps__absenteismo_nas_consultas
  modelo_cargo_id  text not null references gestorgov.modelos_cargo(id) on delete cascade,
  nome             text not null,
  fonte            text not null,                             -- saúde: e-SUS APS, SIM, SINAN...; empresa: ERP, CRM...
  periodicidade    text not null
                   check (periodicidade in ('diaria', 'semanal', 'mensal', 'trimestral', 'quadrimestral', 'anual')),
  unidade          text not null,                             -- %, dias, número, R$...
  sentido          text not null check (sentido in ('maior', 'menor')),  -- maior = subir é bom
  ordem            smallint not null default 0
);
create index if not exists ix_modelos_indicador_cargo on gestorgov.modelos_indicador (modelo_cargo_id, ordem);


-- 5.2 Organização (o cliente) ────────────────────────────────────────────────────
--     Saúde pública: a Secretaria Municipal de Saúde (nome, CNPJ, endereço, secretário como responsável); a cidade
--     dá o mapa (codigo_ibge, centro e zoom) e a prefeitura, o Fundo e o prefeito ficam em dados_segmento.
--     Empresa: a empresa (razão social, CNPJ, sede, diretor como responsável).

create table if not exists gestorgov.organizacoes (
  id                    uuid primary key default extensions.gen_random_uuid(),
  segmento_id           text not null references gestorgov.segmentos(id),
  nome                  text not null,                          -- nome oficial (ou razão social)
  sigla                 text,                                   -- sigla ou nome fantasia
  cnpj                  char(14),
  cep                   char(8),
  logradouro            text,
  numero                text,
  complemento           text,
  bairro                text,
  cidade                text,
  uf                    char(2),
  codigo_ibge           char(7),                                -- município (7 dígitos; ex.: 3550308 = São Paulo)
  latitude              numeric(9,6),                           -- centro do mapa
  longitude             numeric(9,6),
  zoom_mapa             smallint default 12,
  sede_latitude         numeric(9,6),                           -- o prédio da sede
  sede_longitude        numeric(9,6),
  telefone              text,
  email                 text,
  site                  text,
  responsavel_nome      text,                                   -- secretário(a), diretor(a)...
  responsavel_email     text,
  responsavel_telefone  text,
  responsavel_cargo     text,
  populacao             integer,
  andares               smallint not null default 3,            -- andares do prédio na visão 3D
  dados_segmento        jsonb not null default '{}'::jsonb,     -- os campos próprios do segmento (agente/segmentos.py)
  situacao              text not null default 'implantacao'
                        check (situacao in ('implantacao', 'ativo', 'suspenso', 'encerrado')),
  plano                 text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  criado_por            text
);
-- Uma Secretaria de Saúde por município.
create unique index if not exists ux_organizacoes_saude_ibge on gestorgov.organizacoes (codigo_ibge)
  where segmento_id = 'saude_publica';
create index if not exists ix_organizacoes_cnpj on gestorgov.organizacoes (cnpj);
comment on table gestorgov.organizacoes is 'Cada cliente do GestorGov (uma Secretaria de Saúde, uma empresa...).';

drop trigger if exists tg_organizacoes_atualizado on gestorgov.organizacoes;
create trigger tg_organizacoes_atualizado before update on gestorgov.organizacoes
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.3 Pessoas (servidores, funcionários) ──────────────────────────────────────────
--     O login fica em painel_contas/membros; aqui fica quem a pessoa é na organização. A ligação é pelo e-mail.

create table if not exists gestorgov.pessoas (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  email            text not null,
  nome             text not null,
  cargo            text,
  matricula        text,
  area_id          uuid,                                      -- FK abaixo (areas)
  unidade_id       uuid,                                      -- FK abaixo (unidades)
  papel            text not null default 'membro'
                   check (papel in ('direcao', 'coordenador', 'responsavel_unidade', 'membro', 'consulta')),
  aprova_tarefas   boolean not null default false,            -- pode aprovar o que os agentes propõem
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (organizacao_id, email)
);
comment on table gestorgov.pessoas is
  'Pessoas da organização: cargo, área ou unidade e se aprovam as tarefas dos agentes na sua área.';

drop trigger if exists tg_pessoas_atualizado on gestorgov.pessoas;
create trigger tg_pessoas_atualizado before update on gestorgov.pessoas
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.4 Áreas (setores, departamentos: as salas do prédio) ───────────────────────

create table if not exists gestorgov.areas (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  tipo_id          text references gestorgov.tipos_area(id),
  nome             text not null,
  descricao        text,
  andar            smallint not null default 0,               -- posição no prédio 3D
  posicao          smallint not null default 0,               -- sala no andar
  responsavel_id   uuid references gestorgov.pessoas(id) on delete set null,  -- quem aprova
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (organizacao_id, nome)
);
comment on table gestorgov.areas is 'Áreas da organização. Cada uma vira uma sala no prédio 3D e recebe o seu agente.';

drop trigger if exists tg_areas_atualizado on gestorgov.areas;
create trigger tg_areas_atualizado before update on gestorgov.areas
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.5 Unidades (os pinos do mapa: UBS, UPA... ou filiais, lojas, depósitos) ─────

create table if not exists gestorgov.unidades (
  id                  uuid primary key default extensions.gen_random_uuid(),
  organizacao_id      uuid not null references gestorgov.organizacoes(id) on delete cascade,
  tipo_id             text not null default 'outro' references gestorgov.tipos_unidade(id),
  cnes                char(7),                                -- saúde: código CNES (7 dígitos)
  nome                text not null,
  nome_fantasia       text,
  endereco            text,                                   -- a rua
  numero              text,
  complemento         text,
  bairro              text,
  cep                 char(8),
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  coordenadas_origem  text check (coordenadas_origem is null or coordenadas_origem in ('cnes', 'endereco', 'cep', 'mapa', 'manual')),
  telefone            text,
  email               text,
  horario             jsonb,                                  -- ex.: {"seg-sex": "07:00-17:00"}
  gestao              text check (gestao in ('municipal', 'estadual', 'dupla', 'privada_conveniada')),
  responsavel_id      uuid references gestorgov.pessoas(id) on delete set null,
  agente_id           text,                                   -- o agente de IA da unidade (Fábrica)
  situacao            text not null default 'ativa' check (situacao in ('ativa', 'inativa', 'em_obra')),
  origem              text not null default 'manual' check (origem in ('cnes', 'manual', 'planilha')),
  dados_cnes          jsonb,                                  -- o registro do CNES como veio, para conferir
  confirmada          boolean not null default false,
  conferida_por       text,                                   -- quem conferiu os dados (unidade importada chega "a conferir")
  conferida_em        timestamptz,
  criado_por          text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create unique index if not exists ux_unidades_cnes on gestorgov.unidades (organizacao_id, cnes) where cnes is not null;
create index if not exists ix_unidades_organizacao_tipo on gestorgov.unidades (organizacao_id, tipo_id);
comment on table gestorgov.unidades is 'Unidades da organização: os pinos do mapa, cada uma com o seu prédio em 3D.';

drop trigger if exists tg_unidades_atualizado on gestorgov.unidades;
create trigger tg_unidades_atualizado before update on gestorgov.unidades
  for each row execute function gestorgov.tocar_atualizado_em();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_pessoas_area') then
    alter table gestorgov.pessoas add constraint fk_pessoas_area foreign key (area_id)
      references gestorgov.areas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_pessoas_unidade') then
    alter table gestorgov.pessoas add constraint fk_pessoas_unidade foreign key (unidade_id)
      references gestorgov.unidades(id) on delete set null;
  end if;
end $$;
create index if not exists ix_pessoas_area on gestorgov.pessoas (area_id);


create table if not exists gestorgov.unidade_fotos (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  unidade_id       uuid not null references gestorgov.unidades(id) on delete cascade,
  tipo             text not null default 'fachada' check (tipo in ('fachada', 'interior', 'outra')),
  caminho          text not null,                             -- no bucket organizacoes
  mime             text not null,
  bytes            integer not null,
  largura          integer,
  altura           integer,
  legenda          text,
  principal        boolean not null default false,            -- a que aparece na ficha
  enviada_por      text not null,
  enviada_em       timestamptz not null default now()
);
create index if not exists ix_unidade_fotos_unidade on gestorgov.unidade_fotos (unidade_id);
create unique index if not exists ux_unidade_fotos_principal on gestorgov.unidade_fotos (unidade_id) where principal;


-- 5.6 Agentes de cada área (as mesas dos robôs no prédio) ─────────────────────────
--     agente_id é o id do agente na Fábrica (fabrica_agentes, criada pelo servidor).

create table if not exists gestorgov.agentes_area (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  area_id          uuid not null references gestorgov.areas(id) on delete cascade,
  agente_id        text not null,
  funcao           text,                                      -- ex.: "Controle de estoque de medicamentos"
  mesa             smallint not null default 0,               -- posição na sala, na visão 3D
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (area_id, agente_id)
);
create index if not exists ix_agentes_area_organizacao on gestorgov.agentes_area (organizacao_id);

drop trigger if exists tg_agentes_area_atualizado on gestorgov.agentes_area;
create trigger tg_agentes_area_atualizado before update on gestorgov.agentes_area
  for each row execute function gestorgov.tocar_atualizado_em();


-- A ficha de cada agente (montada na implantação; editável por quem tem "criar agentes").
create table if not exists gestorgov.fichas_agente (
  agente_id        text primary key,
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  caracteristicas  jsonb not null default '{}'::jsonb,   -- cor, tom, autonomia
  memoria          jsonb not null default '{}'::jsonb,   -- area: bool, organizacao: bool
  permissoes       jsonb not null default '{}'::jsonb,   -- { "unidades": ["ler"], ... }
  escopo           text not null default 'area' check (escopo in ('area', 'organizacao')),
  integracoes      jsonb not null default '[]'::jsonb,   -- ids da Central de integrações
  atualizado_em    timestamptz not null default now(),
  atualizado_por   text
);
create index if not exists ix_fichas_agente_organizacao on gestorgov.fichas_agente (organizacao_id);


-- 5.7 Atividades de cada área ──────────────────────────────────────────────────────

create table if not exists gestorgov.atividades_area (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  area_id          uuid not null references gestorgov.areas(id) on delete cascade,
  modelo_id        text references gestorgov.modelos_atividade(id) on delete set null,  -- vazio = criada pela organização
  nome             text not null,
  descricao        text not null,
  tipo             text not null check (tipo in ('rotina', 'sob_demanda')),
  frequencia       text not null default 'sob_demanda'
                   check (frequencia in ('a_cada_hora', 'diaria', 'semanal', 'mensal', 'sob_demanda')),
  cron             text,
  entregavel       text,
  agente_id        text,                                      -- agente da Fábrica que executa
  aprovador_id     uuid references gestorgov.pessoas(id) on delete set null,
  cargo_id         uuid,                                      -- FK abaixo (cargos)
  rotina_id        text,                                      -- o agendamento da rotina, quando houver
  ativa            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (area_id, nome)
);
create index if not exists ix_atividades_organizacao on gestorgov.atividades_area (organizacao_id);
create index if not exists ix_atividades_agente on gestorgov.atividades_area (agente_id);

drop trigger if exists tg_atividades_area_atualizado on gestorgov.atividades_area;
create trigger tg_atividades_area_atualizado before update on gestorgov.atividades_area
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.8 Organograma: cargos, indicadores com meta, medições, status e alertas (as tarefas e entregas ficam no CompanyOS) ─────

create table if not exists gestorgov.cargos (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  modelo_id        text references gestorgov.modelos_cargo(id) on delete set null,  -- vazio = criado pela organização
  nome             text not null,
  nivel            text not null
                   check (nivel in ('direcao', 'superintendencia', 'coordenacao', 'unidade', 'controle')),
  superior_id      uuid references gestorgov.cargos(id) on delete set null,
  area_id          uuid references gestorgov.areas(id) on delete set null,
  unidade_id       uuid references gestorgov.unidades(id) on delete set null,      -- gerência de unidade
  responsavel_id   uuid references gestorgov.pessoas(id) on delete set null,       -- quem ocupa o cargo
  agente_id        text,                                                          -- o agente da Fábrica do cargo
  atribuicoes      text,
  permissoes       jsonb not null default '[]'::jsonb,        -- o que quem ocupa o cargo pode fazer no sistema
  ativo            boolean not null default true,
  ordem            smallint not null default 0,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists ix_cargos_organizacao on gestorgov.cargos (organizacao_id);
create index if not exists ix_cargos_superior on gestorgov.cargos (superior_id);

drop trigger if exists tg_cargos_atualizado on gestorgov.cargos;
create trigger tg_cargos_atualizado before update on gestorgov.cargos
  for each row execute function gestorgov.tocar_atualizado_em();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_atividades_cargo') then
    alter table gestorgov.atividades_area add constraint fk_atividades_cargo foreign key (cargo_id)
      references gestorgov.cargos(id) on delete set null;
  end if;
end $$;


create table if not exists gestorgov.indicadores_cargo (
  id                 uuid primary key default extensions.gen_random_uuid(),
  organizacao_id     uuid not null references gestorgov.organizacoes(id) on delete cascade,
  cargo_id           uuid not null references gestorgov.cargos(id) on delete cascade,
  modelo_id          text references gestorgov.modelos_indicador(id) on delete set null,
  nome               text not null,
  fonte              text not null,
  periodicidade      text not null,
  unidade            text not null,
  sentido            text not null check (sentido in ('maior', 'menor')),
  meta               numeric,                                 -- definida pela organização
  meta_definida_por  text,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now(),
  unique (cargo_id, nome)
);
create index if not exists ix_indicadores_cargo_organizacao on gestorgov.indicadores_cargo (organizacao_id);


create table if not exists gestorgov.medicoes (
  id               bigint generated always as identity primary key,
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  indicador_id     uuid not null references gestorgov.indicadores_cargo(id) on delete cascade,
  referencia       date not null,                             -- o dia, semana ou mês medido
  valor            numeric not null,
  fonte            text,                                      -- de onde veio (planilha, sistema, agente)
  registrado_por   text not null,                             -- e-mail ou id do agente
  registrado_em    timestamptz not null default now(),
  unique (indicador_id, referencia)
);
create index if not exists ix_medicoes_indicador on gestorgov.medicoes (indicador_id, referencia desc);


create table if not exists gestorgov.status_cargo (
  cargo_id         uuid primary key references gestorgov.cargos(id) on delete cascade,
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  situacao         text not null default 'aguardando'
                   check (situacao in ('em_andamento', 'aguardando', 'bloqueado', 'concluido')),
  tarefa           text,                                      -- o que está fazendo, em uma linha
  atualizado_em    timestamptz not null default now(),
  atualizado_por   text
);


create table if not exists gestorgov.alertas_cargo (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  cargo_id         uuid not null references gestorgov.cargos(id) on delete cascade,      -- de onde vem
  destino_id       uuid references gestorgov.cargos(id) on delete set null,              -- o superior que recebe
  tipo             text not null
                   check (tipo in ('meta_fora', 'entrega_vencendo', 'pendencia_parada', 'sem_atualizacao', 'evento_critico')),
  titulo           text not null,
  detalhe          text,
  situacao         text not null default 'aberto' check (situacao in ('aberto', 'visto', 'resolvido', 'escalado')),
  escalado_de      uuid references gestorgov.alertas_cargo(id) on delete set null,
  criado_em        timestamptz not null default now(),
  resolvido_em     timestamptz,
  resolvido_por    text
);
create index if not exists ix_alertas_destino on gestorgov.alertas_cargo (destino_id, situacao);


-- 5.9 Membros, convites e o link da implantação ─────────────────────────────────────
--     Quem cadastra a organização é o dono dela; os demais entram por convite (7 dias) e podem o que o cargo pode.

create table if not exists gestorgov.membros (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  email            text not null,
  nome             text,
  papel            text not null default 'membro' check (papel in ('dono', 'membro')),
  cargo_id         uuid references gestorgov.cargos(id) on delete set null,
  ativo            boolean not null default true,             -- false = bloqueado pelo dono
  criado_em        timestamptz not null default now(),
  criado_por       text,
  unique (organizacao_id, email)
);
create index if not exists ix_membros_email on gestorgov.membros (email);


create table if not exists gestorgov.convites (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  email            text not null,
  nome             text,
  cargo_id         uuid references gestorgov.cargos(id) on delete set null,
  token_hash       text not null unique,
  origem           text not null default 'painel' check (origem in ('painel', 'assistente')),
  aprovado_em      timestamptz,                               -- os do assistente valem depois da aprovação do dono
  aprovado_por     text,
  criado_por       text not null,
  criado_em        timestamptz not null default now(),
  expira_em        timestamptz not null,
  aceito_em        timestamptz,
  cancelado_em     timestamptz
);
create index if not exists ix_convites_organizacao on gestorgov.convites (organizacao_id);


create table if not exists gestorgov.implantacao_links (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  token_hash       text not null unique,
  codigo_hash      text not null,
  criado_por       text not null,
  criado_em        timestamptz not null default now(),
  expira_em        timestamptz not null,
  cancelado_em     timestamptz,
  usos             integer not null default 0,
  falhas           integer not null default 0                 -- códigos errados seguidos: com 5, o link se cancela
);
create index if not exists ix_implantacao_links_organizacao on gestorgov.implantacao_links (organizacao_id);


-- 5.10 Implantação conversacional ─────────────────────────────────────────────────
--      Uma linha por implantação; "estado" guarda o que o assistente já sabe. As fases ficam em agente/gestao.py.

create table if not exists gestorgov.onboardings (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid references gestorgov.organizacoes(id) on delete cascade,
  session_id       text,
  etapa            text not null default 'organizacao'
                   check (etapa in ('organizacao', 'areas', 'atividades', 'cargos', 'responsaveis', 'agentes',
                                    'equipe', 'unidades', 'revisao', 'concluido')),
  estado           jsonb not null default '{}'::jsonb,
  iniciado_por     text not null,                             -- e-mail de quem conduz
  iniciado_em      timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  concluido_em     timestamptz
);
create index if not exists ix_onboardings_organizacao on gestorgov.onboardings (organizacao_id);

drop trigger if exists tg_onboardings_atualizado on gestorgov.onboardings;
create trigger tg_onboardings_atualizado before update on gestorgov.onboardings
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.11 Auditoria (quem fez o quê) ──────────────────────────────────────────────────
--      Toda ação que muda dado: de pessoa ou de agente. Só se acrescenta; nunca se altera ou apaga.

create table if not exists gestorgov.auditoria (
  id               bigint generated always as identity primary key,
  organizacao_id   uuid references gestorgov.organizacoes(id) on delete set null,
  em               timestamptz not null default now(),
  origem           text not null check (origem in ('pessoa', 'agente', 'rotina', 'sistema')),
  quem             text not null,                             -- e-mail, ou o id do agente/rotina
  acao             text not null,                             -- ex.: criar, alterar, aprovar_tarefa
  entidade         text not null,                             -- ex.: unidades, areas, tarefa
  entidade_id      text,
  antes            jsonb,
  depois           jsonb,
  session_id       text,                                      -- conversa do Agno, quando houver
  aprovado_por     text                                       -- quem aprovou, quando a ação foi de agente
);
create index if not exists ix_auditoria_organizacao_em on gestorgov.auditoria (organizacao_id, em desc);
create index if not exists ix_auditoria_entidade on gestorgov.auditoria (entidade, entidade_id);
comment on table gestorgov.auditoria is
  'Trilha de auditoria: toda alteração de pessoa ou de agente, com antes/depois e quem aprovou. Só inserção.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Permissões e segurança das tabelas
--    RLS ligado em todas, com uma política só para o servidor (gestorgov_app). Mesmo que alguém exponha o
--    schema na API por engano, anon e authenticated não leem nada.
-- ─────────────────────────────────────────────────────────────────────────────
grant select on gestorgov.segmentos, gestorgov.tipos_area, gestorgov.tipos_unidade, gestorgov.modelos_atividade,
  gestorgov.modelos_cargo, gestorgov.modelos_indicador to gestorgov_app;
grant select, insert, update, delete on
  gestorgov.organizacoes, gestorgov.pessoas, gestorgov.areas, gestorgov.unidades, gestorgov.unidade_fotos,
  gestorgov.agentes_area, gestorgov.fichas_agente, gestorgov.atividades_area, gestorgov.cargos,
  gestorgov.indicadores_cargo, gestorgov.medicoes, gestorgov.status_cargo,
  gestorgov.alertas_cargo, gestorgov.membros, gestorgov.convites, gestorgov.implantacao_links, gestorgov.onboardings
  to gestorgov_app;
grant select, insert on gestorgov.auditoria to gestorgov_app;   -- auditoria: sem update nem delete
revoke update, delete, truncate on gestorgov.auditoria from gestorgov_app;  -- tira o que a regra padrão deu
-- Catálogos: só o SQL Editor altera.
revoke insert, update, delete, truncate on gestorgov.segmentos, gestorgov.tipos_area, gestorgov.tipos_unidade,
  gestorgov.modelos_atividade, gestorgov.modelos_cargo, gestorgov.modelos_indicador from gestorgov_app;
grant usage, select on all sequences in schema gestorgov to gestorgov_app;

do $$
declare
  t text;
begin
  foreach t in array array['segmentos', 'tipos_area', 'tipos_unidade', 'modelos_atividade', 'modelos_cargo',
                           'modelos_indicador', 'organizacoes', 'pessoas', 'areas', 'unidades', 'unidade_fotos',
                           'agentes_area', 'fichas_agente', 'atividades_area', 'cargos', 'indicadores_cargo',
                           'medicoes', 'status_cargo', 'alertas_cargo', 'membros',
                           'convites', 'implantacao_links', 'onboardings', 'auditoria']
  loop
    execute format('alter table gestorgov.%I enable row level security', t);
    execute format('drop policy if exists servidor_gestorgov on gestorgov.%I', t);
    execute format('create policy servidor_gestorgov on gestorgov.%I for all to gestorgov_app using (true) with check (true)', t);
  end loop;
end $$;


-- =============================================================================
-- DEPOIS de rodar, faça à mão (uma vez), no SQL Editor:
--
--   alter role gestorgov_app with login password '<uma senha forte>';
--
-- Conexão do servidor no Render (DATABASE_URL). Use o POOLER em modo sessão (porta 5432):
-- o Render não alcança a conexão direta do Supabase, que é só IPv6.
--   postgresql://gestorgov_app.<id-do-projeto>:<senha>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
-- (copie host e porta em Connect → Session pooler; troque só o usuário e a senha)
--
-- E no Render, também:
--   DATABASE_SCHEMA=gestorgov
--   SUPABASE_BUCKET_AGENTES=agentes
--   SUPABASE_BUCKET_ORGANIZACOES=organizacoes
-- =============================================================================
