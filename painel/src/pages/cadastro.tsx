import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn, Rocket } from "lucide-react";
import { api, type Acesso } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { CampoSenha } from "@/components/publico/campo-senha";
import { Campo, FormularioCentral } from "./entrar";

const SENHA_MINIMA = 8;

/** Cadastro da organização (Secretaria de Saúde ou empresa): a conta de quem implanta. Depois, a implantação com o assistente. */
export function Cadastro() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const acesso = useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    document.title = "Cadastrar organização · GestorGov";
  }, []);

  const senhaCurta = senha.length > 0 && senha.length < SENHA_MINIMA;
  const naoConfere = confirmar.length > 0 && confirmar !== senha;

  async function cadastrar(e: FormEvent) {
    e.preventDefault();
    if (senha.length < SENHA_MINIMA || senha !== confirmar) return;
    setErro(null);
    setEnviando(true);
    try {
      await api("/cadastro", { method: "POST", body: JSON.stringify({ nome: nome.trim(), email: email.trim(), senha }) });
      await qc.refetchQueries({ queryKey: ["acesso"] });
      navegar({ to: "/implantacao" });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível cadastrar agora.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <FormularioCentral
        titulo="Cadastrar organização"
        descricao="Para Secretarias de Saúde e empresas. Crie a conta de quem vai implantar; em seguida, o Assistente de Implantação monta a organização com você."
      >
        {acesso.data && !acesso.data.aceita_senha && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-text">
            O cadastro não está ligado neste servidor (falta a OS_SECURITY_KEY).
          </p>
        )}
        <form onSubmit={cadastrar} className="space-y-4" noValidate>
          <Campo id="nome" rotulo="Seu nome completo">
            <Input id="nome" autoComplete="name" required autoFocus minLength={2} value={nome} onChange={(e) => setNome(e.target.value)} className="h-11" />
          </Campo>
          <Campo id="email" rotulo="E-mail institucional" ajuda="De preferência o e-mail institucional (ex.: saude@municipio.rj.gov.br ou voce@empresa.com.br).">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </Campo>
          <Campo id="senha" rotulo="Senha" ajuda={`Pelo menos ${SENHA_MINIMA} caracteres.`}>
            <CampoSenha
              id="senha"
              autoComplete="new-password"
              required
              aria-invalid={senhaCurta || undefined}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="h-11"
            />
          </Campo>
          <Campo id="confirmar" rotulo="Confirme a senha">
            <CampoSenha
              id="confirmar"
              autoComplete="new-password"
              required
              aria-invalid={naoConfere || undefined}
              aria-describedby={naoConfere ? "confirmar-erro" : undefined}
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              className="h-11"
            />
            {naoConfere && (
              <p id="confirmar-erro" className="text-xs text-destructive">
                As senhas não conferem.
              </p>
            )}
          </Campo>
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={enviando || nome.trim().length < 2 || !email.includes("@") || senha.length < SENHA_MINIMA || senha !== confirmar}
          >
            {enviando ? <Loader2 className="animate-spin" /> : <Rocket />}
            Cadastrar e começar a implantação
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link to="/entrar" className="inline-flex items-center gap-1 font-semibold text-primary-text hover:underline">
            <LogIn className="size-3.5" /> Entrar
          </Link>
        </p>
      </FormularioCentral>
    </>
  );
}
