import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  BellRing,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  LayoutDashboard,
  MapPinned,
  MessagesSquare,
  Network,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { CascaPublica } from "@/components/publico/casca";
import { Colagem } from "@/components/publico/tela-de-acesso";
import { SimboloGestorGov } from "@/components/layout/logo";

/*
 * Landing page do GestorGov: o que é, as três visões, como funciona e os dois caminhos (cadastrar a
 * prefeitura ou entrar). Pública, sem login.
 */

const VISOES = [
  {
    icone: MapPinned,
    titulo: "Cidade",
    texto: "O mapa do município com as unidades de saúde (UBS, UPA, CAPS, hospital, farmácia, SAMU) e o estado de cada uma.",
  },
  {
    icone: Building2,
    titulo: "Secretaria",
    texto: "O prédio da secretaria: cada setor numa sala, cada cargo com o seu agente trabalhando na mesa.",
  },
  {
    icone: LayoutDashboard,
    titulo: "Painel",
    texto: "O que cada cargo está fazendo, indicadores com meta e tendência, entregas, pendências e aprovações.",
  },
];

const PASSOS = [
  {
    icone: UserPlus,
    titulo: "Cadastre a prefeitura",
    texto: "Crie a conta do secretário de saúde com o e-mail institucional.",
  },
  {
    icone: MessagesSquare,
    titulo: "Converse com o assistente",
    texto: "O Assistente de Implantação busca o município, importa as unidades do CNES e monta o organograma com você.",
  },
  {
    icone: ClipboardCheck,
    titulo: "Os agentes trabalham, você aprova",
    texto: "Cada cargo ganha um agente que faz as rotinas e prepara os documentos. Nada vale sem a aprovação do responsável.",
  },
];

const PRINCIPIOS = [
  { icone: CheckCircle2, texto: "O agente nunca aprova o próprio trabalho: toda entrega passa por um servidor." },
  { icone: BellRing, texto: "Alertas sobem pela hierarquia: coordenação, superintendência, Adjunto e Secretário." },
  { icone: Network, texto: "Organograma completo: direção, superintendências, coordenações, unidades e controle." },
  { icone: ShieldCheck, texto: "Dados de saúde tratados como sensíveis: agentes usam números agregados, nunca dados de paciente." },
];

export function Inicio() {
  useEffect(() => {
    document.title = "GestorGov · Gestão Pública Inteligente";
  }, []);

  return (
    <CascaPublica escuro>
      {/* Abertura: azul-marinho, com a colagem do que o sistema mostra */}
      <section className="relative overflow-hidden bg-[#0D1B38] text-white">
        <SimboloGestorGov sobreEscuro className="pointer-events-none absolute -top-40 -left-40 size-[560px] opacity-[0.05]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_85%_20%,rgba(82,162,255,0.25),transparent_70%)]" />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-10 pb-20 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-16 md:pb-28">
          <div className="flex flex-col gap-6">
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">
              <span className="size-1.5 rounded-full bg-[#F4B800]" /> Secretarias Municipais de Saúde
            </span>
            <h1 className="text-4xl leading-[1.1] font-bold tracking-tight sm:text-5xl">
              Cada cargo da secretaria com um <span className="text-[#52A2FF]">agente de IA</span>. Cada entrega com a aprovação de um servidor.
            </h1>
            <p className="max-w-xl text-base text-white/75">
              O GestorGov faz as rotinas de cada setor, prepara os documentos sob demanda e aponta o que precisa de atenção, da
              fila da regulação ao estoque da farmácia. A implantação é uma conversa: em poucos minutos a sua secretaria está montada.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/cadastro"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-[#F4B800] px-6 text-sm font-bold text-[#0D1B38] outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-white"
              >
                <UserPlus className="size-4" />
                Cadastrar prefeitura
              </Link>
              <Link
                to="/entrar"
                className="inline-flex h-12 items-center rounded-full border border-white/25 px-6 text-sm font-semibold text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
              >
                Já tenho conta
              </Link>
            </div>
          </div>
          <Colagem />
        </div>
      </section>

      {/* O organograma, logo abaixo da abertura */}
      <section className="mx-auto -mt-12 w-full max-w-4xl px-4 sm:px-6">
        <Organograma />
      </section>

      {/* As três visões */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-bold">Três visões da mesma secretaria</h2>
        <p className="mt-1 text-sm text-muted-foreground">Toda informação do mapa e do prédio também está no Painel: o 3D nunca é obrigatório.</p>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {VISOES.map(({ icone: Icone, titulo, texto }) => (
            <li key={titulo} className="surface-card p-6 transition-shadow hover:shadow-md">
              <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary-text">
                <Icone className="size-5" />
              </span>
              <h3 className="mt-3 font-semibold">{titulo}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Como funciona */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-xl font-bold">Como funciona</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {PASSOS.map(({ icone: Icone, titulo, texto }, i) => (
              <li key={titulo} className="flex gap-4">
                <span aria-hidden="true" className="num grid size-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                  {i + 1}
                </span>
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Icone className="size-4 text-primary-text" />
                    {titulo}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Princípios */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-bold">Feito para a gestão pública</h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {PRINCIPIOS.map(({ icone: Icone, texto }) => (
            <li key={texto} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm">
              <Icone className="mt-0.5 size-4 shrink-0 text-primary-text" />
              {texto}
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-col items-start gap-3 rounded-2xl bg-[#0D1B38] p-8 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Pronto para montar a sua Secretaria de Saúde?</p>
            <p className="text-sm opacity-80">O cadastro leva um minuto; a implantação é uma conversa com o assistente.</p>
          </div>
          <Link
            to="/cadastro"
            className="inline-flex h-12 shrink-0 items-center rounded-full bg-[#F4B800] px-6 text-sm font-bold text-[#0D1B38] outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-white"
          >
            Cadastrar prefeitura
          </Link>
        </div>
      </section>
    </CascaPublica>
  );
}

/** O organograma em miniatura: direção, superintendências e coordenações, com os agentes. */
function Organograma() {
  const caixa = "rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium shadow-xs";
  const agente = (rotulo: string) => (
    <span className="mt-1 flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
      {rotulo}
    </span>
  );
  return (
    <figure aria-label="Exemplo de organograma da Secretaria de Saúde" className="surface-card relative flex flex-col items-center gap-3 p-6 shadow-lg">
      <div className={`${caixa} border-primary text-center`}>
        Secretário(a) de Saúde
        {agente("painel executivo · diário")}
      </div>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <div className="grid w-full grid-cols-3 gap-2">
        {[
          ["Atenção Primária", "produção por unidade"],
          ["Regulação", "fila acima de 90 dias"],
          ["Farmácia", "estoque crítico"],
        ].map(([nome, rotina]) => (
          <div key={nome} className={caixa}>
            {nome}
            {agente(rotina)}
          </div>
        ))}
      </div>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <div className="grid w-full grid-cols-2 gap-2">
        <div className={caixa}>
          Saúde da Mulher
          {agente("pré-natal em dia")}
        </div>
        <div className={`${caixa} border-warning`}>
          Imunização
          <span className="mt-1 flex items-center gap-1 text-[10px] font-normal text-warning-text">
            <BellRing className="size-3" /> cobertura abaixo da meta
          </span>
        </div>
      </div>
      <figcaption className="text-center text-[11px] text-muted-foreground">Cada cargo tem um agente; o alerta sobe ao superior.</figcaption>
    </figure>
  );
}
