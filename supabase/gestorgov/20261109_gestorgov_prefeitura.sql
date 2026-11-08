-- =============================================================================
-- GestorGov — cadastro detalhado da prefeitura e da Secretaria de Saúde (rode DEPOIS de 20261108_gestorgov_unidades.sql)
-- Pode rodar de novo: nada é duplicado.
--
-- A primeira fase da implantação é o cadastro completo, com campos obrigatórios (agente/gestao.py:
-- CAMPOS_OBRIGATORIOS): a implantação só passa para os setores quando ele está completo.
--
--   municipios   a prefeitura: CNPJ, endereço (rua, número, bairro; o CEP é municipios.cep), telefone, e-mail, site e
--                o(a) prefeito(a)
--   secretarias  a Secretaria de Saúde: CNPJ do Fundo Municipal de Saúde, endereço (rua, número, bairro, CEP),
--                telefone, e-mail institucional e o telefone do(a) secretário(a)
-- =============================================================================

alter table gestorgov.municipios add column if not exists prefeitura_cnpj        char(14);
alter table gestorgov.municipios add column if not exists prefeitura_logradouro  text;
alter table gestorgov.municipios add column if not exists prefeitura_numero      text;
alter table gestorgov.municipios add column if not exists prefeitura_bairro      text;
alter table gestorgov.municipios add column if not exists prefeitura_telefone    text;
alter table gestorgov.municipios add column if not exists prefeitura_email       text;
alter table gestorgov.municipios add column if not exists prefeitura_site        text;
alter table gestorgov.municipios add column if not exists prefeito_nome          text;

alter table gestorgov.secretarias add column if not exists fundo_cnpj           char(14);  -- Fundo Municipal de Saúde
alter table gestorgov.secretarias add column if not exists logradouro           text;
alter table gestorgov.secretarias add column if not exists numero               text;
alter table gestorgov.secretarias add column if not exists bairro               text;
alter table gestorgov.secretarias add column if not exists telefone             text;
alter table gestorgov.secretarias add column if not exists email                text;
alter table gestorgov.secretarias add column if not exists secretario_telefone  text;

comment on column gestorgov.secretarias.fundo_cnpj is 'CNPJ do Fundo Municipal de Saúde (é por ele que a saúde recebe e paga).';


-- ─────────────────────────────────────────────────────────────────────────────
-- Convites com aprovação: os que o Assistente de Implantação cria esperam o dono aprovar no painel (Equipe e
-- acessos); só então o link vale. Os criados no painel já nascem aprovados.
-- ─────────────────────────────────────────────────────────────────────────────
alter table gestorgov.convites add column if not exists origem        text not null default 'painel';
alter table gestorgov.convites add column if not exists aprovado_em   timestamptz;
alter table gestorgov.convites add column if not exists aprovado_por  text;
update gestorgov.convites set aprovado_em = criado_em, aprovado_por = criado_por where aprovado_em is null and origem = 'painel';


-- ─────────────────────────────────────────────────────────────────────────────
-- Links da implantação: o dono compartilha a implantação com um colaborador da secretaria. O link leva um código
-- de segurança (6 dígitos, mostrado uma vez); quem entra com os dois vira membro da prefeitura e continua a
-- implantação. Só os hashes ficam guardados.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.implantacao_links (
  id            uuid primary key default extensions.gen_random_uuid(),
  municipio_id  uuid not null references gestorgov.municipios(id) on delete cascade,
  token_hash    text not null unique,
  codigo_hash   text not null,
  criado_por    text not null,
  criado_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  cancelado_em  timestamptz,
  usos          integer not null default 0,
  falhas        integer not null default 0   -- códigos errados seguidos: com 5, o link se cancela
);
create index if not exists ix_implantacao_links_municipio on gestorgov.implantacao_links (municipio_id);

grant select, insert, update, delete on gestorgov.implantacao_links to gestorgov_app;
alter table gestorgov.implantacao_links enable row level security;
drop policy if exists servidor_gestorgov on gestorgov.implantacao_links;
create policy servidor_gestorgov on gestorgov.implantacao_links for all to gestorgov_app using (true) with check (true);
