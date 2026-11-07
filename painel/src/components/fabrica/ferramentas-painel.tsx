import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Calendar,
  Globe,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  Plug,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, type ChaveApi, type ConfigHttp, type FerramentaPainel, type ParametroHttp, type SegredoFerramenta } from "@/lib/api";
import { FormChave, useLiberarHost } from "./chaves-hosts";
import { fmtDataHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import {
  CabecalhoOrdenavel,
  Chip,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
  useOrdenacao,
} from "@/components/ui/tabela";
import { EmptyState, PageLoader } from "@/components/widgets/widgets";
import { AssistenteIA } from "./assistente";
import { Selecao } from "./campos";
import { usePode } from "@/hooks/use-permissoes";

/*
 * Ferramentas do painel: chamadas HTTP de consulta que os agentes podem usar. Só https,
 * só os hosts liberados (aba Hosts liberados) e chave de acesso só pelo cofre (aba Chaves de API: o valor
 * nunca passa pelo painel). Dá para testar a ferramenta antes de salvar.
 */

const ID_FERRAMENTA = /^[a-z0-9-]{3,40}$/;
const idDe = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

type RespostaFerramentas = { ferramentas: FerramentaPainel[]; hosts_permitidos: string[]; chaves: ChaveApi[] };

export const useFerramentasPainel = () =>
  useQuery({ queryKey: ["fabrica-ferramentas"], queryFn: () => api<RespostaFerramentas>("/fabrica/ferramentas") });

function useAtualizarFerramentas() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["fabrica-ferramentas"] });
    qc.invalidateQueries({ queryKey: ["fabrica-opcoes"] });
    qc.invalidateQueries({ queryKey: ["fabrica-agentes"] });
  };
}

const hostDe = (url: string) => {
  try {
    return new URL(url.replace(/\{[^}]*\}/g, "x")).host;
  } catch {
    return url;
  }
};

/** Os hosts liberados; vazio quer dizer que nenhuma ferramenta pode ser chamada ainda. */
function HostsPermitidos({ hosts }: { hosts: string[] }) {
  if (!hosts.length)
    return (
      <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          Nenhum host liberado ainda. Enquanto a lista estiver vazia, nenhuma ferramenta HTTP pode ser salva ou testada. Libere na aba Hosts
          liberados ou pelo botão que aparece junto do endereço.
        </span>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <ShieldCheck className="size-3.5 text-success" /> Hosts liberados:
      {hosts.map((h) => (
        <code key={h} className="num rounded bg-muted px-1.5 py-0.5 text-foreground">
          {h}
        </code>
      ))}
    </div>
  );
}

export function TabelaFerramentas({ nomeAgente }: { nomeAgente: (id: string) => string }) {
  const dados = useFerramentasPainel();
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<FerramentaPainel | "nova" | null>(null);
  const { chave, direcao, alternar } = useOrdenacao<"nome" | "atualizado">("nome", "asc");
  const lista = dados.data?.ferramentas ?? [];

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const sinal = direcao === "asc" ? 1 : -1;
    return lista
      .filter((f) => !termo || [f.nome, f.id, f.descricao, f.config.url].some((t) => t.toLowerCase().includes(termo)))
      .sort(
        (a, b) => (chave === "nome" ? a.nome.localeCompare(b.nome) : (a.atualizado_em ?? "").localeCompare(b.atualizado_em ?? "")) * sinal,
      );
  }, [lista, busca, chave, direcao]);
  const paginacao = usePaginacao(visiveis);

  if (dados.isLoading) return <PageLoader className="h-[50vh]" label="Carregando as ferramentas" />;
  if (dados.isError)
    return (
      <div className="surface-card">
        <EmptyState title="Não foi possível carregar as ferramentas">{(dados.error as Error).message}</EmptyState>
      </div>
    );

  return (
    <div className="space-y-3">
      <HostsPermitidos hosts={dados.data!.hosts_permitidos} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, descrição ou endereço"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Button className="ml-auto" onClick={() => setAberta("nova")}>
          <Plus /> Nova ferramenta
        </Button>
      </div>

      <TableWrapper className="max-h-[calc(100dvh-20rem)]">
        <Table className="min-w-[1080px]">
          <TableHeader>
            <tr>
              <TableHead>
                <CabecalhoOrdenavel
                  rotulo="Ferramenta"
                  campo="nome"
                  chaveAtiva={chave}
                  direcao={direcao}
                  onAlternar={alternar}
                  icone={Plug}
                />
              </TableHead>
              <TableHead icone={Globe}>Endereço</TableHead>
              <TableHead icone={KeyRound}>Chave</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead icone={Bot}>Agentes</TableHead>
              <TableHead>
                <CabecalhoOrdenavel
                  rotulo="Atualizada"
                  campo="atualizado"
                  chaveAtiva={chave}
                  direcao={direcao}
                  onAlternar={alternar}
                  icone={Calendar}
                />
              </TableHead>
              <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {visiveis.length === 0 && (
              <TableEmpty colSpan={7}>
                {lista.length ? "Nenhuma ferramenta com essa busca." : "Nenhuma ferramenta ainda. Crie a primeira em “Nova ferramenta”."}
              </TableEmpty>
            )}
            {paginacao.itens.map((f) => (
              <TableRow key={f.id} onClick={() => setAberta(f)} className="group cursor-pointer">
                <TableCell>
                  <div className="font-semibold">{f.nome}</div>
                  <div className="max-w-72 truncate text-xs text-muted-foreground" title={f.descricao}>
                    {f.descricao}
                  </div>
                </TableCell>
                <TableCell>
                  <code className="num text-xs">
                    <span className="mr-1 font-semibold">{f.config.metodo}</span>
                    {hostDe(f.config.url)}
                  </code>
                </TableCell>
                <TableCell>
                  {f.config.segredo ? (
                    <code className="num text-xs">{f.config.segredo.chave}</code>
                  ) : (
                    <span className="text-xs text-muted-foreground">sem chave</span>
                  )}
                </TableCell>
                <TableCell>
                  <Chip tom={f.ativa ? "sucesso" : "neutro"}>{f.ativa ? "Ativa" : "Desligada"}</Chip>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {f.agentes.length ? (
                      f.agentes.map((a) => (
                        <span key={a} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {nomeAgente(a)}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">nenhum</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div>{fmtDataHora(f.atualizado_em)}</div>
                  {f.atualizado_por && <div className="text-xs text-muted-foreground">{f.atualizado_por}</div>}
                </TableCell>
                <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <Button size="icon" variant="ghost" title="Editar" aria-label="Editar" onClick={() => setAberta(f)}>
                      <Pencil />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
      <Paginacao {...paginacao} />

      <FormFerramenta
        ferramenta={aberta === "nova" ? null : aberta}
        aberto={aberta !== null}
        aoFechar={() => setAberta(null)}
        nomeAgente={nomeAgente}
      />
    </div>
  );
}

/* ───────── Formulário ───────── */

const HTTP_VAZIO: ConfigHttp = { metodo: "GET", url: "https://", parametros: [], cabecalhos: [], segredo: null, timeout_s: 15 };

type Estado = {
  id: string;
  idEditado: boolean;
  nome: string;
  descricao: string;
  ativa: boolean;
  http: ConfigHttp;
};

export function FormFerramenta({
  ferramenta,
  aberto,
  aoFechar,
  aoCriar,
  nomeAgente,
}: {
  ferramenta: FerramentaPainel | null;
  aberto: boolean;
  aoFechar: () => void;
  aoCriar?: (f: FerramentaPainel) => void;
  nomeAgente: (id: string) => string;
}) {
  const dados = useFerramentasPainel();
  const hosts = dados.data?.hosts_permitidos ?? [];
  const chaves = dados.data?.chaves ?? [];
  const liberar = useLiberarHost();
  const [criandoChave, setCriandoChave] = useState(false);
  const atualizar = useAtualizarFerramentas();
  const nova = ferramenta === null;
  const pode = usePode();

  const vazio: Estado = { id: "", idEditado: false, nome: "", descricao: "", ativa: true, http: HTTP_VAZIO };
  const [f, setF] = useState<Estado>(vazio);
  const [resultado, setResultado] = useState<string | null>(null);
  useEffect(() => {
    if (!aberto) return;
    setResultado(null);
    setF(
      ferramenta
        ? {
            id: ferramenta.id,
            idEditado: true,
            nome: ferramenta.nome,
            descricao: ferramenta.descricao,
            ativa: ferramenta.ativa,
            http: ferramenta.config,
          }
        : vazio,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, ferramenta]);

  const id = nova && !f.idEditado ? idDe(f.nome) : f.id;
  const config = f.http;
  const corpo = { tipo: "http" as const, nome: f.nome.trim(), descricao: f.descricao.trim(), config, ativa: f.ativa };
  const hostDaUrl = hostDe(config.url);
  const urlForaDaLista = config.url.startsWith("https://") && hostDaUrl.includes(".") && !hosts.includes(hostDaUrl);
  const problemas = [
    nova && !ID_FERRAMENTA.test(id) && "O identificador tem de 3 a 40 caracteres: minúsculas, números e hífen.",
    !f.nome.trim() && "Falta o nome.",
    f.descricao.trim().length < 20 &&
      "A descrição precisa dizer ao agente o que a ferramenta devolve e quando usar (20 caracteres ou mais).",
    !config.url.startsWith("https://") && "Só endereços https.",
    urlForaDaLista && "O host do endereço não está na lista liberada.",
  ].filter(Boolean) as string[];

  const salvar = useMutation({
    mutationFn: () =>
      nova
        ? api<FerramentaPainel>("/fabrica/ferramentas", { method: "POST", body: JSON.stringify({ id, ...corpo }) })
        : api<FerramentaPainel>(`/fabrica/ferramentas/${encodeURIComponent(ferramenta.id)}`, {
            method: "PUT",
            body: JSON.stringify(corpo),
          }),
    onSuccess: (x) => {
      atualizar();
      toast.success(nova ? `Ferramenta ${x.nome} criada` : `Ferramenta ${x.nome} salva`, {
        description: x.agentes?.length ? `Já vale para ${x.agentes.map(nomeAgente).join(", ")}.` : "Marque-a nos agentes que devem usá-la.",
      });
      if (nova) aoCriar?.(x);
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar a ferramenta", { description: e.message }),
  });
  const excluir = useMutation({
    mutationFn: () => api(`/fabrica/ferramentas/${encodeURIComponent(ferramenta!.id)}`, { method: "DELETE" }),
    onSuccess: () => {
      atualizar();
      toast.success("Ferramenta excluída");
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  const mudaHttp = (parte: Partial<ConfigHttp>) => setF((x) => ({ ...x, http: { ...x.http, ...parte } }));

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      largura="2xl"
      corpo="livre"
      rotulo="Ferramenta do painel"
      icone={<Plug />}
      titulo={nova ? "Nova ferramenta" : ferramenta.nome}
      descricao="Uma consulta HTTP que os agentes podem chamar. Teste antes de salvar."
      rodape={
        <>
          {!nova && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={excluir.isPending || ferramenta.agentes.length > 0 || !pode("excluir")}
              title={!pode("excluir") ? "Sem a permissão Excluir" : ferramenta.agentes.length ? "Tire a ferramenta dos agentes antes de excluir." : undefined}
              onClick={() => window.confirm(`Excluir a ferramenta ${ferramenta.nome}?`) && excluir.mutate()}
            >
              <Trash2 /> Excluir
            </Button>
          )}
          {problemas.length > 0 && <span className="max-w-md text-xs text-muted-foreground">{problemas[0]}</span>}
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={problemas.length > 0 || salvar.isPending} onClick={() => salvar.mutate()}>
            <Save /> {nova ? "Criar ferramenta" : "Salvar"}
          </Button>
        </>
      }
    >
      <div className="grid min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_28rem] lg:grid-rows-1">
        <div className="thin-scroll min-h-0 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <HostsPermitidos hosts={hosts} />

          <SecaoPainel titulo="Ferramenta">
            <div className="grid gap-4 md:grid-cols-2">
              <Campo rotulo="Nome">
                <Input
                  value={f.nome}
                  maxLength={120}
                  placeholder="Ex.: Boletos em aberto"
                  onChange={(e) => setF({ ...f, nome: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Identificador" ajuda={nova ? "Não muda depois de criada." : undefined}>
                <Input
                  className="num"
                  value={id}
                  disabled={!nova}
                  maxLength={40}
                  onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase(), idEditado: true })}
                />
              </Campo>
            </div>
            <Campo
              rotulo="Descrição para o agente"
              ajuda="O que a ferramenta devolve e quando usar. O agente decide chamá-la por este texto."
            >
              <Textarea rows={3} value={f.descricao} maxLength={3000} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
            </Campo>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.ativa}
                onChange={(e) => setF({ ...f, ativa: e.target.checked })}
                className="size-4 accent-[var(--color-primary)]"
              />
              Ativa (desligada, nenhum agente a recebe)
            </label>
          </SecaoPainel>

          {urlForaDaLista && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              <AlertTriangle className="size-4 shrink-0 text-warning" />
              <span className="flex-1">
                O host <code className="num font-semibold">{hostDaUrl}</code> ainda não está liberado: sem ele, a ferramenta não pode ser
                salva nem testada.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={liberar.isPending}
                onClick={() => liberar.mutate({ host: hostDaUrl, descricao: f.nome.trim() })}
              >
                {liberar.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Liberar este host
              </Button>
            </div>
          )}

          <ConfigHttpCampos config={f.http} muda={mudaHttp} chaves={chaves} aoNovaChave={() => setCriandoChave(true)} />
        </div>
        <div className="thin-scroll min-h-0 space-y-6 overflow-y-auto border-t border-border bg-muted/20 px-5 py-5 sm:px-6 lg:border-t-0 lg:border-l">
          <AssistenteIA<{ id: string; nome: string; descricao: string; config: ConfigHttp }>
            tipo="ferramenta_http"
            titulo="Montar com IA a partir da documentação"
            ajuda="Cole a documentação da API ou um comando curl. A IA monta endereço, parâmetros e chave; depois use Testar. Nenhuma chave colada é copiada."
            placeholder={'Ex.: curl "https://api.exemplo.gov.br/v1/unidades/{cnes}/estoque?situacao=baixo" -H "Authorization: Bearer …"'}
            aberto={nova}
            aoReceber={(r) =>
              setF((x) => ({
                ...x,
                id: nova ? r.id : x.id,
                idEditado: nova ? true : x.idEditado,
                nome: r.nome,
                descricao: r.descricao,
                http: { ...HTTP_VAZIO, ...r.config },
              }))
            }
          />

          <Testar corpo={corpo} config={config} resultado={resultado} aoResultado={setResultado} />
        </div>
      </div>
      <FormChave
        chave={null}
        aberto={criandoChave}
        aoFechar={() => setCriandoChave(false)}
        aoCriar={(c) =>
          mudaHttp({
            segredo: {
              chave: c.nome,
              cabecalho: f.http.segredo?.cabecalho ?? "Authorization",
              prefixo: f.http.segredo?.prefixo ?? "Bearer ",
            },
          })
        }
      />
    </PainelLateral>
  );
}

/** A chave de acesso: escolhe uma chave do cofre pelo nome; o valor nunca passa pelo painel. */
function CampoSegredo({
  valor,
  muda,
  chaves,
  aoNovaChave,
}: {
  valor: SegredoFerramenta | null;
  muda: (s: SegredoFerramenta | null) => void;
  chaves: ChaveApi[];
  aoNovaChave: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Campo
        rotulo="Chave de acesso"
        ajuda={
          <button type="button" onClick={aoNovaChave} className="font-semibold text-primary-text hover:underline">
            Cadastrar chave nova
          </button>
        }
      >
        <Selecao
          value={valor?.chave ?? ""}
          onChange={(e) =>
            muda(
              e.target.value
                ? { chave: e.target.value, cabecalho: valor?.cabecalho ?? "Authorization", prefixo: valor?.prefixo ?? "Bearer " }
                : null,
            )
          }
        >
          <option value="">Sem chave</option>
          {chaves.map((c) => (
            <option key={c.nome} value={c.nome}>
              {c.nome} (••••{c.final})
            </option>
          ))}
          {valor?.chave && !chaves.some((c) => c.nome === valor.chave) && (
            <option value={valor.chave}>{valor.chave} (não está no cofre)</option>
          )}
        </Selecao>
      </Campo>
      {valor && (
        <>
          <Campo rotulo="Cabeçalho">
            <Input className="num" value={valor.cabecalho} maxLength={60} onChange={(e) => muda({ ...valor, cabecalho: e.target.value })} />
          </Campo>
          <Campo rotulo="Prefixo" ajuda='Ex.: "Bearer ", com o espaço.'>
            <Input className="num" value={valor.prefixo} maxLength={20} onChange={(e) => muda({ ...valor, prefixo: e.target.value })} />
          </Campo>
        </>
      )}
    </div>
  );
}

function ConfigHttpCampos({
  config,
  muda,
  chaves,
  aoNovaChave,
}: {
  config: ConfigHttp;
  muda: (p: Partial<ConfigHttp>) => void;
  chaves: ChaveApi[];
  aoNovaChave: () => void;
}) {
  const mudaParametro = (k: number, parte: Partial<ParametroHttp>) =>
    muda({ parametros: config.parametros.map((p, i) => (i === k ? { ...p, ...parte } : p)) });
  return (
    <>
      <SecaoPainel titulo="Chamada">
        <div className="grid gap-4 md:grid-cols-[8rem_minmax(0,1fr)_7rem]">
          <Campo rotulo="Método" ajuda="Só consulta.">
            <Selecao value={config.metodo} onChange={(e) => muda({ metodo: e.target.value as ConfigHttp["metodo"] })}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Endereço" ajuda="https, com {parametro} no caminho quando houver.">
            <Input className="num" value={config.url} maxLength={500} onChange={(e) => muda({ url: e.target.value.trim() })} />
          </Campo>
          <Campo rotulo="Tempo limite" ajuda="3 a 30 s.">
            <Input
              type="number"
              className="num"
              min={3}
              max={30}
              value={config.timeout_s}
              onChange={(e) => muda({ timeout_s: e.target.valueAsNumber || 15 })}
            />
          </Campo>
        </div>
        <CampoSegredo valor={config.segredo} muda={(segredo) => muda({ segredo })} chaves={chaves} aoNovaChave={aoNovaChave} />
      </SecaoPainel>

      <SecaoPainel
        titulo="Parâmetros"
        contagem={config.parametros.length}
        acao={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              muda({
                parametros: [
                  ...config.parametros,
                  { nome: "", tipo: "string", local: config.metodo === "GET" ? "query" : "body", obrigatorio: false, descricao: "" },
                ],
              })
            }
          >
            <Plus /> Parâmetro
          </Button>
        }
      >
        <p className="text-xs text-muted-foreground">O que o agente preenche ao chamar. A descrição diz a ele de onde tirar o valor.</p>
        {config.parametros.map((p, k) => (
          <div
            key={k}
            className="grid items-start gap-2 rounded-xl border border-border p-3 md:grid-cols-[minmax(0,1fr)_7rem_6.5rem_auto_auto]"
          >
            <Input
              className="num"
              value={p.nome}
              placeholder="nome"
              maxLength={60}
              onChange={(e) => mudaParametro(k, { nome: e.target.value.trim() })}
            />
            <Selecao value={p.tipo} onChange={(e) => mudaParametro(k, { tipo: e.target.value as ParametroHttp["tipo"] })}>
              <option value="string">texto</option>
              <option value="number">número</option>
              <option value="integer">inteiro</option>
              <option value="boolean">sim/não</option>
            </Selecao>
            <Selecao value={p.local} onChange={(e) => mudaParametro(k, { local: e.target.value as ParametroHttp["local"] })}>
              <option value="query">query</option>
              <option value="path">caminho</option>
              <option value="body">corpo</option>
            </Selecao>
            <label className="flex h-9 items-center gap-1.5 text-xs whitespace-nowrap">
              <input
                type="checkbox"
                checked={p.obrigatorio}
                onChange={(e) => mudaParametro(k, { obrigatorio: e.target.checked })}
                className="size-4 accent-[var(--color-primary)]"
              />
              obrigatório
            </label>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Tirar o parâmetro"
              onClick={() => muda({ parametros: config.parametros.filter((_, i) => i !== k) })}
            >
              <Trash2 className="text-muted-foreground" />
            </Button>
            <Input
              className="md:col-span-5"
              value={p.descricao}
              maxLength={300}
              placeholder="Descrição para o agente, ex.: CPF do servidor, só números"
              onChange={(e) => mudaParametro(k, { descricao: e.target.value })}
            />
          </div>
        ))}
      </SecaoPainel>

      <SecaoPainel
        titulo="Cabeçalhos fixos"
        contagem={config.cabecalhos.length}
        acao={
          <Button size="sm" variant="outline" onClick={() => muda({ cabecalhos: [...config.cabecalhos, { nome: "", valor: "" }] })}>
            <Plus /> Cabeçalho
          </Button>
        }
      >
        <p className="text-xs text-muted-foreground">Sem chave de acesso: Authorization e Cookie só pela "Chave de acesso" acima.</p>
        {config.cabecalhos.map((c, k) => (
          <div key={k} className="flex items-center gap-2">
            <Input
              className="num w-48"
              value={c.nome}
              placeholder="Accept"
              maxLength={60}
              onChange={(e) => muda({ cabecalhos: config.cabecalhos.map((x, i) => (i === k ? { ...x, nome: e.target.value.trim() } : x)) })}
            />
            <Input
              className="num"
              value={c.valor}
              placeholder="application/json"
              maxLength={300}
              onChange={(e) => muda({ cabecalhos: config.cabecalhos.map((x, i) => (i === k ? { ...x, valor: e.target.value } : x)) })}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Tirar o cabeçalho"
              onClick={() => muda({ cabecalhos: config.cabecalhos.filter((_, i) => i !== k) })}
            >
              <Trash2 className="text-muted-foreground" />
            </Button>
          </div>
        ))}
      </SecaoPainel>
    </>
  );
}

/** Chama a ferramenta em edição, com argumentos de teste, sem passar pelo agente. */
function Testar({
  corpo,
  config,
  resultado,
  aoResultado,
}: {
  corpo: Record<string, unknown>;
  config: ConfigHttp;
  resultado: string | null;
  aoResultado: (r: string | null) => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});

  const argumentos = (): Record<string, unknown> => {
    const saida: Record<string, unknown> = {};
    for (const p of config.parametros) {
      const v = (valores[p.nome] ?? "").trim();
      if (!v) continue;
      saida[p.nome] = p.tipo === "number" || p.tipo === "integer" ? Number(v) : p.tipo === "boolean" ? v === "true" : v;
    }
    return saida;
  };

  const testar = useMutation({
    mutationFn: () =>
      api<{ resultado: string }>("/fabrica/ferramentas/testar", {
        method: "POST",
        body: JSON.stringify({ ferramenta: corpo, argumentos: argumentos() }),
      }),
    onSuccess: (r) => aoResultado(r.resultado),
    onError: (e: Error) => aoResultado(`Erro: ${e.message}`),
  });

  return (
    <SecaoPainel titulo="Testar antes de salvar">
      {config.parametros.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {config.parametros.map((p, k) => (
            <Campo key={k} rotulo={<code className="num">{p.nome || "(sem nome)"}</code>} ajuda={p.descricao}>
              <Input className="num" value={valores[p.nome] ?? ""} onChange={(e) => setValores({ ...valores, [p.nome]: e.target.value })} />
            </Campo>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Sem parâmetros: o teste chama o endereço como está.</p>
      )}
      <Button variant="outline" disabled={testar.isPending} onClick={() => testar.mutate()}>
        {testar.isPending ? <Loader2 className="animate-spin" /> : <Play />} Testar
      </Button>
      {resultado !== null && (
        <pre
          className={cn(
            "thin-scroll num max-h-64 overflow-auto rounded-lg border p-3 text-[12px] whitespace-pre-wrap",
            resultado.startsWith("Erro:") ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-border bg-muted/40",
          )}
        >
          {resultado}
        </pre>
      )}
    </SecaoPainel>
  );
}
