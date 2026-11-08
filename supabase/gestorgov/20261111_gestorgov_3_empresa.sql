-- =============================================================================
-- GestorGov — catálogo do segmento Empresa (rode DEPOIS de 20261111_gestorgov_1_base.sql)
-- Pode rodar de novo: cada linha é atualizada pelo id.
--
--   tipos_area         os departamentos que uma empresa costuma ter (10; 7 sugeridos na implantação)
--   tipos_unidade      os tipos de unidade do mapa: matriz, filiais, lojas, depósitos, fábricas, escritórios (6)
--   modelos_atividade  as atividades de cada departamento: rotinas (o agente faz sozinho, num horário) e sob demanda
--   modelos_cargo      o organograma mínimo: diretoria, um gerente por departamento e a gerência de unidade (8)
--   modelos_indicador  os indicadores de cada cargo, com fonte, periodicidade e sentido (16)
--
-- Os ids levam o prefixo emp_ para não colidir com os da saúde. Catálogo mínimo: a empresa confirma, tira ou
-- acrescenta na implantação.
-- =============================================================================


-- Departamentos ────────────────────────────────────────────────────────────────
insert into gestorgov.tipos_area (id, segmento_id, nome, descricao, icone, ordem, padrao) values
  ('emp_diretoria', 'empresa',     'Diretoria',                 'Direção, metas e decisões da empresa.',                         'landmark',        1, true),
  ('emp_financeiro', 'empresa',    'Financeiro',                'Contas a pagar e a receber, fluxo de caixa e conciliação.',     'wallet',          2, true),
  ('emp_comercial', 'empresa',     'Comercial e Vendas',        'Propostas, pedidos, clientes e metas de vendas.',               'handshake',       3, true),
  ('emp_compras', 'empresa',       'Compras e Suprimentos',     'Cotações, pedidos de compra e contratos de fornecedores.',      'shopping-cart',   4, true),
  ('emp_rh', 'empresa',            'Recursos Humanos',          'Pessoas, admissões, férias, documentos e vagas.',               'users',           5, true),
  ('emp_operacoes', 'empresa',     'Operações e Logística',     'Estoque, expedição, entregas e produção.',                      'truck',           6, true),
  ('emp_atendimento', 'empresa',   'Atendimento ao Cliente',    'Chamados, reclamações e pós-venda.',                            'headset',         7, true),
  ('emp_marketing', 'empresa',     'Marketing',                 'Campanhas, canais e marca.',                                    'megaphone',       8, false),
  ('emp_ti', 'empresa',            'Tecnologia da Informação',  'Sistemas, computadores, rede e acessos.',                       'monitor',         9, false),
  ('emp_juridico', 'empresa',      'Jurídico',                  'Contratos, processos e conformidade.',                          'scale',          10, false)
on conflict (id) do update
  set segmento_id = excluded.segmento_id, nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone,
      ordem = excluded.ordem, padrao = excluded.padrao;




-- Tipos de unidade ─────────────────────────────────────────────────────────────
insert into gestorgov.tipos_unidade (id, segmento_id, nome, codigos_cnes, icone, cor, ordem) values
  ('emp_matriz', 'empresa',      'Matriz / Sede',          '{}', 'building-2',  '#0D1B38', 1),
  ('emp_filial', 'empresa',      'Filial',                 '{}', 'building',    '#1A63D8', 2),
  ('emp_loja', 'empresa',        'Loja',                   '{}', 'store',       '#52A2FF', 3),
  ('emp_deposito', 'empresa',    'Depósito / Centro de distribuição', '{}', 'warehouse', '#F4B800', 4),
  ('emp_fabrica', 'empresa',     'Fábrica',                '{}', 'factory',     '#424E6B', 5),
  ('emp_escritorio', 'empresa',  'Escritório',             '{}', 'briefcase',   '#1A63D8', 6)
on conflict (id) do update
  set segmento_id = excluded.segmento_id, nome = excluded.nome, codigos_cnes = excluded.codigos_cnes, icone = excluded.icone,
      cor = excluded.cor, ordem = excluded.ordem;



-- Atividades de cada departamento ──────────────────────────────────────────────
insert into gestorgov.modelos_atividade
  (id, tipo_area_id, nome, descricao, tipo, frequencia, cron, entregavel, padrao, ordem) values

  -- Diretoria
  ('emp_diretoria_painel_mensal',      'emp_diretoria', 'Painel mensal de indicadores',
   'Junta os indicadores de cada departamento no mês: vendas, caixa, estoque, pessoas e atendimento.',
   'rotina', 'mensal', '0 7 1 * *', 'Painel do mês com os pontos de atenção', true, 1),
  ('emp_diretoria_resumo_dia',         'emp_diretoria', 'Resumo do dia da diretoria',
   'Junta o que cada departamento apontou: alertas, aprovações pendentes e prazos.',
   'rotina', 'diaria', '30 7 * * 1-5', 'Resumo da manhã', true, 2),
  ('emp_diretoria_comunicados',        'emp_diretoria', 'Comunicados e apresentações',
   'Redige comunicados internos, apresentações e respostas a sócios e parceiros.',
   'sob_demanda', 'sob_demanda', null, 'Minuta do documento', true, 3),

  -- Financeiro
  ('emp_financeiro_contas_pagar',      'emp_financeiro', 'Contas a pagar vencendo',
   'Confere as contas a pagar que vencem nos próximos dias e aponta as que estão sem aprovação ou sem saldo.',
   'rotina', 'diaria', '0 7 * * 1-5', 'Lista de pagamentos do dia e da semana para aprovar', true, 1),
  ('emp_financeiro_fluxo_caixa',       'emp_financeiro', 'Fluxo de caixa semanal',
   'Projeta entradas e saídas das próximas semanas e aponta quando o caixa fica abaixo do mínimo.',
   'rotina', 'semanal', '0 7 * * 1', 'Fluxo de caixa projetado com os alertas', true, 2),
  ('emp_financeiro_conciliacao',       'emp_financeiro', 'Conciliação bancária',
   'Cruza o extrato do banco com os lançamentos e aponta o que não bate.',
   'sob_demanda', 'sob_demanda', null, 'Relatório de divergências para conferir', true, 3),

  -- Comercial e Vendas
  ('emp_comercial_propostas_paradas',  'emp_comercial', 'Propostas paradas',
   'Aponta propostas enviadas sem retorno do cliente há mais de 7 dias e sugere o próximo contato.',
   'rotina', 'diaria', '0 7 * * 1-5', 'Propostas a retomar, por vendedor', true, 1),
  ('emp_comercial_relatorio_vendas',   'emp_comercial', 'Relatório de vendas',
   'Compara as vendas da semana com a meta, por vendedor, produto e região.',
   'rotina', 'semanal', '0 7 * * 1', 'Relatório de vendas da semana', true, 2),
  ('emp_comercial_proposta',           'emp_comercial', 'Proposta comercial',
   'Monta a proposta para o cliente a partir do pedido: itens, preços, prazos e condições.',
   'sob_demanda', 'sob_demanda', null, 'Minuta da proposta', true, 3),

  -- Compras e Suprimentos
  ('emp_compras_cotacao',              'emp_compras', 'Cotação de fornecedores',
   'Monta o pedido de cotação, compara as respostas dos fornecedores e recomenda a melhor.',
   'sob_demanda', 'sob_demanda', null, 'Mapa de cotação com a recomendação', true, 1),
  ('emp_compras_contratos_vencendo',   'emp_compras', 'Contratos de fornecedores vencendo',
   'Confere os contratos que vencem nos próximos 90 dias e propõe renovar, renegociar ou cotar de novo.',
   'rotina', 'semanal', '0 7 * * 1', 'Lista de contratos a renovar', true, 2),

  -- Recursos Humanos
  ('emp_rh_ferias_documentos',         'emp_rh', 'Férias e documentos vencendo',
   'Aponta férias a vencer, exames periódicos, treinamentos obrigatórios e documentos com prazo.',
   'rotina', 'semanal', '0 7 * * 1', 'Lista de vencimentos por pessoa e departamento', true, 1),
  ('emp_rh_descricao_vaga',            'emp_rh', 'Descrição de vaga',
   'Redige a descrição da vaga a partir do pedido do gestor: atividades, requisitos e benefícios.',
   'sob_demanda', 'sob_demanda', null, 'Minuta da descrição da vaga', true, 2),
  ('emp_rh_quadro_mensal',             'emp_rh', 'Quadro de pessoal',
   'Resume admissões, desligamentos, faltas e horas extras do mês.',
   'rotina', 'mensal', '0 7 1 * *', 'Relatório do quadro de pessoal', false, 3),

  -- Operações e Logística
  ('emp_operacoes_estoque_minimo',     'emp_operacoes', 'Estoque abaixo do mínimo',
   'Compara o estoque de cada item com o mínimo e o consumo médio e aponta o que vai faltar.',
   'rotina', 'diaria', '0 7 * * 1-5', 'Itens abaixo do mínimo e proposta de reposição', true, 1),
  ('emp_operacoes_entregas_atrasadas', 'emp_operacoes', 'Entregas atrasadas',
   'Aponta pedidos com entrega atrasada ou em risco e o motivo.',
   'rotina', 'diaria', '0 8 * * 1-5', 'Entregas atrasadas para tratar', true, 2),

  -- Atendimento ao Cliente
  ('emp_atendimento_sem_resposta',     'emp_atendimento', 'Chamados sem resposta',
   'Aponta chamados abertos sem resposta além do prazo combinado.',
   'rotina', 'diaria', '0 8 * * 1-5', 'Chamados a responder, por responsável', true, 1),
  ('emp_atendimento_reclamacoes',      'emp_atendimento', 'Resumo semanal de reclamações',
   'Agrupa as reclamações da semana por motivo, produto e unidade e aponta o que repete.',
   'rotina', 'semanal', '0 7 * * 1', 'Resumo das reclamações com os motivos que mais aparecem', true, 2),
  ('emp_atendimento_resposta',         'emp_atendimento', 'Resposta ao cliente',
   'Redige a resposta a uma reclamação ou pedido do cliente.',
   'sob_demanda', 'sob_demanda', null, 'Minuta da resposta', true, 3)

on conflict (id) do update
  set tipo_area_id = excluded.tipo_area_id, nome = excluded.nome, descricao = excluded.descricao,
      tipo = excluded.tipo, frequencia = excluded.frequencia, cron = excluded.cron,
      entregavel = excluded.entregavel, padrao = excluded.padrao, ordem = excluded.ordem;




-- Cargos (organograma) ─────────────────────────────────────────────────────────
insert into gestorgov.modelos_cargo
  (id, segmento_id, nome, nivel, tipo_area_id, superior_id, atribuicoes, rotinas, entregas, padrao, ordem) values
  ('emp_diretor_geral', 'empresa', 'Diretor(a) Geral', 'direcao', 'emp_diretoria', null,
   'Dirige a empresa, define as metas, aprova as decisões de maior impacto e responde aos sócios.',
   '[{"frequencia": "diaria", "texto": "Resumo do dia"}, {"frequencia": "semanal", "texto": "Reunião com os gerentes"}, {"frequencia": "mensal", "texto": "Painel de indicadores"}]', '[{"frequencia": "mensal", "texto": "Relatório aos sócios"}]', true, 1),
  ('emp_gerente_financeiro', 'empresa', 'Gerente Financeiro', 'coordenacao', 'emp_financeiro', 'emp_diretor_geral',
   'Cuida do caixa, das contas a pagar e a receber e da conciliação, e aprova os pagamentos.',
   '[{"frequencia": "diaria", "texto": "Pagamentos e recebimentos"}, {"frequencia": "semanal", "texto": "Fluxo de caixa"}, {"frequencia": "mensal", "texto": "Fechamento"}]', '[{"frequencia": "semanal", "texto": "Fluxo de caixa projetado"}, {"frequencia": "mensal", "texto": "Fechamento financeiro"}]', true, 2),
  ('emp_gerente_comercial', 'empresa', 'Gerente Comercial', 'coordenacao', 'emp_comercial', 'emp_diretor_geral',
   'Conduz a equipe de vendas, acompanha propostas e metas e aprova preços e condições especiais.',
   '[{"frequencia": "diaria", "texto": "Propostas em andamento"}, {"frequencia": "semanal", "texto": "Vendas contra a meta"}]', '[{"frequencia": "semanal", "texto": "Relatório de vendas"}, {"frequencia": "mensal", "texto": "Previsão de vendas"}]', true, 3),
  ('emp_gerente_compras', 'empresa', 'Gerente de Compras e Suprimentos', 'coordenacao', 'emp_compras', 'emp_diretor_geral',
   'Compra o que a empresa precisa com o melhor custo, negocia com fornecedores e acompanha os contratos.',
   '[{"frequencia": "diaria", "texto": "Pedidos de compra"}, {"frequencia": "semanal", "texto": "Contratos vencendo"}]', '[{"frequencia": "mensal", "texto": "Relatório de compras e economia"}]', true, 4),
  ('emp_gerente_rh', 'empresa', 'Gerente de Recursos Humanos', 'coordenacao', 'emp_rh', 'emp_diretor_geral',
   'Cuida das admissões, férias, documentos, treinamentos e do quadro de pessoal.',
   '[{"frequencia": "semanal", "texto": "Vencimentos de férias e documentos"}, {"frequencia": "mensal", "texto": "Folha e frequência"}]', '[{"frequencia": "mensal", "texto": "Relatório do quadro de pessoal"}]', true, 5),
  ('emp_gerente_operacoes', 'empresa', 'Gerente de Operações e Logística', 'coordenacao', 'emp_operacoes', 'emp_diretor_geral',
   'Garante o estoque, a expedição e as entregas no prazo.',
   '[{"frequencia": "diaria", "texto": "Estoque crítico e entregas do dia"}, {"frequencia": "mensal", "texto": "Inventário"}]', '[{"frequencia": "semanal", "texto": "Relatório de entregas"}, {"frequencia": "mensal", "texto": "Inventário"}]', true, 6),
  ('emp_gerente_atendimento', 'empresa', 'Gerente de Atendimento ao Cliente', 'coordenacao', 'emp_atendimento', 'emp_diretor_geral',
   'Garante que todo chamado tenha resposta no prazo e trata as causas das reclamações.',
   '[{"frequencia": "diaria", "texto": "Chamados em aberto"}, {"frequencia": "semanal", "texto": "Reclamações da semana"}]', '[{"frequencia": "semanal", "texto": "Resumo de reclamações"}]', true, 7),
  ('emp_gerente_unidade', 'empresa', 'Gerência de unidade (filial, loja, depósito)', 'unidade', 'emp_operacoes', 'emp_gerente_operacoes',
   'Gestão da unidade: equipe, estoque, vendas e atendimento. Responde à gerência de Operações.',
   '[{"frequencia": "diaria", "texto": "Abertura e fechamento da unidade"}, {"frequencia": "semanal", "texto": "Resultado da unidade"}]', '[{"frequencia": "semanal", "texto": "Relatório da unidade"}]', true, 8)
on conflict (id) do update set
  segmento_id = excluded.segmento_id, nome = excluded.nome, nivel = excluded.nivel, tipo_area_id = excluded.tipo_area_id,
  superior_id = excluded.superior_id, atribuicoes = excluded.atribuicoes, rotinas = excluded.rotinas,
  entregas = excluded.entregas, padrao = excluded.padrao, ordem = excluded.ordem;




-- Indicadores de cada cargo ────────────────────────────────────────────────────
insert into gestorgov.modelos_indicador
  (id, modelo_cargo_id, nome, fonte, periodicidade, unidade, sentido, ordem) values
  ('emp_diretor_geral__faturamento_contra_a_meta', 'emp_diretor_geral', 'Faturamento contra a meta', 'ERP', 'mensal', '%', 'maior', 1),
  ('emp_diretor_geral__margem_liquida', 'emp_diretor_geral', 'Margem líquida', 'ERP', 'mensal', '%', 'maior', 2),
  ('emp_gerente_financeiro__contas_pagas_em_atraso', 'emp_gerente_financeiro', 'Contas pagas em atraso', 'ERP', 'mensal', 'número', 'menor', 3),
  ('emp_gerente_financeiro__inadimplencia', 'emp_gerente_financeiro', 'Inadimplência', 'ERP', 'mensal', '%', 'menor', 4),
  ('emp_gerente_comercial__vendas_contra_a_meta', 'emp_gerente_comercial', 'Vendas contra a meta', 'CRM', 'semanal', '%', 'maior', 5),
  ('emp_gerente_comercial__taxa_de_conversao_de_propostas', 'emp_gerente_comercial', 'Taxa de conversão de propostas', 'CRM', 'mensal', '%', 'maior', 6),
  ('emp_gerente_compras__economia_nas_compras', 'emp_gerente_compras', 'Economia nas compras', 'ERP', 'mensal', '%', 'maior', 7),
  ('emp_gerente_compras__prazo_medio_de_compra', 'emp_gerente_compras', 'Prazo médio de compra', 'ERP', 'mensal', 'dias', 'menor', 8),
  ('emp_gerente_rh__rotatividade', 'emp_gerente_rh', 'Rotatividade (turnover)', 'planilha', 'mensal', '%', 'menor', 9),
  ('emp_gerente_rh__absenteismo', 'emp_gerente_rh', 'Absenteísmo', 'planilha', 'mensal', '%', 'menor', 10),
  ('emp_gerente_operacoes__entregas_no_prazo', 'emp_gerente_operacoes', 'Entregas no prazo', 'ERP', 'semanal', '%', 'maior', 11),
  ('emp_gerente_operacoes__ruptura_de_estoque', 'emp_gerente_operacoes', 'Ruptura de estoque', 'ERP', 'semanal', 'número', 'menor', 12),
  ('emp_gerente_atendimento__tempo_medio_de_resposta', 'emp_gerente_atendimento', 'Tempo médio de resposta', 'interno', 'semanal', 'horas', 'menor', 13),
  ('emp_gerente_atendimento__satisfacao_do_cliente', 'emp_gerente_atendimento', 'Satisfação do cliente', 'interno', 'mensal', '%', 'maior', 14),
  ('emp_gerente_unidade__resultado_da_unidade', 'emp_gerente_unidade', 'Resultado da unidade contra a meta', 'ERP', 'mensal', '%', 'maior', 15),
  ('emp_gerente_unidade__reclamacoes_da_unidade', 'emp_gerente_unidade', 'Reclamações da unidade', 'interno', 'semanal', 'número', 'menor', 16)
on conflict (id) do update set
  modelo_cargo_id = excluded.modelo_cargo_id, nome = excluded.nome, fonte = excluded.fonte,
  periodicidade = excluded.periodicidade, unidade = excluded.unidade, sentido = excluded.sentido,
  ordem = excluded.ordem;
