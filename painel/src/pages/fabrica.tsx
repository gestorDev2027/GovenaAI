import { useMemo, useState, type ComponentType } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Bot,
  Calendar,
  Code2,
  Copy,
  Factory,
  Globe,
  KeyRound,
  Layers,
  MessageSquare,
  Pencil,
  Plug,
  Plus,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { api, type AgenteFabrica, type OpcoesFabrica } from "@/lib/api";
import { fmtDataHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
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
import { Abas, EmptyState, PageHeader, PageLoader, Pills } from "@/components/widgets/widgets";
import { BotaoExcluirAgente, InterruptorAtivo } from "@/components/fabrica/ativacao";
import { AvatarAgente } from "@/components/fabrica/campos";
import { EditorAgente, type SecaoEditor } from "@/components/fabrica/editor";
import { TabelaChaves, TabelaHosts } from "@/components/fabrica/chaves-hosts";
import { DuplicarAgente } from "@/components/fabrica/duplicar-agente";
import { TabelaEquipes } from "@/components/fabrica/equipes";
import { TabelaFerramentas } from "@/components/fabrica/ferramentas-painel";
import { NovoAgente } from "@/components/fabrica/novo-agente";
import { TabelaSkills } from "@/components/fabrica/skills";
import { usePode } from "@/hooks/use-permissoes";

type Situacao = "todos" | "ativos" | "inativos";
type Coluna = "nome" | "area" | "cargo" | "origem" | "publicado" | "versao" | "atualizado";

const SECOES_VALIDAS: SecaoEditor[] = [
  "identidade",
  "comportamento",
  "ferramentas",
  "skills",
  "integracoes",
  "instrucoes",
  "conhecimento",
  "casos",
  "publicacao",
];

type AbaFabrica = "agentes" | "equipes" | "canal" | "skills" | "ferramentas" | "chaves" | "hosts";
// "canal" (WhatsApp) fica fora até o agente do cidadão: o GestorGov atende os servidores pelo painel.
const ABAS_FABRICA: AbaFabrica[] = ["agentes", "equipes", "skills", "ferramentas", "chaves", "hosts"];

/** O valor de cada coluna para ordenar. */
const VALOR: Record<Coluna, (a: AgenteFabrica) => string | number> = {
  nome: (a) => a.nome.toLowerCase(),
  area: (a) => a.area.toLowerCase(),
  cargo: (a) => a.cargo.toLowerCase(),
  origem: (a) => a.origem,
  publicado: (a) => Number(a.publicado),
  versao: (a) => a.versao_instrucoes,
  atualizado: (a) => a.atualizado_em ?? "",
};

/**
 * Fábrica de agentes: a lista dos agentes numa tabela (busca, situação, ordenação e paginação) e,
 * para cada um, o painel lateral que edita identidade, comportamento, ferramentas, instruções e base,
 * testa no chat e publica. Os agentes do código (Luna, Vera, Rafa e Caio) aceitam por cima o que for
 * salvo aqui.
 */
export function Fabrica() {
  const navigate = useNavigate();
  const pedido = useSearch({ from: "/protegido/painel/fabrica" });
  const pode = usePode();
  const opcoes = useQuery({ queryKey: ["fabrica-opcoes"], queryFn: () => api<OpcoesFabrica>("/fabrica/opcoes"), staleTime: 5 * 60_000 });
  const agentes = useQuery({ queryKey: ["fabrica-agentes"], queryFn: () => api<{ agentes: AgenteFabrica[] }>("/fabrica/agentes") });
  const [criando, setCriando] = useState(false);
  const [duplicando, setDuplicando] = useState<AgenteFabrica | null>(null);
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("todos");
  const { chave, direcao, alternar } = useOrdenacao<Coluna>("nome", "asc");

  const lista = agentes.data?.agentes ?? [];
  const nomeAgente = (id: string) => lista.find((a) => a.id === id)?.nome ?? id;
  const aba: AbaFabrica = (ABAS_FABRICA as string[]).includes(pedido.aba ?? "") ? (pedido.aba as AbaFabrica) : "agentes";
  const nomeFerramenta = (id: string) => opcoes.data?.ferramentas.find((f) => f.id === id)?.nome ?? id;

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtrados = lista.filter(
      (a) =>
        (situacao === "todos" || (situacao === "ativos") === a.publicado) &&
        (!termo || [a.nome, a.id, a.area, a.cargo, a.descricao].some((t) => t.toLowerCase().includes(termo))),
    );
    const sinal = direcao === "asc" ? 1 : -1;
    return [...filtrados].sort((x, y) => {
      const a = VALOR[chave](x);
      const b = VALOR[chave](y);
      return (a < b ? -1 : a > b ? 1 : 0) * sinal;
    });
  }, [lista, busca, situacao, chave, direcao]);
  const paginacao = usePaginacao(visiveis);

  const aberto = lista.find((a) => a.id === pedido.agente) ?? null;
  const secao = (SECOES_VALIDAS as string[]).includes(pedido.secao ?? "") ? (pedido.secao as SecaoEditor) : "identidade";
  const abrir = (id: string, s: SecaoEditor = "identidade") => navigate({ to: "/fabrica", search: { agente: id, secao: s } });
  const fechar = () => navigate({ to: "/fabrica", search: {}, replace: true });

  const publicados = lista.filter((a) => a.publicado).length;

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Fábrica de agentes"
        icon={Factory}
        description="Crie agentes e ajuste os atuais: identidade, comportamento, ferramentas, instruções e base. Teste no chat antes de publicar."
        actions={
          aba === "agentes" && (
            <Button onClick={() => setCriando(true)} disabled={!opcoes.data}>
              <Plus /> Novo agente
            </Button>
          )
        }
      />

      <Abas
        rotulo="Fábrica"
        valor={aba}
        onTrocar={(a) => navigate({ to: "/fabrica", search: a === "agentes" ? {} : { aba: a } })}
        abas={[
          { id: "agentes", label: "Agentes", icone: Bot, n: agentes.data ? lista.length : null },
          { id: "equipes", label: "Equipes", icone: Users },
          { id: "skills", label: "Skills", icone: Sparkles },
          // Ferramentas, chaves e hosts: só com a permissão "Ferramentas e chaves".
          ...(pode("ferramentas_e_chaves")
            ? [
                { id: "ferramentas" as const, label: "Ferramentas HTTP", icone: Plug },
                { id: "chaves" as const, label: "Chaves de API", icone: KeyRound },
                { id: "hosts" as const, label: "Hosts liberados", icone: Globe },
              ]
            : []),
        ]}
      />

      {aba === "equipes" && <TabelaEquipes agentes={lista} />}
      {aba === "skills" && <TabelaSkills nomeAgente={nomeAgente} />}
      {aba === "ferramentas" && pode("ferramentas_e_chaves") && <TabelaFerramentas nomeAgente={nomeAgente} />}
      {aba === "chaves" && pode("ferramentas_e_chaves") && <TabelaChaves />}
      {aba === "hosts" && pode("ferramentas_e_chaves") && <TabelaHosts />}

      {aba === "agentes" && agentes.isLoading && <PageLoader className="h-[60vh]" label="Carregando os agentes" />}
      {aba === "agentes" && agentes.isError && (
        <div className="surface-card">
          <EmptyState icon={<Factory className="size-5" />} title="Não foi possível carregar a fábrica">
            {(agentes.error as Error).message}
          </EmptyState>
        </div>
      )}

      {aba === "agentes" && agentes.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar por nome, área, cargo ou descrição"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Pills
              rotulo="Situação"
              value={situacao}
              onChange={setSituacao}
              options={[
                { value: "todos", label: `Todos (${lista.length})` },
                { value: "ativos", label: `Ativos (${publicados})` },
                { value: "inativos", label: `Inativos (${lista.length - publicados})` },
              ]}
            />
          </div>

          <TableWrapper className="max-h-[calc(100dvh-18rem)]">
            <Table className="min-w-[1240px]">
              <TableHeader>
                <tr>
                  <TableHead>
                    <CabecalhoOrdenavel
                      rotulo="Agente"
                      campo="nome"
                      chaveAtiva={chave}
                      direcao={direcao}
                      onAlternar={alternar}
                      icone={Bot}
                    />
                  </TableHead>
                  <TableHead>
                    <CabecalhoOrdenavel
                      rotulo="Área"
                      campo="area"
                      chaveAtiva={chave}
                      direcao={direcao}
                      onAlternar={alternar}
                      icone={Layers}
                    />
                  </TableHead>
                  <TableHead>
                    <CabecalhoOrdenavel rotulo="Cargo" campo="cargo" chaveAtiva={chave} direcao={direcao} onAlternar={alternar} />
                  </TableHead>
                  <TableHead>
                    <CabecalhoOrdenavel
                      rotulo="Origem"
                      campo="origem"
                      chaveAtiva={chave}
                      direcao={direcao}
                      onAlternar={alternar}
                      icone={Code2}
                    />
                  </TableHead>
                  <TableHead>
                    <CabecalhoOrdenavel
                      rotulo="Situação"
                      campo="publicado"
                      chaveAtiva={chave}
                      direcao={direcao}
                      onAlternar={alternar}
                      icone={ShieldCheck}
                    />
                  </TableHead>
                  <TableHead icone={Wrench}>Ferramentas</TableHead>
                  <TableHead>
                    <CabecalhoOrdenavel
                      rotulo="Instruções"
                      campo="versao"
                      chaveAtiva={chave}
                      direcao={direcao}
                      onAlternar={alternar}
                      icone={ScrollText}
                    />
                  </TableHead>
                  <TableHead>
                    <CabecalhoOrdenavel
                      rotulo="Atualizado"
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
                  <TableEmpty colSpan={9}>
                    {lista.length ? "Nenhum agente com esse filtro." : "Nenhum agente ainda. Crie o primeiro em “Novo agente”."}
                  </TableEmpty>
                )}
                {paginacao.itens.map((a) => (
                  <TableRow
                    key={a.id}
                    onClick={() => abrir(a.id)}
                    className={cn("group cursor-pointer", a.id === aberto?.id && "bg-primary/5")}
                  >
                    <TableCell>
                      <div className="flex min-w-56 items-center gap-3">
                        <AvatarAgente cor={a.cor} />
                        <div className="min-w-0">
                          <div className="font-semibold">{a.nome}</div>
                          <div className="max-w-72 truncate text-xs text-muted-foreground" title={a.descricao}>
                            {a.descricao || <span className="num">{a.id}</span>}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{a.area || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{a.cargo || "—"}</TableCell>
                    <TableCell>
                      <Chip tom={a.origem === "codigo" ? "info" : "primario"}>{a.origem === "codigo" ? "Código" : "Painel"}</Chip>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <InterruptorAtivo agente={a} rotulo />
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-64 flex-wrap gap-1" title={a.ferramentas.map(nomeFerramenta).join(", ")}>
                        {a.ferramentas.map((f) => (
                          <span key={f} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground">
                            {nomeFerramenta(f)}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">
                      {a.versao_instrucoes === 0 ? "código" : `v${a.versao_instrucoes}`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {a.atualizado_em ? (
                        <>
                          <div>{fmtDataHora(a.atualizado_em)}</div>
                          {a.atualizado_por && <div className="text-xs text-muted-foreground">{a.atualizado_por}</div>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="sticky right-0 bg-card transition-colors group-hover:bg-muted"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-0.5">
                        <Acao titulo="Editar" icone={Pencil} onClick={() => abrir(a.id, "identidade")} />
                        <Acao titulo="Instruções" icone={ScrollText} onClick={() => abrir(a.id, "instrucoes")} />
                        <AcaoLink titulo="Base de conhecimento" icone={BookOpen} to="/base" agente={a.id} />
                        <AcaoLink titulo="Testar no chat" icone={MessageSquare} to="/chat" agente={a.id} />
                        <Acao titulo="Testar e publicar" icone={Rocket} onClick={() => abrir(a.id, "publicacao")} />
                        <Acao titulo="Duplicar" icone={Copy} onClick={() => setDuplicando(a)} />
                        {a.origem === "painel" && (
                          <BotaoExcluirAgente agente={a} compacto aoExcluir={a.id === aberto?.id ? fechar : undefined} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableWrapper>
          <Paginacao {...paginacao} />
        </div>
      )}

      <EditorAgente
        agente={aberto}
        opcoes={opcoes.data}
        secao={secao}
        aoTrocarSecao={(s) => aberto && navigate({ to: "/fabrica", search: { agente: aberto.id, secao: s }, replace: true })}
        aoFechar={fechar}
        nomeAgente={nomeAgente}
      />

      <NovoAgente
        aberto={criando}
        aoMudar={setCriando}
        opcoes={opcoes.data}
        ocupadas={lista.map((a) => a.cor.toLowerCase())}
        aoCriar={(a) => {
          setCriando(false);
          abrir(a.id, "instrucoes");
        }}
      />

      <DuplicarAgente
        original={duplicando}
        aoFechar={() => setDuplicando(null)}
        opcoes={opcoes.data}
        ocupadas={lista.map((a) => a.cor.toLowerCase())}
        aoDuplicar={(a) => {
          setDuplicando(null);
          abrir(a.id, "identidade");
        }}
      />
    </div>
  );
}

const ESTILO_ACAO =
  "grid size-8 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4";

function Acao({ titulo, icone: Icone, onClick }: { titulo: string; icone: ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button type="button" title={titulo} aria-label={titulo} onClick={onClick} className={ESTILO_ACAO}>
      <Icone />
    </button>
  );
}

function AcaoLink({
  titulo,
  icone: Icone,
  to,
  agente,
}: {
  titulo: string;
  icone: ComponentType<{ className?: string }>;
  to: "/base" | "/chat";
  agente: string;
}) {
  return (
    <Link to={to} search={{ agente }} title={titulo} aria-label={titulo} className={ESTILO_ACAO}>
      <Icone />
    </Link>
  );
}
