import { ChartColumnBig, FilePen, Library, MonitorPlay, ScrollText } from "lucide-react";
import { useRotulos } from "@/hooks/use-permissoes";
import { EmConstrucao, PageHeader } from "@/components/widgets/widgets";

/*
 * Os módulos novos da repaginação de 12/11/2026 (pelas telas de referência do dono): entram no menu agora, vazios.
 * Nada de números de mentira: cada tela ganha dados quando a fonte real estiver ligada e o escopo (só a saúde ou a
 * prefeitura inteira) estiver decidido.
 */

function Pagina({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5 px-4 pb-8 sm:px-8">{children}</div>;
}

export function Telao() {
  const r = useRotulos();
  return (
    <Pagina>
      <PageHeader title="Telão" icon={MonitorPlay} description="Sala de situação: o que está acontecendo agora, para a tela grande da sala." semAtualizar />
      <EmConstrucao
        icone={MonitorPlay}
        titulo="Sala de situação"
        fontes={`os agentes, as aprovações e as ${r.unidades}`}
        itens={[
          "Cartões com os indicadores do dia e a comparação com o período anterior",
          `Mapa das demandas por bairro e por ${r.unidade}`,
          "Os acontecimentos ao vivo: o que cada agente fez e o que espera aprovação",
          "Prazos (SLA) vencendo, por setor",
        ]}
      >
        <p>
          A visão para ficar aberta numa televisão: atualiza sozinha e destaca o que precisa de atenção. A Central ao vivo
          com o prédio da {r.organizacao_curta} continua no menu e abre em outra aba.
        </p>
      </EmConstrucao>
    </Pagina>
  );
}

export function Editais() {
  return (
    <Pagina>
      <PageHeader title="Editais" icon={Library} description="Modelos de editais e documentos da Lei 14.133, preenchidos pelo agente." semAtualizar />
      <EmConstrucao
        icone={Library}
        titulo="Biblioteca de modelos"
        fontes="os modelos aprovados pela Procuradoria do município"
        itens={[
          "Modelos de edital, termo de referência, ETP e contrato, por modalidade",
          "O agente de Compras e Licitações preenche o modelo com os dados do processo",
          "A revisão da Procuradoria antes de o modelo valer",
          "O histórico de versões de cada modelo",
        ]}
      >
        <p>
          Os modelos da secretaria num lugar só. O agente propõe o documento a partir do modelo; uma pessoa revisa e aprova,
          como em todo trabalho dos agentes.
        </p>
      </EmConstrucao>
    </Pagina>
  );
}

export function Producao() {
  return (
    <Pagina>
      <PageHeader title="Produção" icon={FilePen} description="O processo administrativo em fases, do pedido à publicação." semAtualizar />
      <EmConstrucao
        icone={FilePen}
        titulo="Produção de documentos"
        fontes="os processos e as atividades de cada setor"
        itens={[
          "As fases do processo: DFD, ETP, pesquisa de preços, termo de referência, edital, parecer e publicação no PNCP",
          "O editor do documento no centro e os agentes ao lado (quem redige, quem confere, quem dá o parecer)",
          "A conformidade do documento com a Lei 14.133, item por item",
          "Cada fase aprovada por uma pessoa antes da seguinte",
        ]}
      >
        <p>
          Onde o termo de referência e os demais documentos são escritos com os agentes. O agente nunca aprova o próprio
          trabalho: cada fase passa pelo responsável do setor.
        </p>
      </EmConstrucao>
    </Pagina>
  );
}

export function Analises() {
  return (
    <Pagina>
      <PageHeader title="Análises" icon={ChartColumnBig} description="Execução orçamentária e indicadores, com detalhamento em níveis." semAtualizar />
      <EmConstrucao
        icone={ChartColumnBig}
        titulo="Execução orçamentária"
        fontes="SIOPS e as planilhas e exportações da prefeitura"
        itens={[
          "Dotação, empenhado, liquidado e pago, com a comparação com o ano anterior",
          "Detalhamento em níveis: subfunção, natureza da despesa e empenhos",
          "Participação de cada setor no gasto, em barras",
          "Tendência mês a mês e a projeção do ano",
        ]}
      >
        <p>As contas da saúde em números, do total até o empenho, para o secretário e o setor financeiro.</p>
      </EmConstrucao>
    </Pagina>
  );
}

export function Auditoria() {
  return (
    <Pagina>
      <PageHeader title="Auditoria" icon={ScrollText} description="Quem fez o quê e quando, com o antes e o depois." semAtualizar />
      <EmConstrucao
        icone={ScrollText}
        titulo="Trilha de auditoria"
        fontes="a auditoria que o sistema já grava a cada ação"
        itens={[
          "Cada ação de pessoa ou de agente, com data, autor e quem aprovou",
          "O antes e o depois de cada mudança",
          "Filtros por setor, por pessoa e por agente",
          "As chamadas às integrações externas",
        ]}
      >
        <p>
          O sistema já registra toda ação de pessoa e de agente. Esta tela vai mostrar esse registro; até lá, as chamadas
          às integrações aparecem em Integrações.
        </p>
      </EmConstrucao>
    </Pagina>
  );
}
