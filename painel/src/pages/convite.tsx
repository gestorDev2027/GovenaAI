import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { CampoSenha } from "@/components/publico/campo-senha";
import { TelaDeAcesso } from "@/components/publico/tela-de-acesso";
import { Campo } from "./entrar";

/** Aceite do convite da prefeitura: a pessoa confirma o nome, cria a senha e entra no cargo. */
export function AceitarConvite() {
  const { token } = useParams({ strict: false }) as { token: string };
  const qc = useQueryClient();
  const navegar = useNavigate();
  const convite = useQuery({
    queryKey: ["convite", token],
    queryFn: () => api<{ email: string; nome: string; municipio: string; cargo: string | null }>(`/convite/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    document.title = "Convite · GestorGov";
  }, []);
  useEffect(() => {
    if (convite.data?.nome) setNome(convite.data.nome);
  }, [convite.data?.nome]);

  async function aceitar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api(`/convite/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify({ nome: nome.trim(), senha }) });
      await qc.refetchQueries({ queryKey: ["acesso"] });
      navegar({ to: "/cidade" });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível aceitar o convite.");
    } finally {
      setEnviando(false);
    }
  }

  if (convite.isLoading) {
    return (
      <TelaDeAcesso titulo="Abrindo o convite" descricao="Só um instante.">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </TelaDeAcesso>
    );
  }
  if (convite.isError || !convite.data) {
    return (
      <TelaDeAcesso titulo="Convite indisponível" descricao={(convite.error as Error)?.message ?? "Convite inválido."}>
        <Button variant="outline" onClick={() => navegar({ to: "/entrar" })}>
          <LogIn /> Ir para o login
        </Button>
      </TelaDeAcesso>
    );
  }
  const d = convite.data;
  return (
    <TelaDeAcesso
      titulo={`Você foi convidado para a Secretaria de Saúde de ${d.municipio}`}
      descricao={d.cargo ? <>No cargo <strong className="text-foreground">{d.cargo}</strong>. Crie a sua senha para entrar.</> : "Crie a sua senha para entrar."}
    >
      <form onSubmit={aceitar} className="space-y-4">
        <Campo id="email" rotulo="E-mail">
          <Input id="email" value={d.email} readOnly className="h-11 bg-muted/50" />
        </Campo>
        <Campo id="nome" rotulo="Seu nome completo">
          <Input id="nome" autoComplete="name" required value={nome} onChange={(e) => setNome(e.target.value)} className="h-11" />
        </Campo>
        <Campo id="senha" rotulo="Crie uma senha" ajuda="Pelo menos 8 caracteres. Se este e-mail já tem conta, use a senha dela.">
          <CampoSenha id="senha" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} className="h-11" />
        </Campo>
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
        <Button type="submit" size="lg" className="h-11 w-full" disabled={enviando || nome.trim().length < 2 || senha.length < 8}>
          {enviando && <Loader2 className="animate-spin" />}
          Aceitar o convite e entrar
        </Button>
      </form>
    </TelaDeAcesso>
  );
}
