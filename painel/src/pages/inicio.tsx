import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  ClipboardCheck,
  FileSearch,
  HeartPulse,
  LayoutDashboard,
  Lock,
  MapPinned,
  MessagesSquare,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  UserPlus,
} from "lucide-react";
import { CascaPublica } from "@/components/publico/casca";
import { SimboloGestorGov } from "@/components/layout/logo";

/*
 * Landing page do GestorGov: a promessa e a imagem do produto, o que ele faz numa Secretaria Municipal de Saúde,
 * como funciona, as três visões, a segurança e a chamada final. Pública, sem login. As imagens do produto são
 * ilustrações em HTML do mesmo desenho das telas (a implantação, o prédio com as salas, o painel): leves, sem 3D.
 */

const NA_SECRETARIA = [
  {
    icone: HeartPulse,
    nome: "Um agente por setor",
    resumo: "Atenção Primária, Regulação, Assistência Farmacêutica, Compras e Licitações, Vigilância, Gestão de Pessoas...",
    exemplos: [
      "Atenção Primária: acompanha os indicadores das equipes",
      "Farmácia: avisa o que está perto de faltar",
      "Gabinete: prepara ofícios e relatórios para o secretário",
    ],
  },
  {
    icone: Stethoscope,
    nome: "Regulação e compras",
    resumo: "Rotinas que o agente faz sozinho, num horário, e documentos que ele prepara quando alguém pede.",
    exemplos: [
      "Regulação: aponta quem espera há mais de 90 dias na fila",
      "Compras: elabora o termo de referência pedido",
      "A decisão clínica é sempre do profissional",
    ],
  },
  {
    icone: MapPinned,
    nome: "Unidades do CNES",
    resumo: "As unidades de saúde do município vêm do CNES e aparecem no mapa da cidade, cada uma com a sua ficha.",
    exemplos: [
      "UBS, UPA, CAPS, hospital, farmácia, SAMU",
      "Fotos e conferência de cada unidade",
      "Cada unidade com o seu prédio virtual",
    ],
  },
];

const PASSOS = [
  { icone: UserPlus, titulo: "Cadastre a secretaria", texto: "Crie a conta de quem vai implantar. Leva um minuto." },
  {
    icone: MessagesSquare,
    titulo: "Converse com o assistente",
    texto: "Ele pergunta a cidade, completa o cadastro com dados públicos (com a fonte) e monta setores, cargos e agentes com você.",
  },
  { icone: ClipboardCheck, titulo: "Os agentes trabalham, você aprova", texto: "Rotinas e documentos chegam prontos. Nada vale sem o “sim” do responsável." },
];

const VISOES = [
  { icone: Building2, titulo: "Secretaria virtual", texto: "Cada setor numa sala, com o seu agente na mesa e o CCO no centro. Você vê quem está trabalhando em quê." },
  { icone: MapPinned, titulo: "Cidade", texto: "As unidades de saúde no mapa: UBS, UPA, CAPS e hospitais do município." },
  { icone: LayoutDashboard, titulo: "Painel", texto: "Indicadores com meta, entregas, pendências e aprovações. Tudo do 3D também está aqui." },
];

const GARANTIAS = [
  { icone: ClipboardCheck, titulo: "Uma pessoa aprova", texto: "O agente nunca aprova o próprio trabalho. Quem aprova é o responsável do setor, conforme o cargo." },
  { icone: ScrollText, titulo: "Tudo na auditoria", texto: "Quem fez, quando, o que mudou e quem aprovou: de pessoas e de agentes." },
  { icone: Lock, titulo: "Dados no Brasil", texto: "Banco em São Paulo, chaves num cofre e cada secretaria separada das outras." },
  { icone: ShieldCheck, titulo: "LGPD", texto: "Agentes trabalham com números agregados: nada de nome, CPF ou Cartão SUS de pacientes." },
];

export function Inicio() {
  useEffect(() => {
    document.title = "GestorGov · Agentes de IA para a Secretaria de Saúde";
  }, []);

  return (
    <CascaPublica escuro>
      {/* Abertura */}
      <section className="relative overflow-hidden bg-[#0D1B38] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_55%_at_80%_30%,rgba(82,162,255,0.20),transparent_70%)]" />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:pt-20 lg:pb-28">
          <div className="flex flex-col gap-6">
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">
              <span className="size-1.5 rounded-full bg-[#F4B800]" /> Secretarias Municipais de Saúde
            </span>
            <h1 className="text-[2.5rem] leading-[1.08] font-bold tracking-tight text-balance sm:text-5xl">
              Agentes de IA que trabalham com a sua equipe. <span className="text-[#52A2FF]">Você aprova.</span>
            </h1>
            <p className="max-w-lg text-base text-white/75 sm:text-lg">
              Cada setor da secretaria ganha um agente que faz as rotinas, prepara os documentos e aponta o que precisa de atenção. A implantação é uma
              conversa de minutos.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/cadastro"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-[#F4B800] px-6 text-sm font-bold text-[#0D1B38] outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-white"
              >
                Cadastrar secretaria <ArrowRight className="size-4" />
              </Link>
              <Link
                to="/entrar"
                className="inline-flex h-12 items-center rounded-full border border-white/25 px-6 text-sm font-semibold text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
              >
                Já tenho conta
              </Link>
            </div>
          </div>
          <JanelaDoProduto />
        </div>
      </section>

      {/* Na Secretaria de Saúde */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <Titulo
          selo="Para quem é"
          titulo="Feito para a Secretaria Municipal de Saúde"
          texto="O assistente monta a secretaria com os setores, as atividades e os cargos de uma gestão de saúde do SUS."
        />
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {NA_SECRETARIA.map(({ icone: Icone, nome, resumo, exemplos }) => (
            <li key={nome} className="surface-card flex flex-col gap-4 p-6">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary-text">
                  <Icone className="size-5" />
                </span>
                <h3 className="text-lg font-semibold">{nome}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{resumo}</p>
              <ul className="space-y-2 text-sm">
                {exemplos.map((e) => (
                  <li key={e} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {e}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      {/* Como funciona */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <Titulo selo="Como funciona" titulo="Do cadastro aos agentes trabalhando, numa conversa" />
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {PASSOS.map(({ icone: Icone, titulo, texto }, i) => (
              <li key={titulo} className="rounded-2xl border border-border bg-background p-6">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="num grid size-8 place-items-center rounded-full bg-[#0D1B38] text-sm font-bold text-white dark:bg-[#1A63D8]">
                    {i + 1}
                  </span>
                  <Icone className="size-5 text-primary-text" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-semibold">{titulo}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* As três visões */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <Titulo selo="As visões" titulo="A mesma secretaria, de três jeitos" texto="Computador simples também serve: o 3D nunca é obrigatório." />
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {VISOES.map(({ icone: Icone, titulo, texto }, i) => (
            <li key={titulo} className="surface-card overflow-hidden">
              <div aria-hidden="true" className="h-36 border-b border-border bg-muted/40 p-4">
                {i === 0 ? <MiniPredio /> : i === 1 ? <MiniMapa /> : <MiniPainel />}
              </div>
              <div className="p-5">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Icone className="size-4 text-primary-text" aria-hidden="true" /> {titulo}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Segurança */}
      <section className="bg-[#0D1B38] text-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <span className="text-xs font-semibold tracking-wider text-[#F4B800] uppercase">Segurança</span>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">IA com responsabilidade</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GARANTIAS.map(({ icone: Icone, titulo, texto }) => (
              <li key={titulo} className="rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10">
                <Icone className="size-5 text-[#52A2FF]" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{titulo}</h3>
                <p className="mt-1 text-sm text-white/70">{texto}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Chamada final */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-start gap-5 rounded-3xl border border-border bg-card p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div className="flex items-center gap-4">
            <SimboloGestorGov className="hidden size-14 sm:block" />
            <div>
              <p className="text-xl font-bold">Monte a sua secretaria hoje</p>
              <p className="mt-1 text-sm text-muted-foreground">O cadastro leva um minuto; o resto é uma conversa com o assistente.</p>
            </div>
          </div>
          <Link
            to="/cadastro"
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-[#F4B800] px-6 text-sm font-bold text-[#0D1B38] outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cadastrar secretaria <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    </CascaPublica>
  );
}

function Titulo({ selo, titulo, texto }: { selo: string; titulo: string; texto?: string }) {
  return (
    <div className="max-w-2xl">
      <span className="text-xs font-semibold tracking-wider text-primary-text uppercase">{selo}</span>
      <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{titulo}</h2>
      {texto && <p className="mt-2 text-muted-foreground">{texto}</p>}
    </div>
  );
}

/**
 * A imagem do produto na abertura: a tela da implantação (o chat fino à esquerda e o prédio se montando à direita),
 * no mesmo desenho da tela de verdade.
 */
function JanelaDoProduto() {
  const salas = [
    { nome: "Atenção Primária", cor: "#1A63D8", ativo: true },
    { nome: "Regulação", cor: "#52A2FF", ativo: true },
    { nome: "Compras", cor: "#1BAF7A", ativo: false },
    { nome: "Farmácia", cor: "#8B5CF6", ativo: false },
    { nome: "Vigilância", cor: "#F4B800", ativo: false },
    { nome: "Gabinete", cor: "#14C4D4", ativo: false },
  ];
  return (
    <figure aria-label="Ilustração da tela de implantação do GestorGov" className="relative">
      <div className="overflow-hidden rounded-2xl bg-white text-[#0D1B38] shadow-2xl ring-1 ring-white/10">
        {/* barra da janela */}
        <div className="flex items-center gap-1.5 border-b border-[#E6EAF2] bg-[#F6F7F9] px-3 py-2">
          <span className="size-2.5 rounded-full bg-[#E6EAF2]" />
          <span className="size-2.5 rounded-full bg-[#E6EAF2]" />
          <span className="size-2.5 rounded-full bg-[#E6EAF2]" />
          <span className="ml-3 truncate text-[11px] text-[#424E6B]">Implantação · Secretaria Municipal de Saúde · Resende-RJ</span>
        </div>
        <div className="grid sm:grid-cols-[0.85fr_1.15fr]">
          {/* o chat */}
          <div className="hidden flex-col gap-2.5 border-r border-[#E6EAF2] p-3 text-[11px] leading-snug sm:flex">
            <p>Para começar: qual é o CEP da prefeitura (ou a cidade e a UF)?</p>
            <p className="ml-auto w-fit rounded-xl bg-[#E8F1FF] px-2.5 py-1.5">Resende, RJ</p>
            <p>
              Sugiro estes setores: <b>Atenção Primária</b>, <b>Regulação</b>, <b>Compras</b>, <b>Farmácia</b>, <b>Vigilância</b> e{" "}
              <b>Gabinete</b>. Confere?
            </p>
            <p className="ml-auto w-fit rounded-xl bg-[#E8F1FF] px-2.5 py-1.5">Confirmo</p>
            <p className="flex items-center gap-1.5 text-[#424E6B]">
              <Bot className="size-3" /> 6 agentes sentaram nas salas.
            </p>
          </div>
          {/* o prédio */}
          <div className="bg-[#F3F6FB] p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] text-[#424E6B]">
              <span className="font-semibold text-[#0D1B38]">Secretaria virtual</span>
              <span>Etapa 6 de 9 · Agentes</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {salas.map((s) => (
                <div key={s.nome} className="rounded-lg border border-[#DCE3EE] bg-white p-1.5">
                  <div className="flex items-center gap-1 text-[9px] font-semibold">
                    <span className="size-1.5 rounded-full" style={{ background: s.cor }} />
                    {s.nome}
                  </div>
                  <div className="mt-1.5 flex items-end justify-between">
                    <span className="grid size-5 place-items-center rounded-md text-white" style={{ background: s.cor }}>
                      <Bot className="size-3" />
                    </span>
                    {s.ativo && <span className="truncate rounded-full bg-[#FFF4D1] px-1 text-[8px] font-semibold text-[#8A6700]">trabalhando</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1.5 rounded-lg bg-[#0D1B38] py-1.5 text-center text-[9px] font-semibold text-white">CCO · Centro de Comando e Operações</div>
          </div>
        </div>
      </div>
      {/* o pedido de aprovação, por cima */}
      <div className="absolute -bottom-14 left-4 w-64 rounded-xl bg-white p-3 text-[#0D1B38] shadow-xl ring-1 ring-black/5 sm:left-auto sm:-right-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#8A6700]">
          <FileSearch className="size-3" /> Para você aprovar
        </div>
        <p className="mt-1 text-xs font-medium">Regulação: 14 pacientes há mais de 90 dias esperando cardiologia</p>
        <div className="mt-2 flex gap-1.5">
          <span className="rounded-full bg-[#1A63D8] px-2.5 py-0.5 text-[10px] font-semibold text-white">Aprovar</span>
          <span className="rounded-full border border-[#DCE3EE] px-2.5 py-0.5 text-[10px] font-semibold">Devolver</span>
        </div>
      </div>
    </figure>
  );
}

function MiniPredio() {
  const cores = ["#1A63D8", "#52A2FF", "#1BAF7A", "#8B5CF6", "#F4B800", "#14C4D4"];
  return (
    <div className="grid h-full grid-cols-3 gap-1.5">
      {cores.map((c, i) => (
        <div key={c} className="flex items-end rounded-md border border-border bg-card p-1.5">
          <span className="grid size-4 place-items-center rounded" style={{ background: c }}>
            <span className={i % 2 ? "size-1.5 rounded-full bg-white/70" : "size-1.5 rounded-full bg-white"} />
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniMapa() {
  const pinos = [
    [18, 30, "#1A63D8"],
    [42, 55, "#F4B800"],
    [64, 25, "#1A63D8"],
    [78, 62, "#52A2FF"],
    [30, 72, "#1A63D8"],
  ] as const;
  return (
    <div className="relative h-full overflow-hidden rounded-md bg-[#DDE7DA] dark:bg-[#1E2B3D]">
      <div className="absolute inset-x-0 top-1/2 h-2 -rotate-6 bg-white/70 dark:bg-white/15" />
      <div className="absolute inset-y-0 left-1/3 w-2 rotate-12 bg-white/70 dark:bg-white/15" />
      {pinos.map(([x, y, c]) => (
        <span key={`${x}-${y}`} className="absolute size-3 rounded-full ring-2 ring-white" style={{ left: `${x}%`, top: `${y}%`, background: c }} />
      ))}
    </div>
  );
}

function MiniPainel() {
  return (
    <div className="grid h-full grid-cols-3 gap-1.5">
      {[
        ["92%", "meta"],
        ["14", "entregas"],
        ["3", "aprovar"],
      ].map(([n, r]) => (
        <div key={r} className="flex flex-col justify-center rounded-md border border-border bg-card p-2">
          <span className="text-base font-bold">{n}</span>
          <span className="text-[10px] text-muted-foreground">{r}</span>
        </div>
      ))}
      <div className="col-span-3 flex items-end gap-1 rounded-md border border-border bg-card p-2">
        {[40, 55, 48, 70, 62, 80, 76].map((h, i) => (
          <span key={i} className="flex-1 rounded-sm bg-[#52A2FF]" style={{ height: `${h * 0.35}px` }} />
        ))}
      </div>
    </div>
  );
}
