import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Building, Building2, Loader2, MapPin, Maximize2, MessagesSquare, Minus, Plus } from "lucide-react";
import { api, type RespostaPanorama } from "@/lib/api";
import { useAcesso, useRotulos } from "@/hooks/use-permissoes";
import { useAgentes } from "@/hooks/use-agentes";
import { useCentralAoVivo } from "@/hooks/use-central-ao-vivo";
import { cn } from "@/lib/utils";
import { SimboloGestorGov } from "@/components/layout/logo";
import { Slideover } from "@/components/comando/slideover";
import { FichaUnidade, type TipoUnidadeSaude, type UnidadeSaude } from "@/components/unidades/ficha-unidade";
import type { ApiCamera } from "@/components/central/escritorio";
import type { SelecaoPredio, AreaNoPredio } from "@/components/central/predio-secretaria";

/*
 * A unidade em 3D (Three.js), como o prédio virtual da organização: o prédio da unidade com as salas que aquele tipo
 * de unidade tem (recepção no centro; consultórios, sala de vacina, farmácia...) e o agente da unidade na sala da
 * gerência. Abre pela ficha da unidade, em outra aba (/painel/unidade/<id>); o seletor do topo troca de unidade.
 * As salas são o modelo do tipo; o que cada unidade tem de verdade (equipe, estoque, produção) entra na etapa 4.
 */

const Predio = lazy(() => import("@/components/central/predio-secretaria"));

type Sala = { id: string; nome: string; detalhe: string };

const GERENCIA: Sala = { id: "gerencia", nome: "Gerência", detalhe: "" };
// As salas de cada tipo de unidade (sem a recepção, que é o centro do prédio).
const SALAS_DO_TIPO: Record<string, Sala[]> = {
  ubs: [
    { id: "consultorio-medico", nome: "Consultório médico", detalhe: "Consultas e acompanhamento" },
    { id: "consultorio-enfermagem", nome: "Consultório de enfermagem", detalhe: "Pré-natal, preventivo, puericultura" },
    { id: "vacina", nome: "Sala de vacina", detalhe: "Imunização e cartão de vacina" },
    { id: "curativos", nome: "Sala de curativos", detalhe: "Curativos e procedimentos" },
    { id: "farmacia", nome: "Farmácia", detalhe: "Dispensação e estoque" },
  ],
  upa: [
    { id: "classificacao", nome: "Classificação de risco", detalhe: "Acolhimento com classificação" },
    { id: "consultorios", nome: "Consultórios", detalhe: "Atendimento médico" },
    { id: "sala-vermelha", nome: "Sala vermelha", detalhe: "Estabilização e emergência" },
    { id: "observacao", nome: "Observação", detalhe: "Leitos de observação" },
    { id: "farmacia", nome: "Farmácia", detalhe: "Medicamentos e insumos" },
  ],
  hospital: [
    { id: "pronto-socorro", nome: "Pronto-socorro", detalhe: "Urgência e emergência" },
    { id: "enfermaria", nome: "Enfermaria", detalhe: "Internação e leitos" },
    { id: "centro-cirurgico", nome: "Centro cirúrgico", detalhe: "Cirurgias e recuperação" },
    { id: "laboratorio", nome: "Laboratório", detalhe: "Exames" },
    { id: "farmacia", nome: "Farmácia", detalhe: "Medicamentos e insumos" },
  ],
  policlinica: [
    { id: "consultorios", nome: "Consultórios de especialidades", detalhe: "Cardiologia, ortopedia, outras" },
    { id: "exames", nome: "Exames", detalhe: "Imagem e diagnóstico" },
    { id: "agendamento", nome: "Agendamento", detalhe: "Fila e marcação" },
    { id: "farmacia", nome: "Farmácia", detalhe: "Dispensação" },
  ],
  caps: [
    { id: "acolhimento", nome: "Acolhimento", detalhe: "Escuta e primeiro atendimento" },
    { id: "oficinas", nome: "Oficinas terapêuticas", detalhe: "Atividades em grupo" },
    { id: "consultorios", nome: "Consultórios", detalhe: "Psiquiatria e psicologia" },
    { id: "farmacia", nome: "Farmácia", detalhe: "Dispensação" },
  ],
  farmacia: [
    { id: "dispensacao", nome: "Dispensação", detalhe: "Entrega de medicamentos" },
    { id: "estoque", nome: "Estoque", detalhe: "Entrada, saída e validade" },
    { id: "controlados", nome: "Controlados", detalhe: "Medicamentos sob controle especial" },
  ],
  laboratorio: [
    { id: "coleta", nome: "Coleta", detalhe: "Coleta de amostras" },
    { id: "analises", nome: "Análises", detalhe: "Processamento dos exames" },
    { id: "laudos", nome: "Laudos", detalhe: "Resultados" },
  ],
  samu: [
    { id: "regulacao", nome: "Central de regulação", detalhe: "Chamados 192" },
    { id: "base", nome: "Base das equipes", detalhe: "Equipes e viaturas" },
    { id: "materiais", nome: "Materiais", detalhe: "Insumos das viaturas" },
  ],
};
const PADRAO: Sala[] = [
  { id: "atendimento", nome: "Atendimento", detalhe: "Atendimento ao público" },
  { id: "salas", nome: "Salas de trabalho", detalhe: "Equipe da unidade" },
  { id: "estoque", nome: "Estoque", detalhe: "Insumos e materiais" },
];
const SALAS_POR_TIPO_ID: Record<string, string> = { pronto_socorro: "upa", academia: "padrao", vigilancia: "padrao", imunizacao: "ubs" };

function salasDaUnidade(tipo: string | null): Sala[] {
  const chave = SALAS_POR_TIPO_ID[tipo ?? ""] ?? tipo ?? "";
  return [GERENCIA, ...(SALAS_DO_TIPO[chave] ?? PADRAO)];
}

export function Unidade3D() {
  const { id } = useParams({ from: "/protegido/unidade/$id" });
  const navegar = useNavigate();
  const qc = useQueryClient();
  const acesso = useAcesso().data;
  const daOrganizacao = !!acesso?.organizacao;
  const panorama = useQuery({
    queryKey: ["gestao-panorama", daOrganizacao],
    queryFn: () => api<RespostaPanorama<UnidadeSaude>>(daOrganizacao ? "/organizacao/panorama" : "/gestao/panorama"),
  });
  const pan = panorama.data?.organizacao ? panorama.data : null;
  const r = useRotulos(pan?.segmento.rotulos);
  const daSaude = (pan?.organizacao.segmento_id ?? acesso?.organizacao?.segmento_id ?? "saude_publica") === "saude_publica";
  const catalogo = useQuery({
    queryKey: ["gestao-catalogo"],
    queryFn: () => api<{ tipos_unidade: TipoUnidadeSaude[] }>("/implantacao/catalogo"),
    staleTime: Infinity,
  });
  const agentes = useAgentes();
  const aoVivo = useCentralAoVivo();
  const camera = useRef<ApiCamera | null>(null);
  const [aberto, setAberto] = useState(true);
  const [selecao, setSelecao] = useState<SelecaoPredio>(null);

  const unidades = useMemo(() => pan?.unidades ?? [], [pan]);
  const unidade = unidades.find((u) => u.id === id);
  const tipos = catalogo.data?.tipos_unidade ?? [];
  const tipo = tipos.find((t) => t.id === unidade?.tipo_id);
  const nome = unidade ? unidade.nome_fantasia || unidade.nome : "";
  const agente = agentes.find((a) => a.id === unidade?.agente_id);

  useEffect(() => {
    document.title = nome ? `${nome} · GestorGov` : "Unidade · GestorGov";
  }, [nome]);
  useEffect(() => setSelecao(null), [id]);

  // As salas da unidade, no formato do prédio: a gerência tem o agente da unidade.
  const salas: AreaNoPredio[] = useMemo(
    () =>
      salasDaUnidade(unidade?.tipo_id ?? null).map((s) => ({
        id: s.id,
        nome: s.nome,
        agentes: s.id === "gerencia" && unidade?.agente_id ? [{ agente_id: unidade.agente_id }] : [],
        detalhe: s.id === "gerencia" ? (agente ? `${agente.nome} · gerente da unidade` : "Sem agente ainda") : s.detalhe,
      })),
    [unidade?.tipo_id, unidade?.agente_id, agente],
  );
  // O nome na fachada: curto (cabe no letreiro).
  const fachada = nome.length > 34 ? `${nome.slice(0, 32)}…` : nome;
  const salaEscolhida = selecao?.tipo === "area" ? salasDaUnidade(unidade?.tipo_id ?? null).find((s) => s.id === selecao.id) : undefined;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0D1B38] text-white">
      {unidade ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-white/70">
              <Loader2 className="size-5 animate-spin" />
            </div>
          }
        >
          <Predio
            key={unidade.id}
            areas={salas}
            agentes={agentes}
            eventos={aoVivo.eventos}
            inicio={aoVivo.inicio}
            selecao={selecao}
            aoSelecionar={(s) => {
              setSelecao(s);
              if (s) setAberto(true);
            }}
            margemDireita={selecao ? 464 : 0}
            api={camera}
            aberto={aberto}
            aoAbrir={() => setAberto(true)}
            nomePredio={fachada}
            totem={daSaude ? [tipo?.nome.split(" / ")[0] ?? "Unidade", "de Saúde"] : [tipo?.nome.split(" / ")[0] ?? "Unidade"]}
            centro="recepcao"
          />
        </Suspense>
      ) : (
        <div className="grid h-full place-items-center text-sm text-white/70">
          {panorama.isLoading ? <Loader2 className="size-5 animate-spin" /> : `Unidade não encontrada nesta ${r.organizacao_curta}.`}
        </div>
      )}

      <nav
        aria-label={r.Unidade}
        className="absolute top-4 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-[#0D1B38]/85 p-1.5 pl-3 shadow-[0_18px_50px_-15px_rgba(0,0,0,0.6)] backdrop-blur-md"
      >
        <Link to="/" aria-label="Voltar ao painel" className="flex items-center rounded-full pr-1 outline-none focus-visible:ring-2 focus-visible:ring-white">
          <SimboloGestorGov sobreEscuro className="size-7" />
        </Link>
        <label className="sr-only" htmlFor="escolher-unidade">
          Unidade
        </label>
        <select
          id="escolher-unidade"
          value={id}
          onChange={(e) => navegar({ to: "/unidade/$id", params: { id: e.target.value } })}
          className="h-9 max-w-[16rem] truncate rounded-full border-0 bg-white/10 px-3 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-white sm:max-w-[22rem]"
        >
          {unidades.map((u) => (
            <option key={u.id} value={u.id} className="text-[#0D1B38]">
              {u.nome_fantasia || u.nome}
            </option>
          ))}
        </select>
        <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
        <Botao rotulo={aberto ? "Fechar o prédio (vista de fora)" : "Abrir o prédio"} ativo={aberto} onClick={() => setAberto((a) => !a)}>
          {aberto ? <Building className="size-4" /> : <Building2 className="size-4" />}
        </Botao>
        <Botao rotulo="Aproximar" onClick={() => camera.current?.aproximar(0.8)}>
          <Plus className="size-4" />
        </Botao>
        <Botao rotulo="Afastar" onClick={() => camera.current?.aproximar(1.25)}>
          <Minus className="size-4" />
        </Botao>
        <Botao rotulo="Ver tudo" onClick={() => camera.current?.centralizar()}>
          <Maximize2 className="size-4" />
        </Botao>
        <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
        <Link
          to="/comando"
          className="flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-xs text-white/85 outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
        >
          <MapPin className="size-3.5" /> {r.mapa}
        </Link>
      </nav>

      {/* Recepção: a ficha da unidade (dados, conferência, fotos) */}
      {unidade && selecao?.tipo === "cco" && (
        <Slideover titulo={nome} subtitulo={tipo?.nome ?? r.Unidade} aoFechar={() => setSelecao(null)}>
          <FichaUnidade unidade={unidade} tipos={tipos} aoMudar={() => qc.invalidateQueries({ queryKey: ["gestao-panorama"] })} />
        </Slideover>
      )}
      {/* O agente da unidade */}
      {unidade && (selecao?.tipo === "agente" || selecao?.id === "gerencia") && (
        <Slideover titulo={agente?.nome ?? "Agente da unidade"} subtitulo={`Gerência · ${nome}`} aoFechar={() => setSelecao(null)}>
          <div className="space-y-4 text-sm">
            <p className="flex items-start gap-2">
              <Bot className="mt-0.5 size-4 shrink-0" />
              {daSaude
                ? "Conversa com a equipe da unidade (gerente, enfermagem, farmácia), organiza o estoque, a produção do dia e as ocorrências e leva o resumo à coordenação e à superintendência."
                : "Conversa com a equipe da unidade, organiza o estoque, a produção do dia e as ocorrências e leva o resumo à direção."}
            </p>
            {unidade.agente_id ? (
              <Link
                to="/chat"
                search={{ agente: unidade.agente_id }}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <MessagesSquare className="size-4" /> Conversar com o agente
              </Link>
            ) : (
              <p className="text-muted-foreground">Esta unidade ainda não tem agente: ele é criado na implantação, na etapa das unidades.</p>
            )}
          </div>
        </Slideover>
      )}
      {/* As outras salas */}
      {salaEscolhida && salaEscolhida.id !== "gerencia" && (
        <Slideover titulo={salaEscolhida.nome} subtitulo={nome} aoFechar={() => setSelecao(null)}>
          <div className="space-y-3 text-sm">
            <p>{salaEscolhida.detalhe}.</p>
            <p className="text-muted-foreground">
              A equipe, o estoque e a produção desta sala entram com o cadastro da operação da unidade (o próximo passo das unidades).
            </p>
          </div>
        </Slideover>
      )}
    </div>
  );
}

function Botao({ rotulo, ativo, onClick, children }: { rotulo: string; ativo?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      className={cn(
        "grid size-9 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white",
        ativo ? "bg-[#1A63D8] text-white" : "text-white/80 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}
