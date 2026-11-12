import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { Permissao, PermissaoOrganizacao } from "@/lib/api";
import { usePode, usePodeNaOrganizacao } from "@/hooks/use-permissoes";
import { EmptyState } from "@/components/widgets/widgets";

const NOME: Record<Permissao, string> = {
  ver_painel: "Ver o painel",
  usar_chat: "Usar o chat",
  editar_conhecimento: "Editar conhecimento",
  editar_agentes: "Editar agentes",
  publicar: "Publicar",
  excluir: "Excluir",
  ferramentas_e_chaves: "Ferramentas e chaves",
  ver_banco: "Ver o banco",
  gerenciar_usuarios: "Gerenciar usuários",
};

/** A tela inteira só para quem tem a permissão; para os outros, o aviso (quem entra pelo endereço direto). */
export function ExigePermissao({
  permissao,
  ouNaOrganizacao,
  children,
}: {
  /** A permissão da plataforma. Sem ela, vale só a da organização (`ouNaOrganizacao`). */
  permissao?: Permissao;
  /** Também libera quem tem esta permissão na organização dele (a tela mostra só os dados da organização). */
  ouNaOrganizacao?: PermissaoOrganizacao;
  children: ReactNode;
}) {
  const pode = usePode();
  const podeNaOrganizacao = usePodeNaOrganizacao();
  if ((!!permissao && pode(permissao)) || (!!ouNaOrganizacao && podeNaOrganizacao(ouNaOrganizacao))) return <>{children}</>;
  return (
    <div className="px-4 py-16 sm:px-8">
      <div className="surface-card mx-auto max-w-md">
        <EmptyState icon={<Lock className="size-5" />} title="Você não tem acesso a esta tela">
          {permissao ? `É preciso a permissão “${NOME[permissao]}”. Peça ao dono do painel.` : "O seu cargo não dá acesso a esta tela. Peça ao dono da organização."}
        </EmptyState>
      </div>
    </div>
  );
}
