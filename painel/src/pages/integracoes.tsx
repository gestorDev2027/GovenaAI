import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Brain,
  Check,
  CircleAlert,
  Database,
  Globe,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  Plug,
  Plus,
  ServerCog,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDataHora } from "@/lib/formato";
import { usePodeNaOrganizacao } from "@/hooks/use-permissoes";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Slideover } from "@/components/comando/slideover";
import { EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";
import { Table, TableCell, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";

/*
 * Central de integrações (CLAUDE.md, §5b): bancos de outros sistemas, APIs, servidores MCP e a memória compartilhada
 * viram ferramentas dos agentes. Cada agente usa só as liberadas na ficha dele (Agentes). O segredo (senha, chave) é
 * só enviado: vai para o cofre (Vault) e nunca volta para a tela. Ferramenta que altera dados vira um pedido que uma
 * pessoa aprova aqui antes de rodar. Toda chamada fica na auditoria, sem os dados.
 */

type Tipo = "postgres" | "mysql" | "http" | "mcp" | "memoria";
interface Parametro {
  nome: string;
  tipo: "string" | "integer" | "float" | "boolean";
  descricao: string;
  obrigatorio: boolean;
  local?: "query" | "body";
}
interface Ferramenta {
  id: string;
  nome: string;
  descricao: string;
  sql: string | null;
  metodo: string | null;
  caminho: string | null;
  corpo: string | null;
  parametros: Parametro[];
  altera_dados: boolean;
  ativa: boolean;
}
interface Integracao {
  id: string;
  nome: string;
  descricao: string;
  tipo: Tipo;
  endereco: string | null;
  porta: number | null;
  banco: string | null;
  usuario: string | null;
  config: Record<string, unknown>;
  nosso_banco: boolean;
  hosts_liberados: string[];
  tem_segredo: boolean;
  segredo_final: string | null;
  situacao: "ativa" | "pausada";
  limite_por_minuto: number;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
  ultimo_teste_detalhe: string | null;
  ferramentas: Ferramenta[];
  agentes: string[];
}
interface Resposta {
  integracoes: Integracao[];
  tipos: { id: Tipo; nome: string }[];
  toolbox: { ligado: boolean; texto: string };
  memoria: string | null;
  pode_nosso_banco: boolean;
  pedidos: number;
}
interface Chamada {
  id: number;
  ferramenta: string;
  agente_id: string | null;
  quem: string;
  em: string;
  situacao: "ok" | "erro" | "recusada" | "aguardando_aprovacao" | "negada";
  duracao_ms: number | null;
  detalhe: string | null;
  decidido_por: string | null;
}
interface Pedido extends Chamada {
  argumentos: Record<string, unknown> | null;
}

const ICONES: Record<Tipo, typeof Plug> = { postgres: Database, mysql: Database, http: Globe, mcp: ServerCog, memoria: Brain };
const SITUACAO_CHAMADA: Record<Chamada["situacao"], [string, string]> = {
  ok: ["Ok", "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"],
  erro: ["Erro", "bg-red-500/12 text-red-700 dark:text-red-300"],
  recusada: ["Recusada", "bg-amber-500/15 text-amber-800 dark:text-amber-200"],
  aguardando_aprovacao: ["Aguardando aprovação", "bg-primary/10 text-primary-text"],
  negada: ["Negada", "bg-secondary text-muted-foreground"],
};

const chave = ["organizacao-integracoes"];

export function Integracoes() {
  const pode = usePodeNaOrganizacao();
  const dados = useQuery({ queryKey: chave, queryFn: () => api<Resposta>("/organizacao/integracoes"), enabled: pode("gerenciar_integracoes") });
  const [editando, setEditando] = useState<Integracao | "nova" | null>(null);
  const [ferramenta, setFerramenta] = useState<{ integ: Integracao; f: Ferramenta | null } | null>(null);
  const lista = dados.data?.integracoes ?? [];

  if (!pode("gerenciar_integracoes")) {
    return (
      <div className="space-y-5 px-4 pb-8 sm:px-8">
        <PageHeader title="Integrações" icon={Plug} />
        <div className="surface-card">
          <EmptyState title="Sem permissão">Seu cargo não tem a permissão "Gerenciar as integrações". Fale com o dono da organização.</EmptyState>
        </div>
        {pode("aprovar_entregas") && <Pedidos />}
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Integrações"
        icon={Plug}
        description="Bancos, APIs, servidores MCP e a memória viram ferramentas dos agentes. Cada agente usa só as liberadas na ficha dele."
        actions={
          <Button onClick={() => setEditando("nova")}>
            <Plus /> Nova integração
          </Button>
        }
      />
      {dados.isLoading && <PageLoader className="h-[40vh]" label="Abrindo a Central de integrações" />}
      {dados.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível abrir as integrações">{(dados.error as Error).message}</EmptyState>
        </div>
      )}
      {dados.data && (
        <>
          <div className="surface-card flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className={cn("grid size-9 place-items-center rounded-full", dados.data.toolbox.ligado ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground")}>
              <ServerCog className="size-4" aria-hidden="true" />
            </span>
            <p className="min-w-0 flex-1">
              <span className="font-semibold">MCP Toolbox: </span>
              {dados.data.toolbox.texto}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> Segredos no cofre (Vault): nunca voltam para a tela nem para o agente.
            </p>
          </div>

          {pode("aprovar_entregas") && <Pedidos />}

          {!lista.length && (
            <div className="surface-card">
              <EmptyState icon={<Plug className="size-5" />} title="Nenhuma integração ainda">
                Cadastre o banco ou a API de um sistema que a organização já usa. Depois, libere a integração na ficha do agente, em{" "}
                <Link to="/agentes" className="font-semibold text-primary-text hover:underline">
                  Agentes
                </Link>
                .
              </EmptyState>
            </div>
          )}
          <ul className="grid gap-3 lg:grid-cols-2">
            {lista.map((i) => (
              <CartaoIntegracao key={i.id} integ={i} aoEditar={() => setEditando(i)} aoFerramenta={(f) => setFerramenta({ integ: i, f })} />
            ))}
          </ul>
          <Chamadas />
        </>
      )}
      {editando && dados.data && (
        <FormIntegracao integ={editando === "nova" ? null : editando} catalogo={dados.data} aoFechar={() => setEditando(null)} />
      )}
      {ferramenta && <FormFerramenta integ={ferramenta.integ} ferramenta={ferramenta.f} aoFechar={() => setFerramenta(null)} />}
    </div>
  );
}

function CartaoIntegracao({ integ, aoEditar, aoFerramenta }: { integ: Integracao; aoEditar: () => void; aoFerramenta: (f: Ferramenta | null) => void }) {
  const qc = useQueryClient();
  const Icone = ICONES[integ.tipo];
  const testar = useMutation({
    mutationFn: () => api<{ ok: boolean; detalhe: string }>(`/organizacao/integracoes/${integ.id}/testar`, { method: "POST" }),
    onSuccess: (r) => {
      (r.ok ? toast.success : toast.error)(r.ok ? "Conexão funcionando" : "A conexão falhou", { description: r.detalhe });
      qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e: Error) => toast.error("Não foi possível testar", { description: e.message }),
  });
  const temFerramentas = integ.tipo !== "memoria";
  return (
    <li className="surface-card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-text">
          <Icone className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{integ.nome}</span>
            <Selo>{integ.tipo}</Selo>
            {integ.situacao === "pausada" && <Selo>pausada</Selo>}
            {integ.nosso_banco && <Selo>banco do GestorGov (só leitura)</Selo>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {integ.endereco ?? (integ.tipo === "memoria" ? `Memória da ${String(integ.config.escopo) === "area" ? "área de cada agente" : "organização"}` : "")}
            {integ.porta ? `:${integ.porta}` : ""}
            {integ.banco ? ` · ${integ.banco}` : ""}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <KeyRound className="size-3" aria-hidden="true" />
              {integ.tem_segredo ? `Segredo no cofre${integ.segredo_final ? ` (termina em ${integ.segredo_final})` : ""}` : "Sem segredo"}
            </span>
            <span>{integ.limite_por_minuto} chamadas/min</span>
            <span>{integ.agentes.length ? `Liberada para ${integ.agentes.length} agente(s)` : "Nenhum agente liberado"}</span>
          </p>
          {integ.ultimo_teste_em && (
            <p className={cn("mt-1 flex items-start gap-1 text-[11px]", integ.ultimo_teste_ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")}>
              {integ.ultimo_teste_ok ? <Check className="mt-px size-3 shrink-0" /> : <CircleAlert className="mt-px size-3 shrink-0" />}
              <span>
                Teste de {fmtDataHora(integ.ultimo_teste_em)}: {integ.ultimo_teste_detalhe}
              </span>
            </p>
          )}
        </div>
      </div>
      {temFerramentas && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Ferramentas</p>
          {!integ.ferramentas.length && <p className="text-xs text-muted-foreground">Nenhuma ainda: sem ferramenta, a integração não aparece para os agentes.</p>}
          <ul className="space-y-1">
            {integ.ferramentas.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => aoFerramenta(f)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-left text-sm hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring outline-none"
                >
                  <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.nome}</span>
                  {f.altera_dados && <Selo>altera dados: pede aprovação</Selo>}
                  {!f.ativa && <Selo>desligada</Selo>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => testar.mutate()} disabled={testar.isPending}>
          {testar.isPending ? <Loader2 className="animate-spin" /> : <Play />} Testar conexão
        </Button>
        {temFerramentas && (
          <Button variant="outline" size="sm" onClick={() => aoFerramenta(null)}>
            <Plus /> Ferramenta
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={aoEditar}>
          <Pencil /> Editar
        </Button>
      </div>
    </li>
  );
}

function Selo({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{children}</span>;
}

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{rotulo}</span>
      {children}
      {dica && <span className="block text-[11px] text-muted-foreground">{dica}</span>}
    </label>
  );
}

const seletor = "h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm";

function FormIntegracao({ integ, catalogo, aoFechar }: { integ: Integracao | null; catalogo: Resposta; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<Tipo>(integ?.tipo ?? "http");
  const [f, setF] = useState({
    nome: integ?.nome ?? "",
    descricao: integ?.descricao ?? "",
    endereco: integ?.endereco ?? "",
    porta: integ?.porta ? String(integ.porta) : "",
    banco: integ?.banco ?? "",
    usuario: integ?.usuario ?? "",
    hosts: (integ?.hosts_liberados ?? []).join(", "),
    limite: String(integ?.limite_por_minuto ?? 30),
    situacao: integ?.situacao ?? "ativa",
    segredo: "",
    cabecalho: String(integ?.config.cabecalho_segredo ?? "Authorization"),
    prefixo: String(integ?.config.prefixo_segredo ?? "Bearer "),
    sslmode: String(integ?.config.sslmode ?? "require"),
    escopo: String(integ?.config.escopo ?? "organizacao"),
    nosso_banco: integ?.nosso_banco ?? false,
  });
  const muda = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const banco = tipo === "postgres" || tipo === "mysql";
  const web = tipo === "http" || tipo === "mcp";
  const salvar = useMutation({
    mutationFn: () => {
      const corpo: Record<string, unknown> = {
        tipo,
        nome: f.nome,
        descricao: f.descricao,
        limite_por_minuto: Number(f.limite) || 30,
        situacao: f.situacao,
        nosso_banco: f.nosso_banco,
      };
      if (tipo === "memoria") corpo.config = { escopo: f.escopo };
      else if (!f.nosso_banco) {
        corpo.endereco = f.endereco;
        corpo.hosts_liberados = f.hosts.split(/[\s,]+/).filter(Boolean);
        if (banco) Object.assign(corpo, { porta: Number(f.porta) || undefined, banco: f.banco, usuario: f.usuario, config: { sslmode: f.sslmode } });
        if (web) corpo.config = { cabecalho_segredo: f.cabecalho, prefixo_segredo: f.prefixo };
        if (f.segredo.trim()) corpo.segredo = f.segredo.trim();
      }
      return api<Integracao>(integ ? `/organizacao/integracoes/${integ.id}` : "/organizacao/integracoes", {
        method: integ ? "PUT" : "POST",
        body: JSON.stringify(corpo),
      });
    },
    onSuccess: () => {
      toast.success(integ ? "Integração salva" : "Integração cadastrada");
      setF((x) => ({ ...x, segredo: "" }));
      qc.invalidateQueries({ queryKey: chave });
      qc.invalidateQueries({ queryKey: ["organizacao-agentes"] });
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });
  const excluir = useMutation({
    mutationFn: () => api(`/organizacao/integracoes/${integ!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Integração excluída (e o segredo, apagado do cofre)");
      qc.invalidateQueries({ queryKey: chave });
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };

  return (
    <Slideover
      titulo={integ ? integ.nome : "Nova integração"}
      subtitulo={integ ? catalogo.tipos.find((t) => t.id === integ.tipo)?.nome : "Um sistema externo que os agentes vão usar"}
      aoFechar={aoFechar}
      rodape={
        <div className="flex items-center justify-between gap-2">
          {integ ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.confirm(`Excluir a integração ${integ.nome}? O segredo é apagado do cofre.`) && excluir.mutate()}
              disabled={excluir.isPending}
            >
              <Trash2 /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" form="form-integracao" disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : <Check />} Salvar
          </Button>
        </div>
      }
    >
      <form id="form-integracao" onSubmit={enviar} className="space-y-4">
        {!integ && (
          <Campo rotulo="Tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={seletor}>
              {catalogo.tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo rotulo="Nome">
          <Input value={f.nome} onChange={muda("nome")} required maxLength={80} placeholder="Ex.: Sistema de estoque da farmácia" />
        </Campo>
        <Campo rotulo="Descrição (opcional)">
          <Textarea value={f.descricao} onChange={muda("descricao")} rows={2} maxLength={500} />
        </Campo>
        {tipo === "postgres" && catalogo.pode_nosso_banco && (
          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input type="checkbox" checked={f.nosso_banco} onChange={(e) => setF((x) => ({ ...x, nosso_banco: e.target.checked }))} className="mt-0.5" />
            <span>
              Banco do próprio GestorGov (equipe da plataforma)
              <span className="block text-[11px] text-muted-foreground">Só leitura; cada consulta filtra a organização com $1, que o servidor preenche.</span>
            </span>
          </label>
        )}
        {tipo === "memoria" && (
          <>
            {catalogo.memoria && (
              <p className="rounded-lg bg-amber-500/12 p-3 text-xs text-amber-900 dark:text-amber-100">{catalogo.memoria}</p>
            )}
            <Campo rotulo="De quem é a memória" dica="Vetores no banco do GestorGov; modelo e embeddings no Gemini. Nunca guarda dado de paciente ou de cliente.">
              <select value={f.escopo} onChange={muda("escopo")} className={seletor}>
                <option value="organizacao">Da organização inteira (todos os agentes liberados leem)</option>
                <option value="area">De cada área (os agentes da mesma área dividem)</option>
              </select>
            </Campo>
          </>
        )}
        {(banco || web) && !f.nosso_banco && (
          <>
            <Campo rotulo={web ? "Endereço (https://)" : "Host do banco"} dica={web ? "Para MCP, o endereço completo do servidor (ex.: https://mcp.exemplo.gov.br/mcp)." : "Só o nome do host, sem protocolo nem porta."}>
              <Input value={f.endereco} onChange={muda("endereco")} required placeholder={web ? "https://api.sistema.gov.br" : "banco.sistema.gov.br"} />
            </Campo>
            {banco && (
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Porta">
                  <Input value={f.porta} onChange={muda("porta")} inputMode="numeric" placeholder={tipo === "postgres" ? "5432" : "3306"} />
                </Campo>
                <Campo rotulo="Banco">
                  <Input value={f.banco} onChange={muda("banco")} required />
                </Campo>
                <Campo rotulo="Usuário">
                  <Input value={f.usuario} onChange={muda("usuario")} required autoComplete="off" />
                </Campo>
                {tipo === "postgres" && (
                  <Campo rotulo="SSL">
                    <select value={f.sslmode} onChange={muda("sslmode")} className={seletor}>
                      {["require", "verify-full", "verify-ca", "prefer"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Campo>
                )}
              </div>
            )}
            {web && (
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Cabeçalho da chave">
                  <Input value={f.cabecalho} onChange={muda("cabecalho")} />
                </Campo>
                <Campo rotulo="Prefixo">
                  <Input value={f.prefixo} onChange={muda("prefixo")} placeholder="Bearer " />
                </Campo>
              </div>
            )}
            <Campo
              rotulo={banco ? "Senha do banco" : "Chave da API"}
              dica={
                integ?.tem_segredo
                  ? `Já há um segredo no cofre${integ.segredo_final ? ` (termina em ${integ.segredo_final})` : ""}. Deixe vazio para manter.`
                  : "Vai direto para o cofre (Vault) e nunca é mostrada de volta."
              }
            >
              <Input type="password" value={f.segredo} onChange={muda("segredo")} autoComplete="new-password" />
            </Campo>
            <Campo rotulo="Hosts liberados" dica="Separados por vírgula. O host do endereço precisa estar aqui; rede interna é sempre recusada.">
              <Input value={f.hosts} onChange={muda("hosts")} placeholder="api.sistema.gov.br" />
            </Campo>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Limite (chamadas por minuto)">
            <Input value={f.limite} onChange={muda("limite")} inputMode="numeric" />
          </Campo>
          <Campo rotulo="Situação">
            <select value={f.situacao} onChange={muda("situacao")} className={seletor}>
              <option value="ativa">Ativa</option>
              <option value="pausada">Pausada</option>
            </select>
          </Campo>
        </div>
      </form>
    </Slideover>
  );
}

const PARAMETRO_VAZIO: Parametro = { nome: "", tipo: "string", descricao: "", obrigatorio: true, local: "query" };

function FormFerramenta({ integ, ferramenta, aoFechar }: { integ: Integracao; ferramenta: Ferramenta | null; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    nome: ferramenta?.nome ?? "",
    descricao: ferramenta?.descricao ?? "",
    sql: ferramenta?.sql ?? "",
    metodo: ferramenta?.metodo ?? "GET",
    caminho: ferramenta?.caminho ?? "/",
    corpo: ferramenta?.corpo ?? "",
    altera_dados: ferramenta?.altera_dados ?? false,
    ativa: ferramenta?.ativa ?? true,
  });
  const [parametros, setParametros] = useState<Parametro[]>(ferramenta?.parametros ?? []);
  const [teste, setTeste] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<string | null>(null);
  const muda = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const banco = integ.tipo === "postgres" || integ.tipo === "mysql";
  const base = `/organizacao/integracoes/${integ.id}/ferramentas`;
  const salvar = useMutation({
    mutationFn: () =>
      api<Ferramenta>(ferramenta ? `${base}/${ferramenta.id}` : base, {
        method: ferramenta ? "PUT" : "POST",
        body: JSON.stringify({ ...f, parametros: parametros.filter((p) => p.nome.trim()) }),
      }),
    onSuccess: (r) => {
      toast.success(r.altera_dados ? "Ferramenta salva: altera dados, então cada chamada espera aprovação" : "Ferramenta salva");
      qc.invalidateQueries({ queryKey: chave });
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });
  const excluir = useMutation({
    mutationFn: () => api(`${base}/${ferramenta!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chave });
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });
  const testar = useMutation({
    mutationFn: () => api<{ resultado: string }>(`${base}/${ferramenta!.id}/testar`, { method: "POST", body: JSON.stringify({ argumentos: teste }) }),
    onSuccess: (r) => setResultado(r.resultado),
    onError: (e: Error) => toast.error("O teste falhou", { description: e.message }),
  });
  const alterarParametro = (i: number, mudanca: Partial<Parametro>) => setParametros((ps) => ps.map((p, j) => (j === i ? { ...p, ...mudanca } : p)));

  return (
    <Slideover
      titulo={ferramenta ? ferramenta.nome : "Nova ferramenta"}
      subtitulo={integ.nome}
      aoFechar={aoFechar}
      rodape={
        <div className="flex items-center justify-between gap-2">
          {ferramenta ? (
            <Button variant="ghost" size="sm" onClick={() => window.confirm(`Excluir a ferramenta ${ferramenta.nome}?`) && excluir.mutate()}>
              <Trash2 /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" form="form-ferramenta" disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : <Check />} Salvar
          </Button>
        </div>
      }
    >
      <form
        id="form-ferramenta"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate();
        }}
        className="space-y-4"
      >
        <Campo rotulo="Nome" dica={integ.tipo === "mcp" ? "O nome da ferramenta no servidor MCP (o teste de conexão lista as oferecidas)." : "Letras minúsculas, números e _ (ex.: estoque_por_item)."}>
          <Input value={f.nome} onChange={muda("nome")} required className="font-mono" />
        </Campo>
        <Campo rotulo="Descrição" dica="É por ela que o agente decide quando usar a ferramenta (20 a 1.500 caracteres).">
          <Textarea value={f.descricao} onChange={muda("descricao")} rows={3} required />
        </Campo>
        {banco && (
          <Campo rotulo="Consulta SQL" dica={integ.nosso_banco ? "Filtre a organização com $1 (o servidor preenche). Os parâmetros abaixo são $2, $3..." : `Os parâmetros entram na ordem: ${integ.tipo === "mysql" ? "?" : "$1, $2..."}. Um comando só.`}>
            <Textarea value={f.sql} onChange={muda("sql")} rows={5} required className="font-mono text-xs" />
          </Campo>
        )}
        {integ.tipo === "http" && (
          <>
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <Campo rotulo="Método">
                <select value={f.metodo} onChange={muda("metodo")} className={seletor}>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Caminho">
                <Input value={f.caminho} onChange={muda("caminho")} required className="font-mono" placeholder="/estoque" />
              </Campo>
            </div>
            <Campo rotulo="Corpo (opcional)" dica="Com {{.parametro}}. Vazio: os parâmetros do corpo vão como JSON.">
              <Textarea value={f.corpo} onChange={muda("corpo")} rows={3} className="font-mono text-xs" />
            </Campo>
          </>
        )}
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">Parâmetros (o agente preenche)</legend>
          {parametros.map((p, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border border-border p-2">
              <div className="flex gap-2">
                <Input aria-label="Nome do parâmetro" value={p.nome} onChange={(e) => alterarParametro(i, { nome: e.target.value })} placeholder="nome" className="font-mono" />
                <select aria-label="Tipo" value={p.tipo} onChange={(e) => alterarParametro(i, { tipo: e.target.value as Parametro["tipo"] })} className={cn(seletor, "w-28")}>
                  {["string", "integer", "float", "boolean"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                {integ.tipo === "http" && (
                  <select aria-label="Onde vai" value={p.local ?? "query"} onChange={(e) => alterarParametro(i, { local: e.target.value as "query" | "body" })} className={cn(seletor, "w-24")}>
                    <option value="query">query</option>
                    <option value="body">corpo</option>
                  </select>
                )}
                <Button type="button" variant="ghost" size="sm" aria-label="Tirar o parâmetro" onClick={() => setParametros((ps) => ps.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </div>
              <Input aria-label="Descrição do parâmetro" value={p.descricao} onChange={(e) => alterarParametro(i, { descricao: e.target.value })} placeholder="O que é (o agente lê)" />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={p.obrigatorio} onChange={(e) => alterarParametro(i, { obrigatorio: e.target.checked })} /> Obrigatório
              </label>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setParametros((ps) => [...ps, { ...PARAMETRO_VAZIO }])}>
            <Plus /> Parâmetro
          </Button>
        </fieldset>
        <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={f.altera_dados} onChange={(e) => setF((x) => ({ ...x, altera_dados: e.target.checked }))} className="mt-0.5" />
          <span>
            Altera dados no outro sistema
            <span className="block text-[11px] text-muted-foreground">
              Cada chamada vira um pedido que uma pessoa aprova antes de rodar. Comandos que gravam (INSERT, UPDATE, PUT, DELETE...) são marcados sempre.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativa} onChange={(e) => setF((x) => ({ ...x, ativa: e.target.checked }))} /> Ligada
        </label>
      </form>
      {ferramenta && !ferramenta.altera_dados && (
        <section className="mt-6 space-y-2 border-t border-border pt-4">
          <h3 className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Testar com valores</h3>
          {ferramenta.parametros.map((p) => (
            <Campo key={p.nome} rotulo={`${p.nome} (${p.tipo})`}>
              <Input value={teste[p.nome] ?? ""} onChange={(e) => setTeste((t) => ({ ...t, [p.nome]: e.target.value }))} />
            </Campo>
          ))}
          <Button variant="outline" size="sm" onClick={() => testar.mutate()} disabled={testar.isPending}>
            {testar.isPending ? <Loader2 className="animate-spin" /> : <Play />} Rodar o teste
          </Button>
          {resultado !== null && <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{resultado}</pre>}
        </section>
      )}
    </Slideover>
  );
}

function Pedidos() {
  const qc = useQueryClient();
  const pedidos = useQuery({ queryKey: ["organizacao-integracoes-pedidos"], queryFn: () => api<{ pedidos: Pedido[] }>("/organizacao/integracoes-pedidos") });
  const decidir = useMutation({
    mutationFn: ({ id, aprovar }: { id: number; aprovar: boolean }) =>
      api<{ situacao: string; detalhe?: string }>(`/organizacao/integracoes-pedidos/${id}`, { method: "POST", body: JSON.stringify({ aprovar }) }),
    onSuccess: (r) => {
      if (r.situacao === "ok") toast.success("Aprovado e executado");
      else if (r.situacao === "negada") toast.success("Pedido negado");
      else toast.error("Aprovado, mas a chamada falhou", { description: r.detalhe });
      qc.invalidateQueries({ queryKey: ["organizacao-integracoes-pedidos"] });
      qc.invalidateQueries({ queryKey: ["organizacao-integracoes-chamadas"] });
    },
    onError: (e: Error) => toast.error("Não foi possível decidir", { description: e.message }),
  });
  const lista = pedidos.data?.pedidos ?? [];
  if (!lista.length) return null;
  return (
    <section className="surface-card space-y-3 p-4" aria-labelledby="titulo-pedidos">
      <h2 id="titulo-pedidos" className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-4 text-primary-text" aria-hidden="true" /> Pedidos que alteram dados ({lista.length})
      </h2>
      <ul className="space-y-2">
        {lista.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs font-semibold">{p.ferramenta}</p>
              <p className="text-xs text-muted-foreground">
                {p.agente_id ? `Agente ${p.agente_id}` : p.quem} · {fmtDataHora(p.em)}
              </p>
              <pre className="mt-1 overflow-auto rounded bg-muted px-2 py-1 text-[11px] whitespace-pre-wrap">{JSON.stringify(p.argumentos ?? {}, null, 1)}</pre>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decidir.mutate({ id: p.id, aprovar: true })} disabled={decidir.isPending}>
                <Check /> Aprovar e rodar
              </Button>
              <Button size="sm" variant="outline" onClick={() => decidir.mutate({ id: p.id, aprovar: false })} disabled={decidir.isPending}>
                <X /> Negar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chamadas() {
  const dados = useQuery({ queryKey: ["organizacao-integracoes-chamadas"], queryFn: () => api<{ chamadas: Chamada[] }>("/organizacao/integracoes-chamadas?limite=50") });
  const lista = dados.data?.chamadas ?? [];
  return (
    <section className="space-y-2" aria-labelledby="titulo-chamadas">
      <h2 id="titulo-chamadas" className="text-sm font-semibold">
        Últimas chamadas <span className="font-normal text-muted-foreground">(auditoria, sem os dados)</span>
      </h2>
      {!lista.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma chamada ainda.</p>
      ) : (
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Ferramenta</TableHead>
                <TableHead>Quem</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Duração</TableHead>
              </TableRow>
            </TableHeader>
            <tbody>
              {lista.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap">{fmtDataHora(c.em)}</TableCell>
                  <TableCell className="font-mono text-xs">{c.ferramenta}</TableCell>
                  <TableCell className="text-xs">{c.agente_id ?? c.quem}</TableCell>
                  <TableCell>
                    <span title={c.detalhe ?? undefined} className={cn("rounded-full px-2 py-0.5 text-[11px]", SITUACAO_CHAMADA[c.situacao][1])}>
                      {SITUACAO_CHAMADA[c.situacao][0]}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">{c.duracao_ms != null ? `${c.duracao_ms} ms` : "—"}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      )}
    </section>
  );
}
