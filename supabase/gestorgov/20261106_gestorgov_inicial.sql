-- =============================================================================
-- GestorGov — banco inicial (projeto Supabase novo do GestorGov)
-- Rode inteiro, de uma vez, no SQL Editor. Pode rodar de novo: nada é duplicado.
--
-- O que este script faz:
--   1. Schema `gestorgov` e o papel do servidor `gestorgov_app` (sem login até você ligar, no fim).
--   2. Extensões: pgvector (busca por semelhança nos documentos) e pgcrypto (ids).
--   3. Bucket PRIVADO `agentes` no Storage (documentos da base de conhecimento).
--   4. Cofre das chaves de API da Fábrica, no Vault do Supabase.
--   5. Tabelas do GestorGov: municípios, secretarias, setores, unidades de saúde, servidores,
--      agentes por setor, onboarding e auditoria. E as listas de tipos (setor e unidade).
--
-- O que ele NÃO cria (o servidor cria ao iniciar, dentro de `gestorgov`):
--   - as tabelas do Agno: sessões, memórias, avaliações, traces, agendamentos e as do CompanyOS
--     (produtos, projetos, tarefas, rotinas);
--   - as do painel: fabrica_*, conhecimento_*, avaliacoes_humanas, painel_usuarios, equipes etc.
--   Assim o banco nunca fica diferente do que o código espera.
--
-- Mudanças em relação ao NexaAgents (Contabilidade Facilitada):
--   - schema `gestorgov` no lugar de `agente_sdr`; papel `gestorgov_app` no lugar de `agente_sdr_app`;
--   - sem Data Gateway, compras, área do aluno, Unnichat nem as views de métricas do WhatsApp
--     (agente_metricas): as métricas do GestorGov serão refeitas sobre as tarefas e rotinas.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema e papel do servidor
-- ─────────────────────────────────────────────────────────────────────────────
create schema if not exists gestorgov;
comment on schema gestorgov is
  'GestorGov — Gestão Pública Inteligente: agentes, conversas, tarefas e o cadastro de cada município.';

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
-- 3. Storage: bucket privado dos documentos
--    Caminho dos arquivos: conhecimento/<agente>/<documento>/v<versão>/<arquivo>.
--    Sem políticas para anon/authenticated: só o servidor (service role) lê e grava.
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cofre das chaves de API da Fábrica (Vault)
--    O servidor não acessa o Vault direto: estas funções só alcançam segredos com o
--    prefixo "fabrica:". O painel nunca recebe o valor de volta.
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
-- 5. Tabelas do GestorGov
--    Tudo é separado por município (municipio_id): o mesmo sistema atende várias prefeituras.
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


-- 5.1 Listas de tipos ──────────────────────────────────────────────────────────

create table if not exists gestorgov.tipos_setor (
  id          text primary key,                 -- ex.: farmacia
  nome        text not null,
  descricao   text,
  icone       text,                             -- nome do ícone (lucide) no painel
  ordem       smallint not null default 0,
  padrao      boolean not null default true     -- o onboarding já sugere este setor
);
comment on table gestorgov.tipos_setor is
  'Setores que uma Secretaria de Saúde costuma ter. O onboarding sugere os "padrao"; o secretário confirma ou acrescenta.';

insert into gestorgov.tipos_setor (id, nome, descricao, icone, ordem, padrao) values
  ('gabinete',          'Gabinete do Secretário',        'Direção, agenda e decisões da Secretaria.',                     'landmark',        1, true),
  ('atencao_primaria',  'Atenção Primária',              'UBS, equipes de Saúde da Família e indicadores da APS.',        'house-plus',      2, true),
  ('atencao_especializada','Atenção Especializada',      'Policlínicas, especialidades e exames.',                         'stethoscope',     3, true),
  ('urgencia',          'Urgência e Emergência',         'UPA, pronto atendimento e SAMU.',                                'siren',           4, true),
  ('regulacao',         'Regulação',                     'Filas de consultas, exames e cirurgias.',                        'list-ordered',    5, true),
  ('farmacia',          'Assistência Farmacêutica',      'Estoque, dispensação e compras de medicamentos.',               'pill',            6, true),
  ('vigilancia',        'Vigilância em Saúde',           'Epidemiológica, sanitária, ambiental e imunização.',             'shield-alert',    7, true),
  ('saude_mental',      'Saúde Mental',                  'CAPS e rede de atenção psicossocial.',                           'brain',           8, false),
  ('compras',           'Compras e Licitações',          'Processos de compra, atas e contratos.',                         'file-signature',  9, true),
  ('financeiro',        'Financeiro e Orçamento',        'Fundo Municipal de Saúde, empenhos e prestação de contas.',     'wallet',         10, true),
  ('rh',                'Gestão de Pessoas',             'Servidores, escalas e plantões.',                                'users',          11, true),
  ('faturamento',       'Faturamento e Informação',      'Produção SUS, sistemas oficiais e prazos de envio.',            'bar-chart-3',    12, true),
  ('transporte',        'Transporte Sanitário',          'Veículos, agendamento de viagens e TFD.',                        'ambulance',      13, false),
  ('ouvidoria',         'Ouvidoria',                     'Reclamações, sugestões e respostas ao cidadão.',                 'megaphone',      14, true),
  ('almoxarifado',      'Almoxarifado e Patrimônio',     'Materiais, insumos e bens.',                                     'package',        15, false),
  ('ti',                'Tecnologia da Informação',      'Sistemas, computadores e rede das unidades.',                    'monitor',        16, false)
on conflict (id) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, ordem = excluded.ordem;


create table if not exists gestorgov.tipos_unidade (
  id            text primary key,               -- ex.: ubs
  nome          text not null,
  codigos_cnes  text[] not null default '{}',   -- "Tipo de estabelecimento" do CNES que caem neste tipo
  icone         text,
  cor           text,                           -- cor do pino no mapa
  ordem         smallint not null default 0
);
comment on table gestorgov.tipos_unidade is
  'Tipos de unidade de saúde do mapa. codigos_cnes liga o tipo do CNES ao tipo do GestorGov na importação. '
  'Confira os códigos com a tabela oficial do CNES antes da primeira importação.';

insert into gestorgov.tipos_unidade (id, nome, codigos_cnes, icone, cor, ordem) values
  ('ubs',           'UBS / Unidade de Saúde da Família', '{01,02}',  'house-plus',   '#1A63D8',  1),
  ('upa',           'UPA / Pronto Atendimento',          '{73}',     'siren',        '#F4B800',  2),
  ('pronto_socorro','Pronto-Socorro',                    '{20,21}',  'siren',        '#F4B800',  3),
  ('hospital',      'Hospital',                          '{05,07,15}','hospital',    '#0D1B38',  4),
  ('policlinica',   'Policlínica / Centro de Especialidades', '{04,36}', 'stethoscope', '#52A2FF', 5),
  ('caps',          'CAPS',                              '{70}',     'brain',        '#52A2FF',  6),
  ('farmacia',      'Farmácia',                          '{43}',     'pill',         '#1A63D8',  7),
  ('laboratorio',   'Laboratório / Apoio Diagnóstico',   '{39}',     'flask-conical','#52A2FF',  8),
  ('samu',          'SAMU / Base Móvel de Urgência',     '{42}',     'ambulance',    '#F4B800',  9),
  ('vigilancia',    'Vigilância em Saúde',               '{50}',     'shield-alert', '#424E6B', 10),
  ('imunizacao',    'Centro de Imunização',              '{85}',     'syringe',      '#1A63D8', 11),
  ('academia',      'Academia da Saúde',                 '{74}',     'heart-pulse',  '#52A2FF', 12),
  ('gestao',        'Central de Gestão / Sede',          '{68}',     'landmark',     '#0D1B38', 13),
  ('regulacao',     'Central de Regulação',              '{76,81}',  'list-ordered', '#424E6B', 14),
  ('outro',         'Outra unidade',                     '{}',       'map-pin',      '#424E6B', 99)
on conflict (id) do update
  set nome = excluded.nome, codigos_cnes = excluded.codigos_cnes, icone = excluded.icone,
      cor = excluded.cor, ordem = excluded.ordem;


-- 5.2 Município (a prefeitura cliente) ──────────────────────────────────────────

create table if not exists gestorgov.municipios (
  id              uuid primary key default extensions.gen_random_uuid(),
  codigo_ibge     char(7) not null unique,                 -- 7 dígitos (ex.: 3550308 = São Paulo)
  nome            text not null,
  uf              char(2) not null,
  cep             char(8),
  endereco_sede   text,                                    -- endereço da prefeitura
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  zoom_mapa       smallint default 12,                     -- zoom inicial da visão "Cidade"
  populacao       integer,
  situacao        text not null default 'onboarding'
                  check (situacao in ('onboarding', 'ativo', 'suspenso', 'encerrado')),
  plano           text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  criado_por      text
);
comment on table gestorgov.municipios is 'Cada prefeitura cliente do GestorGov.';

drop trigger if exists tg_municipios_atualizado on gestorgov.municipios;
create trigger tg_municipios_atualizado before update on gestorgov.municipios
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.3 Secretaria ───────────────────────────────────────────────────────────────

create table if not exists gestorgov.secretarias (
  id                uuid primary key default extensions.gen_random_uuid(),
  municipio_id      uuid not null references gestorgov.municipios(id) on delete cascade,
  area              text not null default 'saude'
                    check (area in ('saude', 'educacao', 'assistencia_social', 'administracao', 'outra')),
  nome              text not null default 'Secretaria Municipal de Saúde',
  sigla             text,
  cnpj              char(14),                              -- do Fundo Municipal, se houver
  endereco          text,
  cep               char(8),
  latitude          numeric(9,6),
  longitude         numeric(9,6),
  andares           smallint not null default 3,           -- andares do prédio na visão 3D
  secretario_nome   text,
  secretario_email  text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (municipio_id, area)
);
comment on table gestorgov.secretarias is
  'Secretaria do município. Começa pela Saúde; o campo area deixa espaço para as outras.';

drop trigger if exists tg_secretarias_atualizado on gestorgov.secretarias;
create trigger tg_secretarias_atualizado before update on gestorgov.secretarias
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.4 Setores da secretaria (os andares e salas do prédio) ─────────────────────

create table if not exists gestorgov.setores (
  id              uuid primary key default extensions.gen_random_uuid(),
  municipio_id    uuid not null references gestorgov.municipios(id) on delete cascade,
  secretaria_id   uuid not null references gestorgov.secretarias(id) on delete cascade,
  tipo_id         text references gestorgov.tipos_setor(id),
  nome            text not null,
  descricao       text,
  andar           smallint not null default 0,              -- posição no prédio 3D
  posicao         smallint not null default 0,              -- sala no andar
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (secretaria_id, nome)
);
create index if not exists ix_setores_municipio on gestorgov.setores (municipio_id);
comment on table gestorgov.setores is 'Setores da secretaria. Cada um vira um andar ou sala na visão 3D e recebe seus agentes.';

drop trigger if exists tg_setores_atualizado on gestorgov.setores;
create trigger tg_setores_atualizado before update on gestorgov.setores
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.5 Unidades de saúde (os pinos do mapa) ────────────────────────────────────

create table if not exists gestorgov.unidades (
  id              uuid primary key default extensions.gen_random_uuid(),
  municipio_id    uuid not null references gestorgov.municipios(id) on delete cascade,
  secretaria_id   uuid references gestorgov.secretarias(id) on delete set null,
  tipo_id         text not null default 'outro' references gestorgov.tipos_unidade(id),
  cnes            char(7),                                  -- código CNES (7 dígitos)
  nome            text not null,
  nome_fantasia   text,
  endereco        text,
  bairro          text,
  cep             char(8),
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  telefone        text,
  horario         jsonb,                                    -- ex.: {"seg-sex": "07:00-17:00"}
  gestao          text check (gestao in ('municipal', 'estadual', 'dupla', 'privada_conveniada')),
  responsavel_id  uuid,                                     -- servidor responsável (FK abaixo)
  situacao        text not null default 'ativa' check (situacao in ('ativa', 'inativa', 'em_obra')),
  origem          text not null default 'manual' check (origem in ('cnes', 'manual', 'planilha')),
  dados_cnes      jsonb,                                    -- o registro do CNES como veio, para conferir
  confirmada      boolean not null default false,           -- o secretário conferiu no onboarding
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create unique index if not exists ux_unidades_cnes on gestorgov.unidades (municipio_id, cnes) where cnes is not null;
create index if not exists ix_unidades_municipio_tipo on gestorgov.unidades (municipio_id, tipo_id);
comment on table gestorgov.unidades is
  'Unidades de saúde do município: os pinos da visão "Cidade". Importadas do CNES no onboarding e confirmadas pelo secretário.';

drop trigger if exists tg_unidades_atualizado on gestorgov.unidades;
create trigger tg_unidades_atualizado before update on gestorgov.unidades
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.6 Servidores (as pessoas da secretaria) ───────────────────────────────────
--     O login e as permissões do painel continuam em painel_usuarios (criada pelo servidor);
--     aqui fica quem a pessoa é na prefeitura. A ligação é pelo e-mail.

create table if not exists gestorgov.servidores (
  id              uuid primary key default extensions.gen_random_uuid(),
  municipio_id    uuid not null references gestorgov.municipios(id) on delete cascade,
  email           text not null,
  nome            text not null,
  cargo           text,
  matricula       text,
  setor_id        uuid references gestorgov.setores(id) on delete set null,
  unidade_id      uuid references gestorgov.unidades(id) on delete set null,
  papel           text not null default 'servidor'
                  check (papel in ('secretario', 'coordenador', 'responsavel_unidade', 'servidor', 'consulta')),
  aprova_tarefas  boolean not null default false,           -- pode aprovar o que os agentes propõem
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (municipio_id, email)
);
create index if not exists ix_servidores_setor on gestorgov.servidores (setor_id);
comment on table gestorgov.servidores is
  'Pessoas da secretaria: cargo, setor ou unidade e se aprovam as tarefas dos agentes no seu setor.';

drop trigger if exists tg_servidores_atualizado on gestorgov.servidores;
create trigger tg_servidores_atualizado before update on gestorgov.servidores
  for each row execute function gestorgov.tocar_atualizado_em();

-- Responsável do setor e da unidade (criados depois de servidores existir).
alter table gestorgov.setores add column if not exists responsavel_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_setores_responsavel') then
    alter table gestorgov.setores
      add constraint fk_setores_responsavel foreign key (responsavel_id)
      references gestorgov.servidores(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_unidades_responsavel') then
    alter table gestorgov.unidades
      add constraint fk_unidades_responsavel foreign key (responsavel_id)
      references gestorgov.servidores(id) on delete set null;
  end if;
end $$;


-- 5.7 Agentes de cada setor (as mesas dos robôs no prédio) ─────────────────────
--     agente_id é o id do agente na Fábrica (fabrica_agentes, criada pelo servidor).

create table if not exists gestorgov.agentes_setor (
  id              uuid primary key default extensions.gen_random_uuid(),
  municipio_id    uuid not null references gestorgov.municipios(id) on delete cascade,
  setor_id        uuid not null references gestorgov.setores(id) on delete cascade,
  agente_id       text not null,
  funcao          text,                                     -- ex.: "Controle de estoque de medicamentos"
  mesa            smallint not null default 0,              -- posição na sala, na visão 3D
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (setor_id, agente_id)
);
create index if not exists ix_agentes_setor_municipio on gestorgov.agentes_setor (municipio_id);
comment on table gestorgov.agentes_setor is 'Que agente da Fábrica trabalha em que setor de qual município.';

drop trigger if exists tg_agentes_setor_atualizado on gestorgov.agentes_setor;
create trigger tg_agentes_setor_atualizado before update on gestorgov.agentes_setor
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.8 Onboarding conversacional ────────────────────────────────────────────────
--     Uma linha por implantação. "estado" guarda o que o assistente já sabe; cada passo
--     confirmado vira linha nas tabelas acima. session_id é a conversa do Agno com o assistente.

create table if not exists gestorgov.onboardings (
  id              uuid primary key default extensions.gen_random_uuid(),
  municipio_id    uuid references gestorgov.municipios(id) on delete cascade,
  session_id      text,
  etapa           text not null default 'municipio'
                  check (etapa in ('municipio', 'unidades', 'setores', 'responsaveis', 'agentes', 'rotinas', 'revisao', 'concluido')),
  estado          jsonb not null default '{}'::jsonb,
  iniciado_por    text not null,                            -- e-mail de quem conduz (o secretário)
  iniciado_em     timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  concluido_em    timestamptz
);
create index if not exists ix_onboardings_municipio on gestorgov.onboardings (municipio_id);
comment on table gestorgov.onboardings is
  'Implantação conversacional: município → unidades (CNES) → setores → responsáveis → agentes → rotinas → revisão.';

drop trigger if exists tg_onboardings_atualizado on gestorgov.onboardings;
create trigger tg_onboardings_atualizado before update on gestorgov.onboardings
  for each row execute function gestorgov.tocar_atualizado_em();


-- 5.9 Auditoria (quem fez o quê) ───────────────────────────────────────────────
--     Toda ação que muda dado: de pessoa ou de agente. Só se acrescenta; nunca se altera ou apaga.

create table if not exists gestorgov.auditoria (
  id              bigint generated always as identity primary key,
  municipio_id    uuid references gestorgov.municipios(id) on delete set null,
  em              timestamptz not null default now(),
  origem          text not null check (origem in ('pessoa', 'agente', 'rotina', 'sistema')),
  quem            text not null,                            -- e-mail, ou o id do agente/rotina
  acao            text not null,                            -- ex.: criar, alterar, aprovar_tarefa
  entidade        text not null,                            -- ex.: unidades, setores, tarefa
  entidade_id     text,
  antes           jsonb,
  depois          jsonb,
  session_id      text,                                     -- conversa do Agno, quando houver
  aprovado_por    text                                      -- quem aprovou, quando a ação foi de agente
);
create index if not exists ix_auditoria_municipio_em on gestorgov.auditoria (municipio_id, em desc);
create index if not exists ix_auditoria_entidade on gestorgov.auditoria (entidade, entidade_id);
comment on table gestorgov.auditoria is
  'Trilha de auditoria: toda alteração de pessoa ou de agente, com antes/depois e quem aprovou. Só inserção.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Permissões e segurança das tabelas
--    RLS ligado em todas, com uma política só para o servidor (gestorgov_app). Mesmo que
--    alguém exponha o schema na API por engano, anon e authenticated não leem nada.
-- ─────────────────────────────────────────────────────────────────────────────
grant select on gestorgov.tipos_setor, gestorgov.tipos_unidade to gestorgov_app;
grant select, insert, update, delete on
  gestorgov.municipios, gestorgov.secretarias, gestorgov.setores, gestorgov.unidades,
  gestorgov.servidores, gestorgov.agentes_setor, gestorgov.onboardings
  to gestorgov_app;
grant select, insert on gestorgov.auditoria to gestorgov_app;   -- auditoria: sem update nem delete
revoke update, delete, truncate on gestorgov.auditoria from gestorgov_app;  -- tira o que a regra padrão deu
grant usage, select on all sequences in schema gestorgov to gestorgov_app;

do $$
declare
  t text;
begin
  foreach t in array array['tipos_setor', 'tipos_unidade', 'municipios', 'secretarias', 'setores',
                           'unidades', 'servidores', 'agentes_setor', 'onboardings', 'auditoria']
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
-- =============================================================================
