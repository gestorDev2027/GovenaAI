import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Landmark, MessagesSquare, Network } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { SimboloGestorGov } from "@/components/layout/logo";

/**
 * Tela de acesso (entrar, cadastrar, aceitar convite): sem cabeçalho. À esquerda, o formulário, que rola sozinho;
 * à direita, o painel fixo com a marca e a ilustração do GestorGov (some em telas estreitas).
 */
export function TelaDeAcesso({ titulo, descricao, children }: { titulo: string; descricao: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <div className="thin-scroll flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-8 sm:px-8">
          <Link to="/entrar" aria-label="GestorGov — entrar" className="w-fit rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo tamanho="lg" subtitulo />
          </Link>
          <div className="my-auto space-y-6 py-10">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
              <div className="mt-1.5 text-sm text-muted-foreground">{descricao}</div>
            </div>
            {children}
          </div>
          <p className="text-xs text-muted-foreground">Cada decisão fica registrada, com quem aprovou.</p>
        </div>
      </div>
      <PainelDaMarca />
    </div>
  );
}

/** O lado direito: azul-marinho, o símbolo grande e uma colagem do que o sistema mostra. */
function PainelDaMarca() {
  return (
    <aside aria-hidden="true" className="relative hidden w-[46%] max-w-[720px] shrink-0 overflow-hidden bg-[#0D1B38] text-white lg:block">
      {/* Arcos do símbolo, grandes e discretos, ao fundo */}
      <SimboloGestorGov sobreEscuro className="absolute -top-24 -right-28 size-[520px] opacity-[0.07]" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_10%,rgba(82,162,255,0.22),transparent_70%)]" />
      <div className="relative flex h-full flex-col justify-between p-12">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">
            <span className="size-1.5 rounded-full bg-[#F4B800]" /> Secretarias Municipais de Saúde
          </span>
          <p className="max-w-md text-3xl leading-tight font-bold">Agentes de IA que trabalham com a sua equipe. <span className="text-[#52A2FF]">Você aprova.</span></p>
        </div>

        <Colagem />
        <div className="flex items-center gap-3 text-sm text-white/70">
          <Network className="size-4" /> Gestão pública inteligente
        </div>
      </div>
    </aside>
  );
}

/** Como começa (os três passos da apresentação): sem números de exemplo, só o caminho até o sistema funcionar. */
const PASSOS = [
  { icone: Landmark, titulo: "Cadastre a secretaria", texto: "O município, a equipe e as unidades de saúde." },
  { icone: MessagesSquare, titulo: "Converse com o assistente", texto: "Ele completa o cadastro com você e monta os agentes de cada setor." },
  { icone: CheckCircle2, titulo: "Aprove o que importa", texto: "Os agentes trabalham; nada avança sem o sim de uma pessoa." },
];

export function Colagem() {
  return (
    <div className="mx-auto w-full max-w-md space-y-3">
      <p className="text-[11px] font-semibold tracking-[0.22em] text-white/50 uppercase">Como começa</p>
      <ol className="space-y-3">
        {PASSOS.map(({ icone: Icone, titulo, texto }, i) => (
          <li key={titulo} className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#1A63D8] text-white">
              <Icone className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                <span className="mr-1.5 text-[#F4B800]">{i + 1}.</span>
                {titulo}
              </span>
              <span className="mt-0.5 block text-sm text-white/70">{texto}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="pt-2 text-[11px] font-semibold tracking-[0.18em] text-white/45 uppercase">
        Dados sobem · recomendações descem · o humano decide
      </p>
    </div>
  );
}
