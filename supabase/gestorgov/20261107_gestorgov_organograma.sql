-- =============================================================================
-- GestorGov — organograma, contas e acompanhamento (rode DEPOIS de 20261106_gestorgov_atividades.sql)
-- Pode rodar de novo: nada é duplicado.
--
-- A lógica (documento "Secretaria de Saúde Virtual — Organograma, Atribuições e Indicadores"):
--   Cada CARGO da secretaria vira um agente, com a mesma ficha: atribuições, indicadores, rotinas,
--   entregas, a quem se reporta, alertas e status atual. O organograma tem 5 níveis: direção,
--   superintendências, coordenações, unidades e instâncias de controle e apoio.
--   Os alertas sobem pela hierarquia (coordenação → superintendência → Adjunto → Secretário).
--
-- Tabelas:
--   membros            quem é quem em cada prefeitura (secretário, coordenador, servidor, administrador)
--   modelos_cargo      catálogo dos cargos do documento (o onboarding sugere estes)
--   modelos_indicador  catálogo dos indicadores de cada cargo, com fonte e periodicidade
--   cargos             os cargos de cada município, com o superior (a hierarquia), o setor e o agente
--   indicadores_cargo  os indicadores de cada cargo, com a meta que o município define
--   medicoes           cada valor medido de um indicador (para a tendência)
--   entregas           documentos e relatórios com prazo e situação, e quem aprovou
--   pendencias         itens parados, desde quando e por quê
--   status_cargo       o que o agente do cargo está fazendo agora
--   alertas_cargo      os alertas, de quem para quem, e o caminho de escalonamento
--   atividades_setor   ganha cargo_id: a rotina passa a ser do cargo
--
-- As contas de login (e-mail e senha) ficam em painel_contas, que o servidor cria ao subir.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Membros: quem é quem em cada prefeitura
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.membros (
  id              uuid primary key default extensions.gen_random_uuid(),
  municipio_id    uuid not null references gestorgov.municipios(id) on delete cascade,
  email           text not null,
  papel           text not null default 'servidor'
                  check (papel in ('secretario', 'administrador', 'coordenador', 'servidor')),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  criado_por      text,
  unique (municipio_id, email)
);
create index if not exists ix_membros_email on gestorgov.membros (email);
comment on table gestorgov.membros is
  'Quem é quem em cada prefeitura. Quem cadastra a prefeitura entra como secretário.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Catálogo de cargos e indicadores
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.modelos_cargo (
  id               text primary key,                          -- ex.: sup_aps
  nome             text not null,
  nivel            text not null
                   check (nivel in ('direcao', 'superintendencia', 'coordenacao', 'unidade', 'controle')),
  tipo_setor_id    text references gestorgov.tipos_setor(id) on delete set null,  -- a sala do prédio
  superior_id      text references gestorgov.modelos_cargo(id) on delete set null,  -- a quem se reporta
  atribuicoes      text not null,
  rotinas          jsonb not null default '[]'::jsonb,       -- [{frequencia, texto}]
  entregas         jsonb not null default '[]'::jsonb,       -- [{frequencia, texto}]
  padrao           boolean not null default true,
  ordem            smallint not null default 0
);
comment on table gestorgov.modelos_cargo is 'Catálogo de cargos da Secretaria de Saúde (o organograma padrão).';

create table if not exists gestorgov.modelos_indicador (
  id               text primary key,                          -- ex.: sup_aps__absenteismo_nas_consultas
  modelo_cargo_id  text not null references gestorgov.modelos_cargo(id) on delete cascade,
  nome             text not null,
  fonte            text not null,                             -- e-SUS APS, SIAPS, SIM, SINAN, SIA/SIH, CNES, SIOPS, interno
  periodicidade    text not null
                   check (periodicidade in ('diaria', 'semanal', 'mensal', 'trimestral', 'quadrimestral', 'anual')),
  unidade          text not null,                             -- %, dias, número, R$...
  sentido          text not null check (sentido in ('maior', 'menor')),  -- maior = subir é bom
  ordem            smallint not null default 0
);
create index if not exists ix_modelos_indicador_cargo on gestorgov.modelos_indicador (modelo_cargo_id, ordem);
comment on table gestorgov.modelos_indicador is
  'Catálogo de indicadores por cargo. A meta é do município (indicadores_cargo.meta), a partir do Plano Municipal de Saúde.';

insert into gestorgov.modelos_cargo
  (id, nome, nivel, tipo_setor_id, superior_id, atribuicoes, rotinas, entregas, padrao, ordem) values
  ('secretario', 'Secretário(a) de Saúde', 'direcao', 'gabinete', null,
   'Gestor do SUS municipal; ordena despesas; preside o Fundo Municipal de Saúde; representa a secretaria no Conselho, na CIR e na CIB.',
   '[{"frequencia": "diaria", "texto": "Painel executivo"}, {"frequencia": "semanal", "texto": "Reunião de superintendentes"}, {"frequencia": "mensal", "texto": "Prestação ao Conselho Municipal de Saúde"}, {"frequencia": "quadrimestral", "texto": "Audiência pública"}]', '[{"frequencia": "mensal", "texto": "Prestação de contas ao Conselho"}, {"frequencia": "quadrimestral", "texto": "Apresentação na audiência pública"}]', true, 1),
  ('secretario_adjunto', 'Secretário(a) Adjunto(a)', 'direcao', 'gabinete', 'secretario',
   'Substitui o Secretário; coordena as superintendências no dia a dia; cobra prazos e entregas.',
   '[{"frequencia": "diaria", "texto": "Acompanhamento de pendências"}, {"frequencia": "semanal", "texto": "Pauta da reunião de superintendentes"}]', '[{"frequencia": "semanal", "texto": "Pauta da reunião de superintendentes"}]', true, 2),
  ('chefe_gabinete', 'Chefe de Gabinete / Assessoria Técnica', 'direcao', 'gabinete', 'secretario',
   'Agenda e despacho do Secretário; ofícios e processos; ponte com Câmara, Ministério Público e Estado; preparo de pareceres.',
   '[{"frequencia": "diaria", "texto": "Triagem de documentos"}, {"frequencia": "semanal", "texto": "Fila de ofícios e requerimentos"}]', '[{"frequencia": "diaria", "texto": "Respostas a ofícios"}, {"frequencia": "semanal", "texto": "Pareceres para o Secretário"}]', true, 3),
  ('sup_aps', 'Superintendente de Atenção Primária (APS)', 'superintendencia', 'atencao_primaria', 'secretario',
   'Coordena UBS e equipes de Saúde da Família, eMulti e ACS; gestão de desempenho das equipes; cobertura territorial; ações de promoção e prevenção.',
   '[{"frequencia": "diaria", "texto": "Produção por unidade"}, {"frequencia": "semanal", "texto": "Ranking de equipes"}, {"frequencia": "mensal", "texto": "Reunião de desempenho com gerentes de UBS"}]', '[{"frequencia": "mensal", "texto": "Relatório de desempenho das equipes"}]', true, 4),
  ('sup_especializada', 'Superintendente de Atenção Especializada', 'superintendencia', 'atencao_especializada', 'secretario',
   'Ambulatórios, policlínica, CEO, hospital municipal e SADT; contratos com prestadores; fila de especialidades.',
   '[{"frequencia": "diaria", "texto": "Censo de leitos e agenda"}, {"frequencia": "semanal", "texto": "Fila por especialidade"}, {"frequencia": "mensal", "texto": "Produção e faturamento"}]', '[{"frequencia": "mensal", "texto": "Relatório de produção SIA/SIH"}]', true, 5),
  ('sup_urgencia', 'Superintendente de Urgência e Emergência', 'superintendencia', 'urgencia', 'secretario',
   'UPA, SAMU, pronto-socorro e transporte de urgência; classificação de risco; integração com a regulação.',
   '[{"frequencia": "diaria", "texto": "Boletim de plantões e fluxo"}, {"frequencia": "semanal", "texto": "Ocorrências críticas"}, {"frequencia": "mensal", "texto": "Protocolos (AVC, IAM, sepse, trauma)"}]', '[{"frequencia": "diaria", "texto": "Boletim de plantões"}]', true, 6),
  ('sup_vigilancia', 'Superintendente de Vigilância em Saúde', 'superintendencia', 'vigilancia', 'secretario',
   'Coordena as cinco vigilâncias; resposta a surtos; notificações compulsórias; metas pactuadas com o Estado.',
   '[{"frequencia": "diaria", "texto": "Monitoramento de notificações"}, {"frequencia": "semanal", "texto": "Boletim epidemiológico"}, {"frequencia": "mensal", "texto": "Relatório ao Estado"}]', '[{"frequencia": "semanal", "texto": "Boletim epidemiológico"}, {"frequencia": "mensal", "texto": "Relatório ao Estado"}]', true, 7),
  ('vig_epidemiologica', 'Vigilância Epidemiológica', 'coordenacao', 'vigilancia', 'sup_vigilancia',
   'Doenças de notificação, óbitos infantis, maternos e por causa mal definida; SIM e SINASC.',
   '[{"frequencia": "diaria", "texto": "Fila de notificações"}, {"frequencia": "semanal", "texto": "Boletim"}]', '[{"frequencia": "semanal", "texto": "Boletim de agravos"}]', true, 8),
  ('vig_sanitaria', 'Vigilância Sanitária', 'coordenacao', 'vigilancia', 'sup_vigilancia',
   'Licenciamento e inspeção de estabelecimentos; denúncias; alvarás.',
   '[{"frequencia": "diaria", "texto": "Agenda de fiscais"}, {"frequencia": "mensal", "texto": "Relatório de inspeções"}]', '[{"frequencia": "mensal", "texto": "Relatório de inspeções"}]', true, 9),
  ('vig_ambiental', 'Vigilância Ambiental e Zoonoses (CCZ)', 'coordenacao', 'vigilancia', 'sup_vigilancia',
   'Controle de vetores (dengue, chikungunya, zika); vacinação antirrábica; qualidade da água.',
   '[{"frequencia": "diaria", "texto": "Roteiros dos agentes de endemias"}, {"frequencia": "semanal", "texto": "Mapa de focos"}]', '[{"frequencia": "semanal", "texto": "Mapa de focos"}]', true, 10),
  ('saude_trabalhador', 'Saúde do Trabalhador', 'coordenacao', 'vigilancia', 'sup_vigilancia',
   'Notificação de acidentes e doenças do trabalho; CEREST de referência; apoio à NR-1.',
   '[{"frequencia": "mensal", "texto": "Relatório de agravos"}]', '[{"frequencia": "mensal", "texto": "Relatório de agravos do trabalho"}]', true, 11),
  ('imunizacao', 'Imunização', 'coordenacao', 'vigilancia', 'sup_vigilancia',
   'Salas de vacina; cadeia de frio; campanhas; busca ativa de faltosos.',
   '[{"frequencia": "diaria", "texto": "Registros no sistema"}, {"frequencia": "semanal", "texto": "Busca ativa de faltosos"}, {"frequencia": "anual", "texto": "Campanhas"}]', '[{"frequencia": "semanal", "texto": "Lista de busca ativa"}]', true, 12),
  ('sup_farmacia', 'Superintendente de Assistência Farmacêutica', 'superintendencia', 'farmacia', 'secretario',
   'Seleção, programação, compra e dispensação de medicamentos (REMUME); CAF; medicamentos especiais; farmácias das unidades.',
   '[{"frequencia": "diaria", "texto": "Estoque crítico"}, {"frequencia": "semanal", "texto": "Pedidos às unidades"}, {"frequencia": "mensal", "texto": "Inventário e consumo"}]', '[{"frequencia": "semanal", "texto": "Pedido de reposição"}, {"frequencia": "mensal", "texto": "Relatório de inventário e consumo"}]', true, 13),
  ('sup_regulacao', 'Superintendente de Regulação, Controle e Avaliação', 'superintendencia', 'regulacao', 'secretario',
   'Central de regulação de consultas, exames e internações; TFD; faturamento SUS; auditoria; contratualização.',
   '[{"frequencia": "diaria", "texto": "Fila de regulação"}, {"frequencia": "semanal", "texto": "Pendências de TFD"}, {"frequencia": "mensal", "texto": "Faturamento e auditoria"}]', '[{"frequencia": "mensal", "texto": "Relatório de faturamento e auditoria"}]', true, 14),
  ('sup_planejamento', 'Superintendente de Planejamento e Gestão', 'superintendencia', 'gabinete', 'secretario',
   'PMS, PAS e RAG; indicadores (Previne Brasil, SIAPS); convênios e emendas; projetos e captação de recursos.',
   '[{"frequencia": "mensal", "texto": "Painel de indicadores"}, {"frequencia": "quadrimestral", "texto": "RDQA"}, {"frequencia": "anual", "texto": "PAS e RAG"}]', '[{"frequencia": "quadrimestral", "texto": "RDQA"}, {"frequencia": "anual", "texto": "Programação Anual de Saúde (PAS)"}, {"frequencia": "anual", "texto": "Relatório Anual de Gestão (RAG)"}]', true, 15),
  ('sup_administrativo', 'Superintendente Administrativo e Financeiro', 'superintendencia', 'financeiro', 'secretario',
   'Compras, licitações e contratos; orçamento; Fundo Municipal de Saúde; almoxarifado e patrimônio.',
   '[{"frequencia": "diaria", "texto": "Empenhos e pagamentos"}, {"frequencia": "semanal", "texto": "Processos de compra"}, {"frequencia": "mensal", "texto": "Conciliação financeira"}]', '[{"frequencia": "mensal", "texto": "Conciliação financeira do FMS"}]', true, 16),
  ('sup_pessoas', 'Superintendente de Gestão de Pessoas', 'superintendencia', 'rh', 'secretario',
   'RH, escalas, férias, folha, educação permanente (NEP); dimensionamento de equipes.',
   '[{"frequencia": "diaria", "texto": "Cobertura de escalas"}, {"frequencia": "mensal", "texto": "Folha e frequência"}, {"frequencia": "trimestral", "texto": "Plano de educação permanente"}]', '[{"frequencia": "mensal", "texto": "Folha e frequência"}, {"frequencia": "trimestral", "texto": "Plano de educação permanente"}]', true, 17),
  ('sup_ti', 'Superintendente de TI e Informação em Saúde', 'superintendencia', 'ti', 'secretario',
   'Prontuário eletrônico, e-SUS, CNES; infraestrutura; segurança e LGPD; integração entre sistemas; base de dados da secretaria.',
   '[{"frequencia": "diaria", "texto": "Monitoramento de sistemas e backup"}, {"frequencia": "semanal", "texto": "Chamados"}, {"frequencia": "mensal", "texto": "Auditoria de acessos"}]', '[{"frequencia": "mensal", "texto": "Relatório de auditoria de acessos"}]', true, 18),
  ('coord_mulher', 'Saúde da Mulher', 'coordenacao', 'atencao_primaria', 'sup_aps',
   'Pré-natal, planejamento familiar, rastreamento de câncer de colo e mama, violência contra a mulher.',
   '[]', '[]', true, 19),
  ('coord_crianca', 'Saúde da Criança e do Adolescente', 'coordenacao', 'atencao_primaria', 'sup_aps',
   'Puericultura, crescimento e desenvolvimento, saúde escolar, teste do pezinho.',
   '[]', '[]', true, 20),
  ('coord_idoso', 'Saúde do Idoso', 'coordenacao', 'atencao_primaria', 'sup_aps',
   'Cuidado longitudinal, fragilidade, quedas, polifarmácia.',
   '[]', '[]', true, 21),
  ('coord_homem', 'Saúde do Homem', 'coordenacao', 'atencao_primaria', 'sup_aps',
   'Rastreamentos, pré-natal do parceiro, prevenção de violência e acidentes.',
   '[]', '[]', true, 22),
  ('coord_has_dm', 'Hipertensão e Diabetes', 'coordenacao', 'atencao_primaria', 'sup_aps',
   'Linha de cuidado de hipertensão e diabetes.',
   '[]', '[]', true, 23),
  ('coord_bucal', 'Saúde Bucal', 'coordenacao', 'atencao_primaria', 'sup_aps',
   'Equipes de saúde bucal, CEO, primeira consulta programática.',
   '[]', '[]', true, 24),
  ('coord_mental', 'Saúde Mental (RAPS e CAPS)', 'coordenacao', 'saude_mental', 'sup_especializada',
   'CAPS, matriciamento na APS, acolhimento de crise, uso de álcool e drogas.',
   '[]', '[]', true, 25),
  ('coord_deficiencia', 'Saúde da Pessoa com Deficiência', 'coordenacao', 'atencao_especializada', 'sup_especializada',
   'Reabilitação, concessão de órteses e próteses, acessibilidade.',
   '[]', '[]', true, 26),
  ('coord_tb_hans', 'Tuberculose e Hanseníase', 'coordenacao', 'vigilancia', 'sup_vigilancia',
   'Busca de sintomáticos, tratamento supervisionado, contatos.',
   '[]', '[]', true, 27),
  ('coord_ist_hiv', 'IST e HIV', 'coordenacao', 'vigilancia', 'sup_vigilancia',
   'Testagem, tratamento, prevenção combinada.',
   '[]', '[]', true, 28),
  ('coord_enfermagem', 'Coordenação de Enfermagem', 'coordenacao', 'atencao_primaria', 'sup_aps',
   'Escalas, protocolos e supervisão da enfermagem.',
   '[]', '[]', true, 29),
  ('coord_acs_ace', 'Coordenação de ACS e ACE', 'coordenacao', 'atencao_primaria', 'sup_aps',
   'Cadastro, visitas, territorialização (responde também à Vigilância).',
   '[]', '[]', true, 30),
  ('coord_transporte', 'Transporte Sanitário', 'coordenacao', 'transporte', 'sup_administrativo',
   'Frota, ambulâncias, rotas de pacientes.',
   '[]', '[]', true, 31),
  ('gerente_unidade', 'Gerência de unidade (UBS, UPA, hospital)', 'unidade', 'atencao_primaria', 'sup_aps',
   'Gestão da unidade: equipe, insumos, produção e qualidade. Responde à superintendência da área da unidade.',
   '[]', '[]', true, 32),
  ('conselho', 'Conselho Municipal de Saúde', 'controle', 'gabinete', null,
   'Controle social; aprova PMS, PAS, RAG e prestações de contas. Independente: a secretaria presta contas a ele.',
   '[]', '[]', true, 33),
  ('controle_interno', 'Controle Interno e Auditoria', 'controle', 'gabinete', 'secretario',
   'Auditoria de processos, contratos e despesas; recomendações. Responde também à Controladoria do município.',
   '[]', '[]', true, 34),
  ('juridico', 'Assessoria Jurídica', 'controle', 'gabinete', 'secretario',
   'Pareceres, contratos, processos administrativos e judicializações.',
   '[]', '[]', true, 35),
  ('comunicacao', 'Comunicação', 'controle', 'gabinete', 'secretario',
   'Campanhas, avisos à população, imprensa, redes sociais.',
   '[]', '[]', true, 36),
  ('ouvidoria', 'Ouvidoria do SUS', 'controle', 'ouvidoria', 'secretario',
   'Reclamações, sugestões e elogios; resposta ao cidadão.',
   '[]', '[]', true, 37),
  ('comissoes', 'Comissões (CIB/CIR, Farmácia e Terapêutica, Óbitos, CCIH, NEP)', 'controle', 'gabinete', 'secretario',
   'Decisões técnicas e pactuações específicas.',
   '[]', '[]', true, 38)
on conflict (id) do update set
  nome = excluded.nome, nivel = excluded.nivel, tipo_setor_id = excluded.tipo_setor_id,
  superior_id = excluded.superior_id, atribuicoes = excluded.atribuicoes, rotinas = excluded.rotinas,
  entregas = excluded.entregas, padrao = excluded.padrao, ordem = excluded.ordem;

insert into gestorgov.modelos_indicador
  (id, modelo_cargo_id, nome, fonte, periodicidade, unidade, sentido, ordem) values
  ('secretario__execucao_orcamentaria_do_fms', 'secretario', 'Execução orçamentária do FMS', 'SIOPS', 'mensal', '%', 'maior', 1),
  ('secretario__aplicacao_do_minimo_constitucional_de_15', 'secretario', 'Aplicação do mínimo constitucional de 15% em saúde', 'SIOPS', 'quadrimestral', '%', 'maior', 2),
  ('secretario__metas_do_plano_municipal_de_saude_cumpri', 'secretario', 'Metas do Plano Municipal de Saúde cumpridas', 'interno', 'quadrimestral', '%', 'maior', 3),
  ('secretario__resultado_geral_da_aps', 'secretario', 'Resultado geral da APS', 'SIAPS', 'quadrimestral', 'nota', 'maior', 4),
  ('secretario_adjunto__entregas_no_prazo_por_superintendencia', 'secretario_adjunto', 'Entregas no prazo por superintendência', 'interno', 'semanal', '%', 'maior', 5),
  ('secretario_adjunto__pendencias_abertas_ha_mais_de_7_dias', 'secretario_adjunto', 'Pendências abertas há mais de 7 dias', 'interno', 'diaria', 'número', 'menor', 6),
  ('secretario_adjunto__encaminhamentos_de_reuniao_cumpridos', 'secretario_adjunto', 'Encaminhamentos de reunião cumpridos', 'interno', 'semanal', '%', 'maior', 7),
  ('chefe_gabinete__prazo_medio_de_resposta_a_oficios', 'chefe_gabinete', 'Prazo médio de resposta a ofícios', 'interno', 'semanal', 'dias', 'menor', 8),
  ('chefe_gabinete__processos_parados', 'chefe_gabinete', 'Processos parados', 'interno', 'diaria', 'número', 'menor', 9),
  ('chefe_gabinete__demandas_de_orgaos_de_controle_em_aberto', 'chefe_gabinete', 'Demandas de órgãos de controle em aberto', 'interno', 'semanal', 'número', 'menor', 10),
  ('sup_aps__cobertura_de_aps_e_cadastro', 'sup_aps', 'Cobertura de APS e cadastro', 'e-SUS APS', 'mensal', '%', 'maior', 11),
  ('sup_aps__indicadores_do_siaps_pre_natal_citologia', 'sup_aps', 'Indicadores do SIAPS (pré-natal, citologia, vacinação infantil, HAS e DM)', 'SIAPS', 'quadrimestral', 'nota', 'maior', 12),
  ('sup_aps__consultas_por_equipe_e_por_profissional', 'sup_aps', 'Consultas por equipe e por profissional', 'e-SUS APS', 'semanal', 'número', 'maior', 13),
  ('sup_aps__absenteismo_nas_consultas', 'sup_aps', 'Absenteísmo nas consultas', 'e-SUS APS', 'semanal', '%', 'menor', 14),
  ('sup_aps__visitas_domiciliares_dos_acs', 'sup_aps', 'Visitas domiciliares dos ACS', 'e-SUS APS', 'mensal', 'número', 'maior', 15),
  ('sup_especializada__tempo_de_espera_por_especialidade', 'sup_especializada', 'Tempo de espera por especialidade', 'interno', 'semanal', 'dias', 'menor', 16),
  ('sup_especializada__absenteismo_em_consultas_e_exames', 'sup_especializada', 'Absenteísmo em consultas e exames', 'SIA/SIH', 'semanal', '%', 'menor', 17),
  ('sup_especializada__ocupacao_de_leitos', 'sup_especializada', 'Ocupação de leitos', 'SIA/SIH', 'diaria', '%', 'maior', 18),
  ('sup_especializada__tempo_medio_de_permanencia', 'sup_especializada', 'Tempo médio de permanência', 'SIA/SIH', 'mensal', 'dias', 'menor', 19),
  ('sup_especializada__producao_sia_e_sih', 'sup_especializada', 'Produção SIA e SIH', 'SIA/SIH', 'mensal', 'número', 'maior', 20),
  ('sup_urgencia__tempo_porta_medico_por_classificacao_de_', 'sup_urgencia', 'Tempo porta-médico por classificação de risco', 'interno', 'diaria', 'minutos', 'menor', 21),
  ('sup_urgencia__tempo_resposta_do_samu', 'sup_urgencia', 'Tempo-resposta do SAMU', 'interno', 'diaria', 'minutos', 'menor', 22),
  ('sup_urgencia__tempo_de_espera_por_vaga_regulada', 'sup_urgencia', 'Tempo de espera por vaga regulada', 'interno', 'diaria', 'horas', 'menor', 23),
  ('sup_urgencia__retorno_em_72_horas', 'sup_urgencia', 'Retorno em 72 horas', 'interno', 'semanal', '%', 'menor', 24),
  ('sup_vigilancia__notificacoes_encerradas_em_tempo_oportun', 'sup_vigilancia', 'Notificações encerradas em tempo oportuno', 'SINAN', 'semanal', '%', 'maior', 25),
  ('sup_vigilancia__obitos_investigados', 'sup_vigilancia', 'Óbitos investigados', 'SIM', 'mensal', '%', 'maior', 26),
  ('sup_vigilancia__alertas_epidemiologicos_emitidos', 'sup_vigilancia', 'Alertas epidemiológicos emitidos', 'SINAN', 'semanal', 'número', 'menor', 27),
  ('vig_epidemiologica__casos_por_agravo', 'vig_epidemiologica', 'Casos por agravo', 'SINAN', 'semanal', 'número', 'menor', 28),
  ('vig_epidemiologica__proporcao_de_obitos_investigados', 'vig_epidemiologica', 'Proporção de óbitos investigados', 'SIM', 'mensal', '%', 'maior', 29),
  ('vig_epidemiologica__encerramento_oportuno_das_notificacoes', 'vig_epidemiologica', 'Encerramento oportuno das notificações', 'SINAN', 'semanal', '%', 'maior', 30),
  ('vig_sanitaria__inspecoes_realizadas_sobre_as_programada', 'vig_sanitaria', 'Inspeções realizadas sobre as programadas', 'interno', 'mensal', '%', 'maior', 31),
  ('vig_sanitaria__denuncias_respondidas_no_prazo', 'vig_sanitaria', 'Denúncias respondidas no prazo', 'interno', 'mensal', '%', 'maior', 32),
  ('vig_sanitaria__alvaras_emitidos', 'vig_sanitaria', 'Alvarás emitidos', 'interno', 'mensal', 'número', 'maior', 33),
  ('vig_ambiental__indice_de_infestacao_predial', 'vig_ambiental', 'Índice de infestação predial', 'interno', 'semanal', '%', 'menor', 34),
  ('vig_ambiental__ciclos_de_visita_casa_a_casa', 'vig_ambiental', 'Ciclos de visita casa a casa', 'interno', 'mensal', 'número', 'maior', 35),
  ('vig_ambiental__cobertura_da_vacinacao_antirrabica', 'vig_ambiental', 'Cobertura da vacinação antirrábica', 'interno', 'anual', '%', 'maior', 36),
  ('saude_trabalhador__acidentes_de_trabalho_notificados', 'saude_trabalhador', 'Acidentes de trabalho notificados', 'SINAN', 'mensal', 'número', 'maior', 37),
  ('saude_trabalhador__acoes_em_empresas_do_territorio', 'saude_trabalhador', 'Ações em empresas do território', 'interno', 'mensal', 'número', 'maior', 38),
  ('imunizacao__cobertura_vacinal_por_imunobiologico', 'imunizacao', 'Cobertura vacinal por imunobiológico', 'e-SUS APS', 'mensal', '%', 'maior', 39),
  ('imunizacao__taxa_de_abandono_vacinal', 'imunizacao', 'Taxa de abandono vacinal', 'e-SUS APS', 'mensal', '%', 'menor', 40),
  ('imunizacao__perdas_de_vacina', 'imunizacao', 'Perdas de vacina', 'interno', 'mensal', '%', 'menor', 41),
  ('imunizacao__salas_de_vacina_com_registro_em_dia', 'imunizacao', 'Salas de vacina com registro em dia', 'e-SUS APS', 'semanal', '%', 'maior', 42),
  ('sup_farmacia__ruptura_de_estoque_dos_itens_da_remume', 'sup_farmacia', 'Ruptura de estoque dos itens da REMUME', 'interno', 'diaria', '%', 'menor', 43),
  ('sup_farmacia__itens_com_validade_a_vencer_em_90_dias', 'sup_farmacia', 'Itens com validade a vencer em 90 dias', 'interno', 'semanal', 'número', 'menor', 44),
  ('sup_farmacia__tempo_de_espera_na_dispensacao', 'sup_farmacia', 'Tempo de espera na dispensação', 'interno', 'semanal', 'minutos', 'menor', 45),
  ('sup_farmacia__perdas_por_vencimento', 'sup_farmacia', 'Perdas por vencimento', 'interno', 'mensal', 'R$', 'menor', 46),
  ('sup_farmacia__consumo_medio_mensal', 'sup_farmacia', 'Consumo médio mensal', 'interno', 'mensal', 'número', 'maior', 47),
  ('sup_regulacao__fila_de_espera_e_tempo_medio_por_procedi', 'sup_regulacao', 'Fila de espera e tempo médio por procedimento', 'interno', 'diaria', 'dias', 'menor', 48),
  ('sup_regulacao__solicitacoes_devolvidas', 'sup_regulacao', 'Solicitações devolvidas', 'interno', 'semanal', 'número', 'menor', 49),
  ('sup_regulacao__glosas_de_faturamento', 'sup_regulacao', 'Glosas de faturamento', 'SIA/SIH', 'mensal', 'R$', 'menor', 50),
  ('sup_regulacao__producao_contratada_sobre_a_realizada', 'sup_regulacao', 'Produção contratada sobre a realizada', 'SIA/SIH', 'mensal', '%', 'maior', 51),
  ('sup_planejamento__metas_da_pas_cumpridas', 'sup_planejamento', 'Metas da PAS cumpridas', 'interno', 'quadrimestral', '%', 'maior', 52),
  ('sup_planejamento__indicadores_pactuados', 'sup_planejamento', 'Indicadores pactuados', 'SIAPS', 'quadrimestral', '%', 'maior', 53),
  ('sup_planejamento__prestacoes_de_contas_de_emendas_e_conven', 'sup_planejamento', 'Prestações de contas de emendas e convênios pendentes', 'interno', 'mensal', 'número', 'menor', 54),
  ('sup_administrativo__execucao_orcamentaria_por_fonte', 'sup_administrativo', 'Execução orçamentária por fonte', 'SIOPS', 'mensal', '%', 'maior', 55),
  ('sup_administrativo__contratos_a_vencer_em_90_dias', 'sup_administrativo', 'Contratos a vencer em 90 dias', 'interno', 'semanal', 'número', 'menor', 56),
  ('sup_administrativo__prazo_medio_dos_processos_de_compra', 'sup_administrativo', 'Prazo médio dos processos de compra', 'interno', 'semanal', 'dias', 'menor', 57),
  ('sup_administrativo__saldo_do_fms', 'sup_administrativo', 'Saldo do FMS', 'interno', 'diaria', 'R$', 'maior', 58),
  ('sup_pessoas__vagas_abertas_por_unidade', 'sup_pessoas', 'Vagas abertas por unidade', 'interno', 'semanal', 'número', 'menor', 59),
  ('sup_pessoas__absenteismo_de_servidores', 'sup_pessoas', 'Absenteísmo de servidores', 'interno', 'mensal', '%', 'menor', 60),
  ('sup_pessoas__horas_extras', 'sup_pessoas', 'Horas extras', 'interno', 'mensal', 'horas', 'menor', 61),
  ('sup_pessoas__capacitacoes_realizadas', 'sup_pessoas', 'Capacitações realizadas', 'interno', 'trimestral', 'número', 'maior', 62),
  ('sup_ti__disponibilidade_dos_sistemas', 'sup_ti', 'Disponibilidade dos sistemas', 'interno', 'diaria', '%', 'maior', 63),
  ('sup_ti__unidades_com_prontuario_eletronico_em_us', 'sup_ti', 'Unidades com prontuário eletrônico em uso', 'e-SUS APS', 'mensal', '%', 'maior', 64),
  ('sup_ti__qualidade_do_cnes', 'sup_ti', 'Qualidade do CNES', 'CNES', 'mensal', '%', 'maior', 65),
  ('sup_ti__incidentes_de_seguranca', 'sup_ti', 'Incidentes de segurança', 'interno', 'mensal', 'número', 'menor', 66),
  ('sup_ti__chamados_em_aberto', 'sup_ti', 'Chamados em aberto', 'interno', 'semanal', 'número', 'menor', 67),
  ('coord_mulher__gestantes_com_6_ou_mais_consultas_e_sifi', 'coord_mulher', 'Gestantes com 6 ou mais consultas e sífilis e HIV testados', 'SIAPS', 'quadrimestral', '%', 'maior', 68),
  ('coord_mulher__citologia_e_mamografia_em_dia', 'coord_mulher', 'Citologia e mamografia em dia', 'SIAPS', 'quadrimestral', '%', 'maior', 69),
  ('coord_mulher__mortalidade_materna', 'coord_mulher', 'Mortalidade materna', 'SIM', 'anual', 'taxa', 'menor', 70),
  ('coord_crianca__consultas_de_puericultura_em_dia', 'coord_crianca', 'Consultas de puericultura em dia', 'e-SUS APS', 'mensal', '%', 'maior', 71),
  ('coord_crianca__cobertura_vacinal_infantil', 'coord_crianca', 'Cobertura vacinal infantil', 'SIAPS', 'quadrimestral', '%', 'maior', 72),
  ('coord_crianca__mortalidade_infantil', 'coord_crianca', 'Mortalidade infantil', 'SIM', 'anual', 'taxa', 'menor', 73),
  ('coord_crianca__baixo_peso_ao_nascer', 'coord_crianca', 'Baixo peso ao nascer', 'interno', 'anual', '%', 'menor', 74),
  ('coord_idoso__idosos_acompanhados', 'coord_idoso', 'Idosos acompanhados', 'e-SUS APS', 'mensal', 'número', 'maior', 75),
  ('coord_idoso__internacoes_por_condicoes_sensiveis_a_ap', 'coord_idoso', 'Internações por condições sensíveis à APS', 'SIA/SIH', 'mensal', 'número', 'menor', 76),
  ('coord_idoso__vacinacao_anual_dos_idosos', 'coord_idoso', 'Vacinação anual dos idosos', 'e-SUS APS', 'anual', '%', 'maior', 77),
  ('coord_homem__consultas_de_homens_por_equipe', 'coord_homem', 'Consultas de homens por equipe', 'e-SUS APS', 'mensal', 'número', 'maior', 78),
  ('coord_homem__pre_natal_do_parceiro_realizado', 'coord_homem', 'Pré-natal do parceiro realizado', 'e-SUS APS', 'mensal', '%', 'maior', 79),
  ('coord_has_dm__hipertensos_com_pa_aferida_no_semestre', 'coord_has_dm', 'Hipertensos com PA aferida no semestre', 'SIAPS', 'quadrimestral', '%', 'maior', 80),
  ('coord_has_dm__diabeticos_com_hemoglobina_glicada_solic', 'coord_has_dm', 'Diabéticos com hemoglobina glicada solicitada', 'SIAPS', 'quadrimestral', '%', 'maior', 81),
  ('coord_has_dm__internacoes_evitaveis', 'coord_has_dm', 'Internações evitáveis', 'SIA/SIH', 'mensal', 'número', 'menor', 82),
  ('coord_bucal__cobertura_de_saude_bucal', 'coord_bucal', 'Cobertura de saúde bucal', 'e-SUS APS', 'mensal', '%', 'maior', 83),
  ('coord_bucal__escovacao_supervisionada', 'coord_bucal', 'Escovação supervisionada', 'e-SUS APS', 'mensal', 'número', 'maior', 84),
  ('coord_bucal__tratamentos_concluidos', 'coord_bucal', 'Tratamentos concluídos', 'e-SUS APS', 'mensal', 'número', 'maior', 85),
  ('coord_bucal__exodontias_por_100_procedimentos', 'coord_bucal', 'Exodontias por 100 procedimentos', 'e-SUS APS', 'mensal', 'taxa', 'menor', 86),
  ('coord_mental__usuarios_em_acompanhamento', 'coord_mental', 'Usuários em acompanhamento', 'interno', 'mensal', 'número', 'maior', 87),
  ('coord_mental__internacoes_psiquiatricas', 'coord_mental', 'Internações psiquiátricas', 'SIA/SIH', 'mensal', 'número', 'menor', 88),
  ('coord_mental__matriciamentos_realizados', 'coord_mental', 'Matriciamentos realizados', 'e-SUS APS', 'mensal', 'número', 'maior', 89),
  ('coord_mental__tempo_de_espera_por_primeira_consulta', 'coord_mental', 'Tempo de espera por primeira consulta', 'interno', 'mensal', 'dias', 'menor', 90),
  ('coord_deficiencia__usuarios_em_reabilitacao', 'coord_deficiencia', 'Usuários em reabilitação', 'interno', 'mensal', 'número', 'maior', 91),
  ('coord_deficiencia__tempo_de_espera_por_ortese_ou_protese', 'coord_deficiencia', 'Tempo de espera por órtese ou prótese', 'interno', 'mensal', 'dias', 'menor', 92),
  ('coord_tb_hans__cura', 'coord_tb_hans', 'Cura', 'SINAN', 'quadrimestral', '%', 'maior', 93),
  ('coord_tb_hans__abandono_do_tratamento', 'coord_tb_hans', 'Abandono do tratamento', 'SINAN', 'quadrimestral', '%', 'menor', 94),
  ('coord_tb_hans__contatos_examinados', 'coord_tb_hans', 'Contatos examinados', 'SINAN', 'quadrimestral', '%', 'maior', 95),
  ('coord_ist_hiv__testagem_realizada', 'coord_ist_hiv', 'Testagem realizada', 'interno', 'mensal', 'número', 'maior', 96),
  ('coord_ist_hiv__carga_viral_suprimida', 'coord_ist_hiv', 'Carga viral suprimida', 'interno', 'quadrimestral', '%', 'maior', 97),
  ('coord_ist_hiv__sifilis_em_gestante_tratada', 'coord_ist_hiv', 'Sífilis em gestante tratada', 'SINAN', 'mensal', '%', 'maior', 98),
  ('coord_enfermagem__absenteismo_da_enfermagem', 'coord_enfermagem', 'Absenteísmo da enfermagem', 'interno', 'mensal', '%', 'menor', 99),
  ('coord_enfermagem__adesao_a_protocolos', 'coord_enfermagem', 'Adesão a protocolos', 'interno', 'mensal', '%', 'maior', 100),
  ('coord_enfermagem__vagas_de_enfermagem_em_aberto', 'coord_enfermagem', 'Vagas de enfermagem em aberto', 'interno', 'mensal', 'número', 'menor', 101),
  ('coord_acs_ace__visitas_domiciliares_por_agente', 'coord_acs_ace', 'Visitas domiciliares por agente', 'e-SUS APS', 'mensal', 'número', 'maior', 102),
  ('coord_acs_ace__familias_cadastradas', 'coord_acs_ace', 'Famílias cadastradas', 'e-SUS APS', 'mensal', 'número', 'maior', 103),
  ('coord_acs_ace__microareas_descobertas', 'coord_acs_ace', 'Microáreas descobertas', 'e-SUS APS', 'mensal', 'número', 'menor', 104),
  ('coord_transporte__viagens_realizadas', 'coord_transporte', 'Viagens realizadas', 'interno', 'semanal', 'número', 'maior', 105),
  ('coord_transporte__ocupacao_dos_veiculos', 'coord_transporte', 'Ocupação dos veículos', 'interno', 'semanal', '%', 'maior', 106),
  ('coord_transporte__manutencao_da_frota_em_dia', 'coord_transporte', 'Manutenção da frota em dia', 'interno', 'mensal', '%', 'maior', 107),
  ('gerente_unidade__producao_da_unidade', 'gerente_unidade', 'Produção da unidade', 'e-SUS APS', 'semanal', 'número', 'maior', 108),
  ('gerente_unidade__absenteismo_da_unidade', 'gerente_unidade', 'Absenteísmo da unidade', 'e-SUS APS', 'semanal', '%', 'menor', 109),
  ('gerente_unidade__ruptura_de_insumos', 'gerente_unidade', 'Ruptura de insumos', 'interno', 'semanal', 'número', 'menor', 110),
  ('gerente_unidade__satisfacao_do_usuario', 'gerente_unidade', 'Satisfação do usuário', 'interno', 'mensal', '%', 'maior', 111),
  ('conselho__reunioes_realizadas', 'conselho', 'Reuniões realizadas', 'interno', 'mensal', 'número', 'maior', 112),
  ('conselho__resolucoes_emitidas', 'conselho', 'Resoluções emitidas', 'interno', 'mensal', 'número', 'maior', 113),
  ('conselho__pareceres_pendentes', 'conselho', 'Pareceres pendentes', 'interno', 'mensal', 'número', 'menor', 114),
  ('controle_interno__recomendacoes_abertas', 'controle_interno', 'Recomendações abertas', 'interno', 'mensal', 'número', 'menor', 115),
  ('controle_interno__recomendacoes_atendidas', 'controle_interno', 'Recomendações atendidas', 'interno', 'mensal', '%', 'maior', 116),
  ('juridico__pareceres_no_prazo', 'juridico', 'Pareceres no prazo', 'interno', 'semanal', '%', 'maior', 117),
  ('juridico__acoes_judiciais_de_medicamentos_e_proced', 'juridico', 'Ações judiciais de medicamentos e procedimentos em aberto', 'interno', 'mensal', 'número', 'menor', 118),
  ('comunicacao__campanhas_no_ar', 'comunicacao', 'Campanhas no ar', 'interno', 'semanal', 'número', 'maior', 119),
  ('comunicacao__informacoes_desatualizadas_nos_canais', 'comunicacao', 'Informações desatualizadas nos canais', 'interno', 'semanal', 'número', 'menor', 120),
  ('ouvidoria__manifestacoes_abertas', 'ouvidoria', 'Manifestações abertas', 'interno', 'semanal', 'número', 'menor', 121),
  ('ouvidoria__tempo_medio_de_resposta', 'ouvidoria', 'Tempo médio de resposta', 'interno', 'semanal', 'dias', 'menor', 122),
  ('ouvidoria__reincidencia_por_unidade', 'ouvidoria', 'Reincidência por unidade', 'interno', 'mensal', 'número', 'menor', 123),
  ('comissoes__pendencias_por_comissao', 'comissoes', 'Pendências por comissão', 'interno', 'mensal', 'número', 'menor', 124),
  ('comissoes__recomendacoes_cumpridas', 'comissoes', 'Recomendações cumpridas', 'interno', 'mensal', '%', 'maior', 125)
on conflict (id) do update set
  modelo_cargo_id = excluded.modelo_cargo_id, nome = excluded.nome, fonte = excluded.fonte,
  periodicidade = excluded.periodicidade, unidade = excluded.unidade, sentido = excluded.sentido,
  ordem = excluded.ordem;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Os cargos de cada município e o acompanhamento
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists gestorgov.cargos (
  id               uuid primary key default extensions.gen_random_uuid(),
  municipio_id     uuid not null references gestorgov.municipios(id) on delete cascade,
  modelo_id        text references gestorgov.modelos_cargo(id) on delete set null,  -- vazio = criado pelo município
  nome             text not null,
  nivel            text not null
                   check (nivel in ('direcao', 'superintendencia', 'coordenacao', 'unidade', 'controle')),
  superior_id      uuid references gestorgov.cargos(id) on delete set null,
  setor_id         uuid references gestorgov.setores(id) on delete set null,
  unidade_id       uuid references gestorgov.unidades(id) on delete set null,      -- gerência de unidade
  responsavel_id   uuid references gestorgov.servidores(id) on delete set null,    -- a pessoa que responde pelo cargo
  agente_id        text,                                                          -- o agente da Fábrica do cargo
  atribuicoes      text,
  ativo            boolean not null default true,
  ordem            smallint not null default 0,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists ix_cargos_municipio on gestorgov.cargos (municipio_id);
create index if not exists ix_cargos_superior on gestorgov.cargos (superior_id);
comment on table gestorgov.cargos is 'Os cargos de cada secretaria: a hierarquia (superior_id), a sala (setor) e o agente.';

drop trigger if exists tg_cargos_atualizado on gestorgov.cargos;
create trigger tg_cargos_atualizado before update on gestorgov.cargos
  for each row execute function gestorgov.tocar_atualizado_em();

create table if not exists gestorgov.indicadores_cargo (
  id               uuid primary key default extensions.gen_random_uuid(),
  municipio_id     uuid not null references gestorgov.municipios(id) on delete cascade,
  cargo_id         uuid not null references gestorgov.cargos(id) on delete cascade,
  modelo_id        text references gestorgov.modelos_indicador(id) on delete set null,
  nome             text not null,
  fonte            text not null,
  periodicidade    text not null,
  unidade          text not null,
  sentido          text not null check (sentido in ('maior', 'menor')),
  meta             numeric,                                   -- definida pelo município
  meta_definida_por text,
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  unique (cargo_id, nome)
);
create index if not exists ix_indicadores_cargo_municipio on gestorgov.indicadores_cargo (municipio_id);

create table if not exists gestorgov.medicoes (
  id               bigint generated always as identity primary key,
  municipio_id     uuid not null references gestorgov.municipios(id) on delete cascade,
  indicador_id     uuid not null references gestorgov.indicadores_cargo(id) on delete cascade,
  referencia       date not null,                             -- o dia, semana ou mês medido
  valor            numeric not null,
  fonte            text,                                      -- de onde veio (planilha, sistema, agente)
  registrado_por   text not null,                             -- e-mail ou id do agente
  registrado_em    timestamptz not null default now(),
  unique (indicador_id, referencia)
);
create index if not exists ix_medicoes_indicador on gestorgov.medicoes (indicador_id, referencia desc);

create table if not exists gestorgov.entregas (
  id               uuid primary key default extensions.gen_random_uuid(),
  municipio_id     uuid not null references gestorgov.municipios(id) on delete cascade,
  cargo_id         uuid not null references gestorgov.cargos(id) on delete cascade,
  titulo           text not null,
  descricao        text,
  prazo            timestamptz,
  situacao         text not null default 'prevista'
                   check (situacao in ('prevista', 'em_andamento', 'aguardando_aprovacao', 'aprovada', 'devolvida', 'cancelada')),
  documento        text,                                      -- caminho no Storage ou link
  produzida_por    text,                                      -- id do agente ou e-mail
  aprovada_por     text,
  aprovada_em      timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists ix_entregas_cargo on gestorgov.entregas (cargo_id, prazo);

drop trigger if exists tg_entregas_atualizado on gestorgov.entregas;
create trigger tg_entregas_atualizado before update on gestorgov.entregas
  for each row execute function gestorgov.tocar_atualizado_em();

create table if not exists gestorgov.pendencias (
  id               uuid primary key default extensions.gen_random_uuid(),
  municipio_id     uuid not null references gestorgov.municipios(id) on delete cascade,
  cargo_id         uuid not null references gestorgov.cargos(id) on delete cascade,
  descricao        text not null,
  motivo           text,
  desde            timestamptz not null default now(),
  resolvida_em     timestamptz,
  resolvida_por    text
);
create index if not exists ix_pendencias_cargo on gestorgov.pendencias (cargo_id) where resolvida_em is null;

create table if not exists gestorgov.status_cargo (
  cargo_id         uuid primary key references gestorgov.cargos(id) on delete cascade,
  municipio_id     uuid not null references gestorgov.municipios(id) on delete cascade,
  situacao         text not null default 'aguardando'
                   check (situacao in ('em_andamento', 'aguardando', 'bloqueado', 'concluido')),
  tarefa           text,                                      -- o que está fazendo, em uma linha
  atualizado_em    timestamptz not null default now(),
  atualizado_por   text
);

create table if not exists gestorgov.alertas_cargo (
  id               uuid primary key default extensions.gen_random_uuid(),
  municipio_id     uuid not null references gestorgov.municipios(id) on delete cascade,
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
comment on table gestorgov.alertas_cargo is
  'Alertas ao superior direto: meta fora por 2 ciclos, entrega vencendo em 48 h, pendência parada há 7 dias, '
  'cargo sem atualização há 24 h úteis, evento crítico. Sobem pela hierarquia quando ninguém trata.';

-- A rotina passa a ser do cargo (o setor continua sendo a sala).
alter table gestorgov.atividades_setor add column if not exists cargo_id uuid references gestorgov.cargos(id) on delete set null;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Permissões e segurança
-- ─────────────────────────────────────────────────────────────────────────────
grant select on gestorgov.modelos_cargo, gestorgov.modelos_indicador to gestorgov_app;
grant select, insert, update, delete on
  gestorgov.membros, gestorgov.cargos, gestorgov.indicadores_cargo, gestorgov.medicoes, gestorgov.entregas,
  gestorgov.pendencias, gestorgov.status_cargo, gestorgov.alertas_cargo
  to gestorgov_app;
grant usage, select on all sequences in schema gestorgov to gestorgov_app;

do $$
declare
  t text;
begin
  foreach t in array array['membros', 'modelos_cargo', 'modelos_indicador', 'cargos', 'indicadores_cargo', 'medicoes',
                           'entregas', 'pendencias', 'status_cargo', 'alertas_cargo']
  loop
    execute format('alter table gestorgov.%I enable row level security', t);
    execute format('drop policy if exists servidor_gestorgov on gestorgov.%I', t);
    execute format('create policy servidor_gestorgov on gestorgov.%I for all to gestorgov_app using (true) with check (true)', t);
  end loop;
end $$;
