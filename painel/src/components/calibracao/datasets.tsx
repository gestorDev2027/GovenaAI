import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Bot, CheckCircle2, Database, Download, MessageSquare, Search, UserCheck, Wrench, XCircle } from "lucide-react";
import { api, type CasoDataset } from "@/lib/api";
import { fmtDataHora, fmtRelativo } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Campo, PainelLateral } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { PageLoader, Pills } from "@/components/widgets/widgets";
import { useOpcoesCalibracao } from "./avaliar-resposta";

type Tipo = "todos" | "gold" | "bad";

const FERRAMENTA: Record<string, string> = {
  transferir_para_humano: "Transferir para humano",
  encerrar_atendimento: "Encerrar atendimento",
  consultar_cadastro: "Consultar cadastro",
  buscar_aula: "Buscar aula",
  consultar_brindes: "Apostilas e brindes",
};

const ORIGEM: Record<string, string> = {
  chat_teste: "Chat de teste",
  conversa: "Conversa real",
  guardrail: "Guardrail",
};

/** Agentes para os filtros: os do servidor ou, se ele ainda não mandar, os que aparecem nos dados. */
export function useAgentes(extras: (string | null | undefined)[] = []) {
  const opcoes = useOpcoesCalibracao();
  return useMemo(() => {
    const lista = opcoes.data?.agentes ?? [];
    const conhecidos = new Set(lista.map((a) => a.id));
    const faltando = [...new Set(extras.filter((id): id is string => !!id && !conhecidos.has(id)))];
    return [...lista, ...faltando.map((id) => ({ id, nome: id }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opcoes.data?.agentes, extras.join("|")]);
}

function ChipsDoCaso({ tipos }: { tipos: CasoDataset["tipos"] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tipos.includes("gold") && <Chip tom="sucesso">gold</Chip>}
      {tipos.includes("bad") && <Chip tom="erro">bad</Chip>}
    </div>
  );
}

/** Linha do JSONL exportado: o caso inteiro, sem o telefone do aluno. */
function paraExportar(c: CasoDataset) {
  const { telefone: _telefone, ...resto } = c;
  return JSON.stringify(resto);
}

/**
 * Gold e bad dataset: as avaliações aprovadas viram casos. O gabarito é a resposta aprovada (num 👎,
 * a que a equipe escreveu); a resposta ruim é a original do agente num 👎. É o que as avaliações
 * automáticas rodam e o que se exporta para treinar e comparar modelos.
 */
export function Datasets() {
  const opcoes = useOpcoesCalibracao();
  const q = useQuery({
    queryKey: ["calibracao-datasets"],
    queryFn: () => api<{ casos: CasoDataset[]; totais: { gold: number; bad: number } }>("/calibracao/datasets"),
  });
  const casos = q.data?.casos ?? [];
  const agentes = useAgentes(casos.map((c) => c.agente));
  const [tipo, setTipo] = useState<Tipo>("todos");
  const [agente, setAgente] = useState("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<CasoDataset | null>(null);

  const doAgente = agente === "todos" ? casos : casos.filter((c) => c.agente === agente);
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return doAgente.filter(
      (c) =>
        (tipo === "todos" || c.tipos.includes(tipo)) &&
        (!termo || [...c.mensagens, c.gabarito, c.resposta_ruim ?? "", c.comentario ?? ""].some((t) => t.toLowerCase().includes(termo))),
    );
  }, [doAgente, tipo, busca]);
  const gold = doAgente.filter((c) => c.tipos.includes("gold")).length;
  const bad = doAgente.filter((c) => c.tipos.includes("bad")).length;
  const nomeAgente = (id: string) => agentes.find((a) => a.id === id)?.nome ?? id;
  const problema = (p: string) => opcoes.data?.problemas[p] ?? p;

  function exportar() {
    const arquivo = new Blob([visiveis.map(paraExportar).join("\n") + "\n"], {
      type: "application/x-ndjson",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(arquivo);
    link.download = `dataset-${agente === "todos" ? "agentes" : agente}-${tipo === "todos" ? "gold-e-bad" : tipo}-${new Date().toISOString().slice(0, 10)}.jsonl`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (q.isLoading) return <PageLoader className="h-64" label="Carregando os datasets" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Cada avaliação aprovada vira um caso. <strong className="text-foreground">Gold</strong>: a resposta certa (o 👍 aprovado, ou a
        resposta ideal escrita num 👎). <strong className="text-foreground">Bad</strong>: a resposta errada de um 👎, com o que estava
        errado. As avaliações automáticas rodam estes casos a cada mudança no agente; o arquivo exportado serve para treinar e comparar
        modelos.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Pills
          rotulo="Tipo de caso"
          value={tipo}
          onChange={setTipo}
          options={[
            { value: "todos", label: `Todos · ${doAgente.length}` },
            { value: "gold", label: `Gold · ${gold}` },
            { value: "bad", label: `Bad · ${bad}` },
          ]}
        />
        {agentes.length > 1 && (
          <Pills
            rotulo="Agente"
            value={agente}
            onChange={setAgente}
            options={[{ value: "todos", label: "Todos os agentes" }, ...agentes.map((a) => ({ value: a.id, label: a.nome }))]}
          />
        )}
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar na mensagem ou nas respostas"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          className="ml-auto"
          disabled={!visiveis.length}
          onClick={exportar}
          title="Um caso por linha, sem o telefone do aluno"
        >
          <Download /> Exportar JSONL ({visiveis.length})
        </Button>
      </div>

      <TableWrapper>
        <Table className="min-w-[1040px]">
          <TableHeader>
            <tr>
              <TableHead icone={Database}>Caso</TableHead>
              <TableHead icone={MessageSquare}>Mensagem do aluno</TableHead>
              <TableHead icone={CheckCircle2}>Gabarito</TableHead>
              <TableHead icone={XCircle}>Resposta ruim</TableHead>
              <TableHead icone={Wrench}>Ferramentas</TableHead>
              <TableHead icone={UserCheck}>Aprovado</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {visiveis.length === 0 && (
              <TableEmpty colSpan={6}>
                {casos.length ? "Nada com esses filtros." : "Nenhum caso ainda: cada avaliação aprovada vira um."}
              </TableEmpty>
            )}
            {visiveis.map((c) => (
              <TableRow key={c.id} onClick={() => setAberto(c)} className="cursor-pointer">
                <TableCell className="whitespace-nowrap">
                  <div className="font-medium">#{c.id}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <ChipsDoCaso tipos={c.tipos} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {nomeAgente(c.agente)} · {ORIGEM[c.origem] ?? c.origem}
                  </div>
                </TableCell>
                <TableCell className="max-w-[16rem]">
                  <p className="line-clamp-2 text-sm">{c.mensagens.at(-1)}</p>
                  {c.mensagens.length > 1 && (
                    <div className="font-mono text-[11px] text-muted-foreground">+{c.mensagens.length - 1} mensagem(ns) antes</div>
                  )}
                </TableCell>
                <TableCell className="max-w-[20rem]">
                  <p className="line-clamp-2 text-xs text-muted-foreground">{c.gabarito}</p>
                </TableCell>
                <TableCell className="max-w-[18rem]">
                  {c.resposta_ruim ? (
                    <>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{c.resposta_ruim}</p>
                      {c.problemas.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.problemas.slice(0, 2).map((p) => (
                            <Chip key={p} tom="erro">
                              {problema(p)}
                            </Chip>
                          ))}
                          {c.problemas.length > 2 && <Chip>+{c.problemas.length - 2}</Chip>}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[12rem]">
                  <Ferramentas c={c} />
                </TableCell>
                <TableCell
                  className="text-xs whitespace-nowrap text-muted-foreground"
                  title={c.aprovado_em ? fmtDataHora(c.aprovado_em) : undefined}
                >
                  <div className="max-w-[10rem] truncate">{c.aprovado_por ?? "—"}</div>
                  {c.aprovado_em && <div>{fmtRelativo(c.aprovado_em)}</div>}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>

      <PainelLateral
        aberto={aberto !== null}
        aoMudar={(a) => !a && setAberto(null)}
        rotulo={aberto ? `Caso #${aberto.id}` : "Caso"}
        icone={<Database />}
        titulo={aberto ? (aberto.tipos.includes("bad") ? "Gold e bad: resposta corrigida" : "Gold: resposta certa") : ""}
        descricao={
          aberto
            ? `${nomeAgente(aberto.agente)} · ${ORIGEM[aberto.origem] ?? aberto.origem} · aprovado por ${aberto.aprovado_por ?? "—"}${aberto.aprovado_em ? ` em ${fmtDataHora(aberto.aprovado_em)}` : ""}`
            : undefined
        }
        largura="xl"
      >
        {aberto && (
          <div className="space-y-5">
            <ChipsDoCaso tipos={aberto.tipos} />
            <Campo rotulo={aberto.mensagens.length > 1 ? "Mensagens do aluno, em ordem" : "Mensagem do aluno"}>
              <div className="space-y-1.5">
                {aberto.mensagens.map((m, i) => (
                  <div key={i} className="rounded-lg bg-secondary px-3 py-2 text-sm whitespace-pre-wrap">
                    {m}
                  </div>
                ))}
              </div>
            </Campo>
            <Campo rotulo="Gabarito (a resposta certa)">
              <div className="rounded-lg border border-success/40 bg-success/5 px-3 py-2 text-sm whitespace-pre-wrap">
                {aberto.gabarito}
              </div>
            </Campo>
            {aberto.resposta_ruim && (
              <Campo rotulo="Resposta ruim (o que o agente respondeu)">
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm whitespace-pre-wrap">
                  {aberto.resposta_ruim}
                </div>
              </Campo>
            )}
            {(aberto.problemas.length > 0 || aberto.comentario) && (
              <Campo rotulo="O que estava errado">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {aberto.problemas.map((p) => (
                      <Chip key={p} tom="erro">
                        {problema(p)}
                      </Chip>
                    ))}
                  </div>
                  {aberto.comentario && <p className="text-sm text-muted-foreground">“{aberto.comentario}”</p>}
                </div>
              </Campo>
            )}
            {(aberto.ferramentas_exigidas.length > 0 || aberto.ferramentas_proibidas.length > 0) && (
              <Campo
                rotulo="Ferramentas"
                ajuda="Vêm dos problemas marcados: “Deveria ter transferido” exige a transferência; “Transferiu sem precisar” a proíbe."
              >
                <Ferramentas c={aberto} />
              </Campo>
            )}
          </div>
        )}
      </PainelLateral>
    </div>
  );
}

function Ferramentas({ c }: { c: CasoDataset }) {
  if (!c.ferramentas_exigidas.length && !c.ferramentas_proibidas.length) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {c.ferramentas_exigidas.map((f) => (
        <Chip key={`e-${f}`} tom="info">
          <Bot className="size-3" /> exige: {FERRAMENTA[f] ?? f}
        </Chip>
      ))}
      {c.ferramentas_proibidas.map((f) => (
        <Chip key={`p-${f}`} tom="alerta">
          <Ban className="size-3" /> proíbe: {FERRAMENTA[f] ?? f}
        </Chip>
      ))}
    </div>
  );
}
