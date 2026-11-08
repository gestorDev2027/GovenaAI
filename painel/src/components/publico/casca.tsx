import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/layout/logo";

/**
 * Moldura das páginas públicas (landing): barra fina com a marca e os dois caminhos, e o rodapé com a marca grande.
 * `escuro`: a barra em azul-marinho, emendada na abertura escura da landing.
 */
export function CascaPublica({ children, semAcoes = false, escuro = false }: { children: ReactNode; semAcoes?: boolean; escuro?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className={escuro ? "sticky top-0 z-30 border-b border-white/10 bg-[#0D1B38]/95 text-white backdrop-blur" : "sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur"}>
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/inicio" aria-label="GestorGov — início" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo sobreEscuro={escuro} />
          </Link>
          {!semAcoes && (
            <nav aria-label="Acesso" className="flex items-center gap-1.5 sm:gap-2">
              <Link
                to="/entrar"
                className={
                  "inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 " +
                  (escuro ? "text-white hover:bg-white/10" : "text-foreground hover:bg-secondary")
                }
              >
                Entrar
              </Link>
              <Link
                to="/cadastro"
                className="inline-flex h-9 items-center rounded-full bg-[#F4B800] px-4 text-sm font-bold text-[#0D1B38] outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
              >
                Começar
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-3">
            <Logo tamanho="lg" subtitulo />
            <p className="max-w-md text-sm text-muted-foreground">
              Agentes de IA que trabalham com a sua equipe, em Secretarias de Saúde e empresas. Toda entrega passa pela aprovação de uma pessoa.
            </p>
          </div>
          <nav aria-label="Rodapé" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link to="/cadastro" className="font-medium hover:underline">
              Cadastrar organização
            </Link>
            <Link to="/entrar" className="font-medium hover:underline">
              Entrar
            </Link>
          </nav>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
            <span>© GestorGov</span>
            <span>Dados tratados conforme a LGPD e guardados no Brasil.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
