import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { CampoSenha } from "@/components/publico/campo-senha";
import { TelaDeAcesso } from "@/components/publico/tela-de-acesso";
import { Campo } from "./entrar";

/**
 * Entrada pelo link da implantação: um colaborador da organização recebeu o link e o código de segurança de quem está
 * implantando. Com os dois, cria a conta (ou usa a que já tem), entra na organização e continua a implantação.
 */
export function ColaborarNaImplantacao() {
  const { token } = useParams({ strict: false }) as { token: string };
  const qc = useQueryClient();
  const navegar = useNavigate();
  const link = useQuery({
    queryKey: ["link-implantacao", token],
    queryFn: () => api<{ organizacao: string; convidado_por: string }>(`/implantacao/link/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    document.title = "Implantação compartilhada · GestorGov";
  }, []);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api(`/implantacao/link/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify({ nome: nome.trim(), email: email.trim(), senha, codigo }),
      });
      await qc.refetchQueries({ queryKey: ["acesso"] });
      navegar({ to: "/implantacao" });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível entrar.");
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
    <TelaDeAcesso
      titulo={`Implantação de ${link.data.organizacao}`}
      descricao={
        <>
          <strong className="text-foreground">{link.data.convidado_por}</strong> compartilhou a implantação com você. Use o código de segurança que
          recebeu para continuar de onde parou.
        </>
      }
    >
      <form onSubmit={entrar} className="space-y-4">
        <Campo id="codigo" rotulo="Código de segurança" ajuda="Os 6 números que vieram junto com o link.">
          <Input
            id="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="h-11 font-mono text-lg tracking-[0.4em]"
          />
        </Campo>
        <Campo id="nome" rotulo="Seu nome completo">
          <Input id="nome" autoComplete="name" required value={nome} onChange={(e) => setNome(e.target.value)} className="h-11" />
        </Campo>
        <Campo id="email" rotulo="Seu e-mail institucional">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
        </Campo>
        <Campo id="senha" rotulo="Crie uma senha" ajuda="Pelo menos 8 caracteres. Se este e-mail já tem conta, use a senha dela.">
          <CampoSenha id="senha" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} className="h-11" />
        </Campo>
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
        <Button type="submit" size="lg" className="h-11 w-full" disabled={enviando || codigo.length !== 6 || nome.trim().length < 2 || senha.length < 8}>
          {enviando ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Entrar e continuar a implantação
        </Button>
      </form>
    </TelaDeAcesso>
  );
}
