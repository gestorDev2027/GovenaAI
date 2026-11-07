-- =============================================================================
-- GestorGov — atividades dos setores (rode DEPOIS de 20261106_gestorgov_inicial.sql)
-- Pode rodar de novo: nada é duplicado.
--
-- A lógica:
--   Secretaria → Setores → Atividades → Agente do setor
--
--   Cada setor tem atividades com responsabilidades diárias. Dois tipos:
--   - rotina:      o agente procura o trabalho sozinho, num horário (vira uma Routine do CompanyOS).
--                  Ex.: Regulação, a cada hora, olha a fila e aponta quem espera há mais de 90 dias.
--   - sob_demanda: um servidor pede e o agente produz (vira uma Task do CompanyOS).
--                  Ex.: Compras elabora o termo de referência de um produto.
--   O resultado sempre volta para um servidor aprovar: o agente não aprova o próprio trabalho.
--
-- Tabelas:
--   modelos_atividade  catálogo do GestorGov: as atividades que cada tipo de setor costuma ter.
--                      O onboarding sugere estas; o secretário confirma, tira ou acrescenta.
--   atividades_setor   as atividades de verdade de cada setor de cada município.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo de atividades por tipo de setor
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.modelos_atividade (
  id               text primary key,                         -- ex.: compras_termo_referencia
  tipo_setor_id    text not null references gestorgov.tipos_setor(id) on delete cascade,
  nome             text not null,
  descricao        text not null,                            -- o que o agente faz
  tipo             text not null check (tipo in ('rotina', 'sob_demanda')),
  frequencia       text not null default 'sob_demanda'
                   check (frequencia in ('a_cada_hora', 'diaria', 'semanal', 'mensal', 'sob_demanda')),
  cron             text,                                     -- horário padrão da rotina (horário de Brasília)
  entregavel       text,                                     -- o que volta para o servidor aprovar
  padrao           boolean not null default true,            -- o onboarding já sugere marcada
  ordem            smallint not null default 0
);
create index if not exists ix_modelos_atividade_setor on gestorgov.modelos_atividade (tipo_setor_id, ordem);
comment on table gestorgov.modelos_atividade is
  'Catálogo de atividades por tipo de setor. rotina = o agente procura o trabalho num horário (Routine do CompanyOS); '
  'sob_demanda = um servidor pede (Task). O onboarding sugere as "padrao".';

insert into gestorgov.modelos_atividade
  (id, tipo_setor_id, nome, descricao, tipo, frequencia, cron, entregavel, padrao, ordem) values

  -- Compras e Licitações
  ('compras_pedido',            'compras', 'Pedido de compra',
   'Monta o pedido de compra a partir da necessidade do setor: itens, quantidades, justificativa e estimativa.',
   'sob_demanda', 'sob_demanda', null, 'Pedido de compra para revisão', true, 1),
  ('compras_termo_referencia',  'compras', 'Termo de referência',
   'Elabora o termo de referência de produtos e serviços: objeto, especificação, quantidades, prazos e obrigações.',
   'sob_demanda', 'sob_demanda', null, 'Minuta do termo de referência', true, 2),
  ('compras_edital',            'compras', 'Edital de licitação',
   'Prepara a minuta do edital a partir do termo de referência e do modelo da prefeitura.',
   'sob_demanda', 'sob_demanda', null, 'Minuta do edital', true, 3),
  ('compras_contratos_vencendo','compras', 'Contratos vencendo',
   'Confere os contratos e atas que vencem nos próximos 90 dias e propõe renovação ou nova licitação.',
   'rotina', 'diaria', '0 7 * * 1-5', 'Lista de contratos a renovar, com rascunho do termo aditivo', true, 4),
  ('compras_atas_saldo',        'compras', 'Saldo das atas de registro de preço',
   'Acompanha o saldo das atas e avisa quando um item está perto de acabar.',
   'rotina', 'semanal', '0 7 * * 1', 'Itens com saldo baixo nas atas', true, 5),

  -- Atenção Primária
  ('aps_indicadores',           'atencao_primaria', 'Indicadores das equipes',
   'Confere os indicadores das equipes de Saúde da Família: metas de visitas, atendimentos e cadastros.',
   'rotina', 'semanal', '0 7 * * 1', 'Relatório das equipes abaixo da meta, com o que fazer', true, 1),
  ('aps_visitas_acs',           'atencao_primaria', 'Visitas dos agentes comunitários',
   'Compara as visitas domiciliares feitas com a meta de cada agente comunitário.',
   'rotina', 'semanal', '0 8 * * 1', 'Microáreas com visitas atrasadas', true, 2),
  ('aps_gestantes',             'atencao_primaria', 'Acompanhamento de gestantes',
   'Aponta gestantes com consultas de pré-natal ou exames em atraso.',
   'rotina', 'semanal', '0 8 * * 2', 'Lista de gestantes para busca ativa', true, 3),
  ('aps_cronicos',              'atencao_primaria', 'Hipertensos e diabéticos',
   'Aponta hipertensos e diabéticos sem consulta ou exame no período.',
   'rotina', 'mensal', '0 8 1 * *', 'Lista para busca ativa por equipe', false, 4),

  -- Regulação
  ('reg_fila_espera',           'regulacao', 'Fila de espera',
   'Olha a fila de consultas, exames e cirurgias e aponta quem espera além do prazo (ex.: mais de 90 dias).',
   'rotina', 'a_cada_hora', '0 * * * *', 'Alerta: pacientes acima do prazo por especialidade', true, 1),
  ('reg_vagas_ociosas',         'regulacao', 'Vagas sem uso',
   'Confere as vagas ofertadas que não foram preenchidas ou tiveram falta.',
   'rotina', 'diaria', '0 18 * * 1-5', 'Vagas perdidas no dia e sugestão de remanejamento', true, 2),
  ('reg_prioridades',           'regulacao', 'Prioridades clínicas',
   'Revisa a classificação de prioridade das solicitações novas.',
   'rotina', 'diaria', '0 9 * * 1-5', 'Solicitações para o médico regulador conferir', false, 3),

  -- Assistência Farmacêutica
  ('farm_estoque',              'farmacia', 'Estoque de medicamentos',
   'Compara o estoque de cada unidade com o consumo médio e aponta o que vai acabar.',
   'rotina', 'diaria', '0 7 * * *', 'Itens que acabam em até 15 dias e proposta de remanejamento', true, 1),
  ('farm_validade',             'farmacia', 'Validade',
   'Aponta lotes que vencem nos próximos 60 dias.',
   'rotina', 'semanal', '0 7 * * 1', 'Lotes a remanejar antes de vencer', true, 2),
  ('farm_programacao',          'farmacia', 'Programação de compras',
   'Calcula a necessidade de compra do período a partir do consumo.',
   'rotina', 'mensal', '0 7 1 * *', 'Programação de compra para o setor de Compras', true, 3),

  -- Vigilância em Saúde
  ('vig_notificacoes',          'vigilancia', 'Notificações',
   'Acompanha as notificações de agravos e aponta aumento fora do esperado.',
   'rotina', 'diaria', '0 8 * * *', 'Boletim do dia e alertas', true, 1),
  ('vig_vacinacao',             'vigilancia', 'Cobertura vacinal',
   'Confere a cobertura vacinal por vacina e por unidade.',
   'rotina', 'semanal', '0 8 * * 1', 'Unidades e vacinas abaixo da meta', true, 2),

  -- Gestão de Pessoas
  ('rh_escalas',                'rh', 'Escalas e plantões',
   'Confere as escalas do mês seguinte e aponta furos e excesso de horas.',
   'rotina', 'semanal', '0 9 * * 3', 'Escala com os furos marcados', true, 1),
  ('rh_ferias',                 'rh', 'Férias e afastamentos',
   'Cruza férias e afastamentos com as escalas das unidades.',
   'rotina', 'mensal', '0 9 1 * *', 'Unidades com falta de pessoal previstas', false, 2),

  -- Financeiro e Orçamento
  ('fin_execucao',              'financeiro', 'Execução orçamentária',
   'Acompanha o empenhado e o pago do Fundo Municipal de Saúde por fonte e programa.',
   'rotina', 'semanal', '0 8 * * 1', 'Resumo da execução e alertas de saldo', true, 1),
  ('fin_prestacao_contas',      'financeiro', 'Prestação de contas',
   'Lembra os prazos de prestação de contas e monta o rascunho dos relatórios.',
   'rotina', 'mensal', '0 8 1 * *', 'Prazos do mês e rascunhos', true, 2),

  -- Faturamento e Informação
  ('fat_prazos_envio',          'faturamento', 'Prazos de envio da produção',
   'Lembra os prazos de envio da produção aos sistemas oficiais e confere o que falta.',
   'rotina', 'semanal', '0 8 * * 1', 'Unidades com produção pendente', true, 1),
  ('fat_inconsistencias',       'faturamento', 'Inconsistências na produção',
   'Aponta registros com erro antes do envio (procedimento incompatível, campo faltando).',
   'rotina', 'diaria', '0 19 * * 1-5', 'Registros a corrigir por unidade', true, 2),

  -- Ouvidoria
  ('ouv_manifestacoes',         'ouvidoria', 'Manifestações',
   'Classifica as manifestações novas e encaminha para o setor certo.',
   'rotina', 'a_cada_hora', '30 * * * *', 'Manifestações encaminhadas', true, 1),
  ('ouv_prazos',                'ouvidoria', 'Prazos de resposta',
   'Aponta manifestações perto do prazo de resposta.',
   'rotina', 'diaria', '0 8 * * 1-5', 'Respostas pendentes por setor', true, 2),

  -- Gabinete
  ('gab_resumo',                'gabinete', 'Resumo do dia do secretário',
   'Junta o que cada setor apontou: alertas, aprovações pendentes e prazos.',
   'rotina', 'diaria', '30 7 * * 1-5', 'Resumo da manhã', true, 1),
  ('gab_oficios',               'gabinete', 'Ofícios e respostas',
   'Redige ofícios, respostas a órgãos de controle e comunicações internas.',
   'sob_demanda', 'sob_demanda', null, 'Minuta do documento', true, 2)

on conflict (id) do update
  set tipo_setor_id = excluded.tipo_setor_id, nome = excluded.nome, descricao = excluded.descricao,
      tipo = excluded.tipo, frequencia = excluded.frequencia, cron = excluded.cron,
      entregavel = excluded.entregavel, padrao = excluded.padrao, ordem = excluded.ordem;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Atividades de cada setor do município
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.atividades_setor (
  id               uuid primary key default extensions.gen_random_uuid(),
  municipio_id     uuid not null references gestorgov.municipios(id) on delete cascade,
  setor_id         uuid not null references gestorgov.setores(id) on delete cascade,
  modelo_id        text references gestorgov.modelos_atividade(id) on delete set null,  -- vazio = criada pelo secretário
  nome             text not null,
  descricao        text not null,
  tipo             text not null check (tipo in ('rotina', 'sob_demanda')),
  frequencia       text not null default 'sob_demanda'
                   check (frequencia in ('a_cada_hora', 'diaria', 'semanal', 'mensal', 'sob_demanda')),
  cron             text,
  entregavel       text,
  agente_id        text,                                     -- agente da Fábrica que executa
  aprovador_id     uuid references gestorgov.servidores(id) on delete set null,  -- quem aprova o resultado
  rotina_id        text,                                     -- id da Routine no CompanyOS (quando tipo = rotina)
  ativa            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (setor_id, nome)
);
create index if not exists ix_atividades_municipio on gestorgov.atividades_setor (municipio_id);
create index if not exists ix_atividades_agente on gestorgov.atividades_setor (agente_id);
comment on table gestorgov.atividades_setor is
  'O que cada setor faz no município: rotinas (agente procura o trabalho) e pedidos sob demanda, com o agente que executa '
  'e o servidor que aprova.';

drop trigger if exists tg_atividades_setor_atualizado on gestorgov.atividades_setor;
create trigger tg_atividades_setor_atualizado before update on gestorgov.atividades_setor
  for each row execute function gestorgov.tocar_atualizado_em();

-- O onboarding passa a ter a etapa "atividades" (entre setores e responsáveis).
alter table gestorgov.onboardings drop constraint if exists onboardings_etapa_check;
alter table gestorgov.onboardings add constraint onboardings_etapa_check
  check (etapa in ('municipio', 'unidades', 'setores', 'atividades', 'responsaveis', 'agentes',
                   'rotinas', 'revisao', 'concluido'));


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Permissões e segurança
-- ─────────────────────────────────────────────────────────────────────────────
grant select on gestorgov.modelos_atividade to gestorgov_app;
grant select, insert, update, delete on gestorgov.atividades_setor to gestorgov_app;

do $$
declare
  t text;
begin
  foreach t in array array['modelos_atividade', 'atividades_setor']
  loop
    execute format('alter table gestorgov.%I enable row level security', t);
    execute format('drop policy if exists servidor_gestorgov on gestorgov.%I', t);
    execute format('create policy servidor_gestorgov on gestorgov.%I for all to gestorgov_app using (true) with check (true)', t);
  end loop;
end $$;

-- O catálogo é do GestorGov: o servidor só lê (a regra padrão do schema daria escrita).
revoke insert, update, delete, truncate on gestorgov.modelos_atividade from gestorgov_app;
