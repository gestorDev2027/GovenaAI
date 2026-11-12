import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { CampoSenha } from "@/components/publico/campo-senha";
import { TelaDeAcesso } from "@/components/publico/tela-de-acesso";
import { Campo, destinoDepoisDeEntrar } from "./entrar";

/**
 * Senha nova pelo link que quem administra o GestorGov gerou em Usuários (vale 24 h e uma vez só). A pessoa cria a
 * senha e já entra.
 */
export function RedefinirSenha() {
  const { token } = useParams({ strict: false }) as { token: string };
  const qc = useQueryClient();
  const navegar = useNavigate();
  const link = useQuery({
    queryKey: ["redefinir-senha", token],
    queryFn: () => api<{ email: string; nome: string }>(`/redefinir-senha/${encodeURIComponent(token)}`),
    retry: false,
    staleTime: Infinity,
  });
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    document.title = "Senha nova · GestorGov";
  }, []);

  const diferentes = confirma.length > 0 && senha !== confirma;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (diferentes) return;
    setErro(null);
    setEnviando(true);
    try {
      await api(`/redefinir-senha/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify({ senha }) });
      await qc.refetchQueries({ queryKey: ["acesso"] });
      navegar({ to: await destinoDepoisDeEntrar() });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível salvar a senha.");
    } finally {
      setEnviando(false);
    }
  }

  if (link.isLoading) {
    return (
      <TelaDeAcesso titulo="Abrindo o link" descricao="Só um instante.">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </TelaDeAcesso>
    );
  }
  if (link.isError || !link.data) {
    return (
      <TelaDeAcesso titulo="Link indisponível" descricao={(link.error as Error)?.message ?? "Link inválido."}>
        <Button variant="outline" onClick={() => navegar({ to: "/entrar" })}>
          <LogIn /> Ir para o login
        </Button>
      </TelaDeAcesso>
    );
  }
  return (
    <TelaDeAcesso titulo="Crie uma senha nova" descricao={`Olá, ${link.data.nome.split(" ")[0]}. A senha antiga deixa de valer.`}>
      <form onSubmit={salvar} className="space-y-4">
        <Campo id="email" rotulo="E-mail">
          <Input id="email" value={link.data.email} readOnly autoComplete="username" className="h-11 bg-muted/50" />
        </Campo>
        <Campo id="senha" rotulo="Senha nova" ajuda="Pelo menos 8 caracteres.">
          <CampoSenha id="senha" autoComplete="new-password" required autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} className="h-11" />
        </Campo>
        <Campo id="confirma" rotulo="Repita a senha nova">
          <CampoSenha id="confirma" autoComplete="new-password" required value={confirma} onChange={(e) => setConfirma(e.target.value)} className="h-11" />
        </Campo>
        {(diferentes || erro) && (
          <p role="alert" className="text-sm text-destructive">
            {diferentes ? "As duas senhas não são iguais." : erro}
          </p>
        )}
        <Button type="submit" size="lg" className="h-11 w-full" disabled={enviando || senha.length < 8 || senha !== confirma}>
          {enviando && <Loader2 className="animate-spin" />}
          Salvar a senha e entrar
        </Button>
      </form>
    </TelaDeAcesso>
  );
}
