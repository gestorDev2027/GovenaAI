import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BellRing, CheckCircle2, Landmark, MapPinned, Network } from "lucide-react";
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
          <Link to="/inicio" aria-label="GestorGov — início" className="w-fit rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
          </Link>
          <div className="my-auto space-y-6 py-10">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
              <div className="mt-1.5 text-sm text-muted-foreground">{descricao}</div>
            </div>
            {children}
          </div>
          <p className="text-xs text-muted-foreground">Dados de saúde tratados conforme a LGPD.</p>
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
          <p className="max-w-md text-3xl leading-tight font-bold">Cada cargo com um agente de IA. Cada entrega aprovada por um servidor.</p>
        </div>

        <Colagem />
        <div className="flex items-center gap-3 text-sm text-white/70">
          <Landmark className="size-4" /> Gestão pública inteligente
        </div>
      </div>
    </aside>
  );
}

/** A colagem do que o sistema mostra: o município, um alerta da regulação e um alerta ao Secretário. */
export function Colagem() {
  return (
    <div className="relative mx-auto h-[400px] w-full max-w-md">
          <div className="absolute top-0 left-0 w-[78%] rounded-2xl bg-white p-4 text-[#0D1B38] shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MapPinned className="size-4 text-[#1A63D8]" /> Itatiaia-RJ
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["18", "UBS"],
                ["1", "UPA"],
                ["4", "Farmácias"],
              ].map(([n, r]) => (
                <div key={r} className="rounded-xl bg-[#F3F6FB] py-2">
                  <div className="text-lg font-bold">{n}</div>
                  <div className="text-[10px] text-[#424E6B]">{r}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="absolute top-[33%] right-0 w-[64%] rounded-2xl bg-[#1A63D8] p-4 shadow-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <Network className="size-3.5" /> Superintendência de Regulação
            </div>
            <div className="mt-1 text-2xl font-bold">14 pacientes</div>
            <div className="text-xs text-white/80">há mais de 90 dias na fila de cardiologia</div>
          </div>
          <div className="absolute bottom-0 left-[8%] w-[70%] rounded-2xl bg-white p-4 text-[#0D1B38] shadow-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#8A6700]">
              <BellRing className="size-3.5" /> Alerta ao Secretário
            </div>
            <div className="mt-1 text-sm font-medium">Cobertura vacinal abaixo da meta há 2 ciclos</div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-[#424E6B]">
              <CheckCircle2 className="size-3.5 text-[#1BAF7A]" /> Plano de busca ativa aguardando sua aprovação
            </div>
          </div>
    </div>
  );
}
