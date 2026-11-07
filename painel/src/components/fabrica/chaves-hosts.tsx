import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar, Globe, KeyRound, Lock, Pencil, Plus, Save, Server, Trash2 } from "lucide-react";
import { api, type ChaveApi, type HostLiberado } from "@/lib/api";
import { fmtDataHora } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { Campo, PainelLateral } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { EmptyState, PageLoader } from "@/components/widgets/widgets";
import { usePode } from "@/hooks/use-permissoes";

/*
 * Chaves de API e hosts liberados, que as ferramentas HTTP usam. O valor da chave vai para o cofre do
 * servidor e nunca volta ao painel: a tela mostra só o nome e os 4 últimos caracteres. Os hosts de
 * origem "servidor" vêm de variável de ambiente e não saem pelo painel.
 */

const NOME_CHAVE = /^[a-z0-9-]{3,40}$/;

export const useChaves = () => useQuery({ queryKey: ["fabrica-chaves"], queryFn: () => api<{ chaves: ChaveApi[] }>("/fabrica/chaves") });
export const useHosts = () => useQuery({ queryKey: ["fabrica-hosts"], queryFn: () => api<{ hosts: HostLiberado[] }>("/fabrica/hosts") });

/** Depois de mudar chaves ou hosts: as listas, as opções e as ferramentas (que mostram os dois). */
function useAtualizar() {
  const qc = useQueryClient();
  return () => {
    for (const chave of ["fabrica-chaves", "fabrica-hosts", "fabrica-opcoes", "fabrica-ferramentas"]) qc.invalidateQueries({ queryKey: [chave] });
  };
}

/** Libera um host (POST /fabrica/hosts). O formulário de ferramenta também usa, com o host do endereço. */
export function useLiberarHost() {
  const atualizar = useAtualizar();
  return useMutation({
    mutationFn: ({ host, descricao }: { host: string; descricao: string }) =>
      api<HostLiberado>("/fabrica/hosts", { method: "POST", body: JSON.stringify({ host, descricao }) }),
    onSuccess: (h) => {
      atualizar();
      toast.success(`${h.host} liberado`, { description: "As ferramentas HTTP já podem chamar este host." });
    },
    onError: (e: Error) => toast.error("Não foi possível liberar o host", { description: e.message }),
  });
}

/* ───────── Chaves de API ───────── */

export function TabelaChaves() {
  const chaves = useChaves();
  const [aberta, setAberta] = useState<ChaveApi | "nova" | null>(null);
  const lista = chaves.data?.chaves ?? [];
  const paginacao = usePaginacao(lista);

  if (chaves.isLoading) return <PageLoader className="h-[40vh]" label="Carregando as chaves" />;
  if (chaves.isError)
    return (
      <div className="surface-card">
        <EmptyState title="Não foi possível carregar as chaves">{(chaves.error as Error).message}</EmptyState>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" /> O valor fica no cofre do servidor e nunca volta ao painel. Para mudar, cadastre um valor novo.
        </p>
        <Button className="ml-auto" onClick={() => setAberta("nova")}>
          <Plus /> Nova chave
        </Button>
      </div>
      <TableWrapper className="max-h-[calc(100dvh-20rem)]">
        <Table className="min-w-[760px]">
          <TableHeader>
            <tr>
              <TableHead icone={KeyRound}>Chave</TableHead>
              <TableHead>Para que serve</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead icone={Calendar}>Atualizada</TableHead>
              <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {lista.length === 0 && <TableEmpty colSpan={5}>Nenhuma chave cadastrada. Crie a primeira em “Nova chave”.</TableEmpty>}
            {paginacao.itens.map((c) => (
              <TableRow key={c.nome} className="group cursor-pointer" onClick={() => setAberta(c)}>
                <TableCell>
                  <code className="num font-semibold">{c.nome}</code>
                </TableCell>
                <TableCell className="text-muted-foreground">{c.descricao || "—"}</TableCell>
                <TableCell>
                  <code className="num text-muted-foreground">••••{c.final}</code>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div>{fmtDataHora(c.atualizado_em ?? c.criado_em)}</div>
                  <div className="text-xs text-muted-foreground">{c.atualizado_por ?? c.criado_por}</div>
                </TableCell>
                <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <Button size="icon" variant="ghost" title="Trocar o valor" aria-label={`Trocar ${c.nome}`} onClick={() => setAberta(c)}>
                      <Pencil />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
      {lista.length > 10 && <Paginacao {...paginacao} />}
      <FormChave chave={aberta === "nova" ? null : aberta} aberto={aberta !== null} aoFechar={() => setAberta(null)} />
    </div>
  );
}

export function FormChave({ chave, aberto, aoFechar, aoCriar }: { chave: ChaveApi | null; aberto: boolean; aoFechar: () => void; aoCriar?: (c: ChaveApi) => void }) {
  const atualizar = useAtualizar();
  const nova = chave === null;
  const pode = usePode();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    setNome(chave?.nome ?? "");
    setDescricao(chave?.descricao ?? "");
    // O valor antigo nunca é mostrado: o campo começa vazio também em "Trocar".
    setValor("");
    setConfirmarExclusao(false);
  }, [aberto, chave]);

  const problema = !NOME_CHAVE.test(nome)
    ? "O nome tem de 3 a 40 caracteres: minúsculas, números e hífen."
    : valor.length < 8 || valor.length > 4000
      ? "O valor tem de 8 a 4.000 caracteres."
      : /[\r\n]/.test(valor)
        ? "O valor fica numa linha só."
        : null;

  const salvar = useMutation({
    mutationFn: () => api<ChaveApi>(`/fabrica/chaves/${encodeURIComponent(nome)}`, { method: "PUT", body: JSON.stringify({ valor, descricao: descricao.trim() }) }),
    onSuccess: (c) => {
      atualizar();
      setValor("");
      toast.success(nova ? `Chave ${c.nome} cadastrada` : `Valor de ${c.nome} trocado`, { description: `Guardada no cofre, termina em ${c.final}.` });
      if (nova) aoCriar?.(c);
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar a chave", { description: e.message }),
  });
  const excluir = useMutation({
    mutationFn: () => api(`/fabrica/chaves/${encodeURIComponent(chave!.nome)}`, { method: "DELETE" }),
    onSuccess: () => {
      atualizar();
      toast.success("Chave excluída do cofre");
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      largura="md"
      rotulo="Chave de API"
      icone={<KeyRound />}
      titulo={nova ? "Nova chave" : `Trocar ${chave.nome}`}
      descricao="O valor vai direto para o cofre do servidor e não volta ao painel. As ferramentas HTTP escolhem a chave pelo nome."
      rodape={
        <>
          {!nova && (
            <div className="mr-auto flex items-center gap-2">
              {confirmarExclusao ? (
                <>
                  <span className="text-xs text-destructive">Excluir do cofre?</span>
                  <Button size="sm" variant="destructive" disabled={excluir.isPending} onClick={() => excluir.mutate()}>
                    Excluir
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmarExclusao(false)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={!pode("excluir")}
                  title={pode("excluir") ? undefined : "Sem a permissão Excluir"}
                  onClick={() => setConfirmarExclusao(true)}
                >
                  <Trash2 /> Excluir
                </Button>
              )}
            </div>
          )}
          {problema && (valor || nome) && <span className="text-xs text-muted-foreground">{problema}</span>}
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={!!problema || salvar.isPending} onClick={() => salvar.mutate()}>
            <Save /> {nova ? "Cadastrar" : "Trocar valor"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Campo rotulo="Nome" ajuda={nova ? "Minúsculas, números e hífen. Não muda depois." : undefined}>
          <Input className="num" value={nome} disabled={!nova} maxLength={40} placeholder="ex.: financeiro-api" onChange={(e) => setNome(e.target.value.toLowerCase())} />
        </Campo>
        <Campo rotulo="Para que serve" ajuda="Opcional. Ajuda a equipe a saber de qual sistema é a chave.">
          <Input value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
        </Campo>
        <Campo
          rotulo={nova ? "Valor" : "Valor novo"}
          ajuda={nova ? "Cole a chave como o sistema entregou." : `O valor atual termina em ${chave.final} e não é mostrado. O novo substitui o atual.`}
        >
          <Input type="password" autoComplete="new-password" className="num" value={valor} maxLength={4000} onChange={(e) => setValor(e.target.value)} />
        </Campo>
      </div>
    </PainelLateral>
  );
}

/* ───────── Hosts liberados ───────── */

export function TabelaHosts() {
  const hosts = useHosts();
  const pode = usePode();
  const [novo, setNovo] = useState(false);
  const atualizar = useAtualizar();
  const lista = hosts.data?.hosts ?? [];
  const paginacao = usePaginacao(lista);
  const remover = useMutation({
    mutationFn: (host: string) => api(`/fabrica/hosts/${encodeURIComponent(host)}`, { method: "DELETE" }),
    onSuccess: (_, host) => {
      atualizar();
      toast.success(`${host} removido da lista`);
    },
    onError: (e: Error) => toast.error("Não foi possível remover", { description: e.message }),
  });

  if (hosts.isLoading) return <PageLoader className="h-[40vh]" label="Carregando os hosts" />;
  if (hosts.isError)
    return (
      <div className="surface-card">
        <EmptyState title="Não foi possível carregar os hosts">{(hosts.error as Error).message}</EmptyState>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">As ferramentas HTTP só chamam endereços https destes hosts. Endereços da rede interna não são aceitos.</p>
        <Button className="ml-auto" onClick={() => setNovo(true)}>
          <Plus /> Liberar host
        </Button>
      </div>
      <TableWrapper className="max-h-[calc(100dvh-20rem)]">
        <Table className="min-w-[720px]">
          <TableHeader>
            <tr>
              <TableHead icone={Globe}>Host</TableHead>
              <TableHead>Para que serve</TableHead>
              <TableHead icone={Server}>Origem</TableHead>
              <TableHead icone={Calendar}>Liberado</TableHead>
              <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {lista.length === 0 && <TableEmpty colSpan={5}>Nenhum host liberado. Enquanto a lista estiver vazia, nenhuma ferramenta HTTP pode ser salva.</TableEmpty>}
            {paginacao.itens.map((h) => (
              <TableRow key={h.host} className="group">
                <TableCell>
                  <code className="num font-semibold">{h.host}</code>
                </TableCell>
                <TableCell className="text-muted-foreground">{h.descricao || "—"}</TableCell>
                <TableCell>
                  <Chip tom={h.origem === "servidor" ? "info" : "primario"}>{h.origem === "servidor" ? "Servidor" : "Painel"}</Chip>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {h.criado_em ? (
                    <>
                      <div>{fmtDataHora(h.criado_em)}</div>
                      <div className="text-xs text-muted-foreground">{h.criado_por}</div>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">variável do servidor</span>
                  )}
                </TableCell>
                <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted">
                  <div className="flex justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      title={h.origem === "servidor" ? "Vem da variável do servidor: não sai pelo painel" : "Remover da lista"}
                      aria-label={`Remover ${h.host}`}
                      disabled={h.origem === "servidor" || remover.isPending || !pode("excluir")}
                      onClick={() => window.confirm(`Remover ${h.host} da lista? As ferramentas deixam de poder chamá-lo.`) && remover.mutate(h.host)}
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
      {lista.length > 10 && <Paginacao {...paginacao} />}
      <FormHost aberto={novo} aoFechar={() => setNovo(false)} />
    </div>
  );
}

/** Tira https://, caminho e porta: o servidor quer só o nome do host. */
export const soHost = (texto: string) =>
  texto
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");

function FormHost({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const liberar = useLiberarHost();
  const [host, setHost] = useState("");
  const [descricao, setDescricao] = useState("");
  useEffect(() => {
    if (aberto) {
      setHost("");
      setDescricao("");
    }
  }, [aberto]);
  const limpo = soHost(host);
  const valido = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(limpo);

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && aoFechar()}
      largura="md"
      rotulo="Hosts liberados"
      icone={<Globe />}
      titulo="Liberar host"
      descricao="Só o nome do host, sem https:// nem caminho. Endereços da rede interna, localhost e .local não são aceitos."
      rodape={
        <>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={!valido || liberar.isPending} onClick={() => liberar.mutate({ host: limpo, descricao: descricao.trim() }, { onSuccess: aoFechar })}>
            <Save /> Liberar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Campo rotulo="Host" ajuda={host && limpo !== host.trim().toLowerCase() ? `Vai ser liberado como ${limpo}.` : "Ex.: api.exemplo.com.br"}>
          <Input className="num" value={host} maxLength={253} onChange={(e) => setHost(e.target.value)} />
        </Campo>
        <Campo rotulo="Para que serve" ajuda="Opcional.">
          <Input value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
        </Campo>
      </div>
    </PainelLateral>
  );
}
