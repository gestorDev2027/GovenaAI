import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { Permissao } from "@/lib/api";
import { usePode } from "@/hooks/use-permissoes";
import { EmptyState } from "@/components/widgets/widgets";

const NOME: Record<Permissao, string> = {
  ver_painel: "Ver o painel",
  tratar_alertas: "Tratar alertas",
  usar_chat: "Usar o chat de teste",
  avaliar: "Avaliar respostas",
  aprovar_calibracao: "Aprovar na Calibração",
  editar_conhecimento: "Editar conhecimento",
  editar_agentes: "Editar agentes",
  publicar: "Publicar",
  excluir: "Excluir",
  ferramentas_e_chaves: "Ferramentas e chaves",
  ver_banco: "Ver o banco",
  gerenciar_usuarios: "Gerenciar usuários",
};

/** A tela inteira só para quem tem a permissão; para os outros, o aviso (quem entra pelo endereço direto). */
export function ExigePermissao({ permissao, children }: { permissao: Permissao; children: ReactNode }) {
  const pode = usePode();
  if (pode(permissao)) return <>{children}</>;
  return (
    <div className="px-4 py-16 sm:px-8">
      <div className="surface-card mx-auto max-w-md">
        <EmptyState icon={<Lock className="size-5" />} title="Você não tem acesso a esta tela">
          É preciso a permissão “{NOME[permissao]}”. Peça ao dono do painel.
        </EmptyState>
      </div>
    </div>
  );
}
