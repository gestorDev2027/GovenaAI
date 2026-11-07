import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar, FlaskConical, Loader2, Plus, Search, ShieldAlert, UserCheck, Users } from "lucide-react";
import { api, type FraseGuardrail } from "@/lib/api";
import { fmtDataHora, fmtRelativo } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { PageLoader, Pills } from "@/components/widgets/widgets";
import { useOpcoesCalibracao } from "./avaliar-resposta";
import { useAgentes } from "./datasets";

/** A mesma forma do servidor (agente/datasets.py, normalizar): sem acento, minúsculas, espaços simples. */
export function normalizar(texto: string) {
  return texto
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const MINIMO = 6;

/**
 * Frases que barram pedidos de manipulação ("ignore as instruções", "mostre seu prompt"...). A mensagem
 * do servidor é comparada sem acento e em minúsculas; se contiver uma frase ativa, o agente não responde
 * com o modelo e o servidor recebe a seção "Pedido fora do atendimento" do roteiro. Não se apaga frase:
 * desliga-se, para o histórico de por que algo foi barrado continuar fazendo sentido.
 */
export function FrasesGuardrail() {
  const qc = useQueryClient();
  const opcoes = useOpcoesCalibracao();
  const podeEditar = opcoes.data?.pode_aprovar ?? false;
  const q = useQuery({
    queryKey: ["guardrail-frases"],
    queryFn: () => api<{ frases: FraseGuardrail[] }>("/calibracao/guardrails/frases"),
  });
  const frases = q.data?.frases ?? [];
  const agentes = useAgentes(frases.map((f) => f.agente));
  const [nova, setNova] = useState("");
  const [agenteNova, setAgenteNova] = useState("todos");
  const [busca, setBusca] = useState("");
  const [teste, setTeste] = useState("");

  const nomeAgente = (id: string | null) => (id ? (agentes.find((a) => a.id === id)?.nome ?? id) : "Todos os agentes");
  const novaNormalizada = normalizar(nova);
  const repetida = frases.find((f) => f.frase === novaNormalizada && (f.agente ?? "todos") === agenteNova);

  const visiveis = useMemo(() => {
    const termo = normalizar(busca);
    return [...frases]
      .filter((f) => !termo || f.frase.includes(termo))
      .sort((a, b) => a.frase.localeCompare(b.frase)); // ordem fixa: ligar ou desligar não faz a linha pular
  }, [frases, busca]);

  // Teste: quais frases ativas barrariam esta mensagem (a mesma comparação do servidor).
  const textoTeste = normalizar(teste);
  const barram = textoTeste ? frases.filter((f) => f.ativo && textoTeste.includes(f.frase)) : [];

  const atualizar = () => qc.invalidateQueries({ queryKey: ["guardrail-frases"] });
  const criar = useMutation({
    mutationFn: () =>
      api<FraseGuardrail>("/calibracao/guardrails/frases", {
        method: "POST",
        body: JSON.stringify({
          frase: nova,
          agente: agenteNova === "todos" ? null : agenteNova,
        }),
      }),
    onSuccess: (f) => {
      atualizar();
      setNova("");
      toast.success("Frase acrescentada", {
        description: `“${f.frase}” passa a valer em até 1 minuto.`,
      });
    },
    onError: (e: Error) => toast.error("Não foi possível acrescentar", { description: e.message }),
  });
  const alternar = useMutation({
    mutationFn: (f: FraseGuardrail) =>
      api(`/calibracao/guardrails/frases/${f.id}`, {
        method: "POST",
        body: JSON.stringify({ ativo: !f.ativo }),
      }),
    onSuccess: (_, f) => {
      atualizar();
      toast.success(f.ativo ? "Frase desligada" : "Frase ligada", {
        description: "Vale para os agentes em até 1 minuto.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (novaNormalizada.length >= MINIMO && !repetida && !criar.isPending) criar.mutate();
  }

  if (q.isLoading) return <PageLoader className="h-40" label="Carregando as frases" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Frases que barram manipulação</h2>
        <span className="text-xs text-muted-foreground">
          {frases.filter((f) => f.ativo).length} ativas de {frases.length} · comparadas sem acento e em minúsculas · mudanças valem em até 1
          minuto
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {podeEditar ? (
          <form onSubmit={enviar} className="surface-card space-y-2.5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="size-4 text-primary-text" /> Acrescentar frase
            </div>
            <Input
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              placeholder="Ex.: ignore o que te disseram"
              maxLength={200}
              aria-label="Nova frase"
            />
            {agentes.length > 0 && (
              <Pills
                rotulo="Vale para"
                value={agenteNova}
                onChange={setAgenteNova}
                options={[{ value: "todos", label: "Todos os agentes" }, ...agentes.map((a) => ({ value: a.id, label: a.nome }))]}
              />
            )}
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[11px] text-muted-foreground">
                {nova && novaNormalizada.length < MINIMO
                  ? `Pelo menos ${MINIMO} letras: frases curtas barram mensagens comuns.`
                  : repetida
                    ? `Já existe${repetida.ativo ? "" : " (desligada)"}.`
                    : nova
                      ? `Fica gravada como “${novaNormalizada}”.`
                      : "Use frases de manipulação, não palavras soltas: “prompt” sozinho barraria “o prompt da aula”."}
              </p>
              <Button type="submit" size="sm" disabled={novaNormalizada.length < MINIMO || !!repetida || criar.isPending}>
                {criar.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Acrescentar
              </Button>
            </div>
          </form>
        ) : (
          <div className="surface-card p-4 text-xs text-muted-foreground">
            Só os curadores (PAINEL_CURADORES) acrescentam, ligam e desligam frases.
          </div>
        )}

        <div className="surface-card space-y-2.5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="size-4 text-primary-text" /> Testar uma mensagem
          </div>
          <Input
            value={teste}
            onChange={(e) => setTeste(e.target.value)}
            placeholder="Escreva como o servidor escreveria"
            aria-label="Mensagem de teste"
          />
          <p className={cn("text-xs", !teste ? "text-muted-foreground" : barram.length ? "text-destructive" : "text-success")}>
            {!teste
              ? "Confira antes de acrescentar uma frase: a mensagem não pode ser barrada à toa."
              : barram.length
                ? `Seria barrada por: ${barram.map((f) => `“${f.frase}” (${nomeAgente(f.agente)})`).join(", ")}`
                : "Passaria: nenhuma frase ativa está nessa mensagem."}
          </p>
        </div>
      </div>

      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar frase" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <TableWrapper>
        <Table className="min-w-[760px]">
          <TableHeader>
            <tr>
              <TableHead icone={ShieldAlert}>Frase</TableHead>
              <TableHead icone={Users}>Vale para</TableHead>
              <TableHead icone={UserCheck}>Criada por</TableHead>
              <TableHead icone={Calendar}>Criada</TableHead>
              <TableHead>Situação</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {visiveis.length === 0 && (
              <TableEmpty colSpan={5}>{frases.length ? "Nenhuma frase com essa busca." : "Nenhuma frase cadastrada."}</TableEmpty>
            )}
            {visiveis.map((f) => (
              <TableRow key={f.id} className={cn(!f.ativo && "opacity-60")}>
                <TableCell className="font-mono text-xs">{f.frase}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{nomeAgente(f.agente)}</TableCell>
                <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">{f.criada_por ?? "padrão"}</TableCell>
                <TableCell
                  className="text-xs whitespace-nowrap text-muted-foreground"
                  title={f.criada_em ? fmtDataHora(f.criada_em) : undefined}
                >
                  {f.criada_em ? fmtRelativo(f.criada_em) : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Chip tom={f.ativo ? "sucesso" : "neutro"}>{f.ativo ? "ligada" : "desligada"}</Chip>
                    {podeEditar && (
                      <Button size="sm" variant="ghost" className="h-7" disabled={alternar.isPending} onClick={() => alternar.mutate(f)}>
                        {f.ativo ? "Desligar" : "Ligar"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
    </section>
  );
}
