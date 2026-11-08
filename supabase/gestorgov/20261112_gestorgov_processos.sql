-- =============================================================================
-- GestorGov — processos das atividades e o vínculo com o CompanyOS (rode DEPOIS das de 11/11/2026)
-- Pode rodar de novo: nada é duplicado.
--
-- O processo de cada atividade diz os passos e onde há gente decidindo (agente/trabalho.py):
--   agente (o agente faz), aceite (uma pessoa aceita a tarefa), aprovacao (uma pessoa aprova uma ação sensível no
--   meio da execução) e revisao (uma pessoa avalia a entrega: aprova, ou ajusta e devolve para refazer).
-- As tarefas ficam no CompanyOS do Agno (tabelas criadas pelo servidor): a área é o Product, a atividade é o
-- Project (atividades_area.projeto_id) e cada execução é uma Task. As tabelas entregas e pendencias saem: as
-- Tasks são a fonte única das tarefas e das entregas.
-- =============================================================================

alter table gestorgov.atividades_area add column if not exists projeto_id text;  -- o Project no CompanyOS

-- As tarefas e as entregas passam a viver no CompanyOS (Tasks): saem as tabelas próprias (estavam vazias).
drop table if exists gestorgov.entregas;
drop table if exists gestorgov.pendencias;

create table if not exists gestorgov.processos (
  id               uuid primary key default extensions.gen_random_uuid(),
  organizacao_id   uuid not null references gestorgov.organizacoes(id) on delete cascade,
  atividade_id     uuid not null references gestorgov.atividades_area(id) on delete cascade,
  passos           jsonb not null default '[]'::jsonb,   -- [{tipo, titulo, instrucoes | cargos}]
  versao           integer not null default 1,           -- as versões anteriores ficam na auditoria
  atualizado_por   text,
  atualizado_em    timestamptz not null default now(),
  unique (atividade_id)
);
create index if not exists ix_processos_organizacao on gestorgov.processos (organizacao_id);
comment on table gestorgov.processos is
  'O processo de cada atividade: os passos do agente e onde uma pessoa aceita, aprova ou revisa.';

grant select, insert, update, delete on gestorgov.processos to gestorgov_app;
alter table gestorgov.processos enable row level security;
drop policy if exists servidor_gestorgov on gestorgov.processos;
create policy servidor_gestorgov on gestorgov.processos for all to gestorgov_app using (true) with check (true);
