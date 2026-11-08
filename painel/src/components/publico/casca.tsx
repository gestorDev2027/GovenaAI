import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/layout/logo";

/** Moldura das páginas públicas (landing, entrar, cadastrar): barra com a marca e os dois caminhos, e o rodapé. */
export function CascaPublica({ children, semAcoes = false, escuro = false }: { children: ReactNode; semAcoes?: boolean; escuro?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className={escuro ? "bg-[#0D1B38] text-white" : "border-b border-border bg-card"}>
        <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/inicio" aria-label="GestorGov — início" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo sobreEscuro={escuro} subtitulo />
          </Link>
          {!semAcoes && (
            <nav aria-label="Acesso" className="flex items-center gap-2">
              <Link
                to="/entrar"
                className={
                  "inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (escuro ? "text-white hover:bg-white/10" : "text-foreground hover:bg-secondary")
                }
              >
                Entrar
              </Link>
              <Link
                to="/cadastro"
                className="inline-flex h-10 items-center rounded-full bg-[#F4B800] px-5 text-sm font-bold text-[#0D1B38] outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cadastrar organização
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span>GestorGov · Gestão Pública Inteligente</span>
          <span>Dados tratados conforme a LGPD. Toda entrega dos agentes passa pela aprovação de uma pessoa responsável.</span>
        </div>
      </footer>
    </div>
  );
}
