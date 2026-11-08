-- =============================================================================
-- GestorGov — cadastro completo das unidades de saúde (rode DEPOIS de 20261107_gestorgov_organograma.sql)
-- Pode rodar de novo: nada é duplicado.
--
-- A secretaria confere e completa, na implantação, cada unidade que veio do CNES e cadastra as que faltam:
-- o CEP busca o endereço no ViaCEP, o endereço vira o ponto no mapa, e a equipe envia a foto da fachada.
--
-- O que muda:
--   unidades          ganha número, complemento, e-mail, de onde veio o ponto no mapa (coordenadas_origem) e quem
--                     conferiu e quando (conferida_por, conferida_em) e o agente de IA da unidade (agente_id)
--   unidade_fotos     as fotos de cada unidade (fachada, interior...), com a principal; o arquivo fica no bucket
--   bucket prefeituras  arquivos de cada prefeitura (privado; caminho prefeituras/<município>/...)
--
-- A vista de satélite da ficha não é gauardada: vem da API de imagens estáticas do Mapbox, pelo ponto no mapa.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Unidades: endereço completo e conferência
-- ─────────────────────────────────────────────────────────────────────────────
alter table gestorgov.unidades add column if not exists numero              text;
alter table gestorgov.unidades add column if not exists complemento         text;
alter table gestorgov.unidades add column if not exists email               text;
alter table gestorgov.unidades add column if not exists coordenadas_origem  text;
alter table gestorgov.unidades add column if not exists conferida_por       text;
alter table gestorgov.unidades add column if not exists conferida_em        timestamptz;
alter table gestorgov.unidades add column if not exists criado_por          text;
alter table gestorgov.unidades add column if not exists agente_id           text;   -- o agente de IA da unidade (Fábrica)

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_unidades_coordenadas_origem') then
    alter table gestorgov.unidades add constraint ck_unidades_coordenadas_origem
      check (coordenadas_origem is null or coordenadas_origem in ('cnes', 'endereco', 'cep', 'mapa', 'manual'));
  end if;
end $$;

comment on column gestorgov.unidades.coordenadas_origem is
  'De onde veio o ponto no mapa: cnes, endereco (rua e número), cep (só o CEP), mapa (ajustado à mão no mapa) ou manual.';
comment on column gestorgov.unidades.confirmada is
  'A secretaria conferiu os dados da unidade (na implantação ou depois). conferida_por e conferida_em dizem quem e quando.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fotos das unidades
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.unidade_fotos (
  id            uuid primary key default extensions.gen_random_uuid(),
  municipio_id  uuid not null references gestorgov.municipios(id) on delete cascade,
  unidade_id    uuid not null references gestorgov.unidades(id) on delete cascade,
  tipo          text not null default 'fachada' check (tipo in ('fachada', 'interior', 'outra')),
  caminho       text not null,                     -- no bucket prefeituras
  mime          text not null,
  bytes         integer not null,
  largura       integer,
  altura        integer,
  legenda       text,
  principal     boolean not null default false,    -- a que aparece na ficha e no mapa
  enviada_por   text not null,
  enviada_em    timestamptz not null default now()
);
create index if not exists ix_unidade_fotos_unidade on gestorgov.unidade_fotos (unidade_id);
create unique index if not exists ux_unidade_fotos_principal on gestorgov.unidade_fotos (unidade_id) where principal;
comment on table gestorgov.unidade_fotos is
  'Fotos das unidades de saúde enviadas pela secretaria. Uma por unidade é a principal.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Storage: bucket privado das prefeituras
--    Caminho: prefeituras/<município>/unidades/<unidade>/<foto>.jpg
--    Sem políticas para anon/authenticated: só o servidor (service role) lê e grava.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prefeituras', 'prefeituras', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set allowed_mime_types = excluded.allowed_mime_types,
      file_size_limit    = excluded.file_size_limit;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Permissões e segurança
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on gestorgov.unidade_fotos to gestorgov_app;

alter table gestorgov.unidade_fotos enable row level security;
drop policy if exists servidor_gestorgov on gestorgov.unidade_fotos;
create policy servidor_gestorgov on gestorgov.unidade_fotos for all to gestorgov_app using (true) with check (true);

-- =============================================================================
-- Variável no Render (opcional): SUPABASE_BUCKET_PREFEITURAS=prefeituras
-- =============================================================================
