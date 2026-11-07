import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/layout/logo";

/** Moldura das páginas públicas (landing, entrar, cadastrar): barra com a marca e os dois caminhos, e o rodapé. */
export function CascaPublica({ children, semAcoes = false }: { children: ReactNode; semAcoes?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/inicio" aria-label="GestorGov — início" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
          </Link>
          {!semAcoes && (
            <nav aria-label="Acesso" className="flex items-center gap-2">
              <Link
                to="/entrar"
                className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
              >
                Entrar
              </Link>
              <Link
                to="/cadastro"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cadastrar prefeitura
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span>GestorGov · Gestão Pública Inteligente</span>
          <span>Dados de saúde tratados conforme a LGPD. Toda entrega dos agentes passa pela aprovação de um servidor.</span>
        </div>
      </footer>
    </div>
  );
}
