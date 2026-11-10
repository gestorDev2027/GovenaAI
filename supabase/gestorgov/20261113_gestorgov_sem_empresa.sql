-- =============================================================================
-- GestorGov — tira o segmento Empresa do banco (13/11/2026)
-- O GestorGov é focado no setor público: nesta versão, só Secretarias Municipais de Saúde. A estrutura de
-- segmentos (tabela segmentos, segmento_id nos catálogos, organizacoes.dados_segmento) fica para o futuro.
--
-- Rode no SQL Editor de um banco que já rodou 20261111_gestorgov_3_empresa.sql. Pode rodar de novo: o que já
-- saiu não faz nada. Se houver organização do segmento Empresa (ou área/unidade usando um tipo da empresa),
-- nada é apagado e o script para com a explicação.
-- =============================================================================

do $$
declare
  n_org integer;
  n_area integer;
  n_unid integer;
begin
  select count(*) into n_org from gestorgov.organizacoes where segmento_id = 'empresa';
  if n_org > 0 then
    raise exception 'Há % organização(ões) do segmento Empresa em gestorgov.organizacoes. Tire-as (ou mude o segmento) antes de rodar este script; nada foi apagado.', n_org;
  end if;

  select count(*) into n_area from gestorgov.areas a
    join gestorgov.tipos_area t on t.id = a.tipo_id
   where t.segmento_id = 'empresa';
  select count(*) into n_unid from gestorgov.unidades u
    join gestorgov.tipos_unidade t on t.id = u.tipo_id
   where t.segmento_id = 'empresa';
  if n_area > 0 or n_unid > 0 then
    raise exception 'Há % área(s) e % unidade(s) usando tipos do segmento Empresa. Ajuste-as antes de rodar este script; nada foi apagado.', n_area, n_unid;
  end if;

  -- Na ordem das chaves estrangeiras: indicadores → cargos → atividades → tipos de área e de unidade → segmento.
  delete from gestorgov.modelos_indicador
   where modelo_cargo_id in (select id from gestorgov.modelos_cargo where segmento_id = 'empresa' or id like 'emp\_%');
  delete from gestorgov.modelos_cargo where segmento_id = 'empresa' or id like 'emp\_%';
  delete from gestorgov.modelos_atividade
   where tipo_area_id in (select id from gestorgov.tipos_area where segmento_id = 'empresa' or id like 'emp\_%');
  delete from gestorgov.tipos_area where segmento_id = 'empresa' or id like 'emp\_%';
  delete from gestorgov.tipos_unidade where segmento_id = 'empresa' or id like 'emp\_%';
  delete from gestorgov.segmentos where id = 'empresa';

  raise notice 'Segmento Empresa retirado do catálogo.';
end
$$;
