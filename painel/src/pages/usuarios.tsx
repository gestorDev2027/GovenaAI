import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Calendar, Check, Clock3, Crown, Pencil, Search, ShieldCheck, Trash2, UserCheck, UserRound, Users } from "lucide-react";
import { api, type OpcoesUsuarios, type Permissao, type SituacaoUsuario, type UsuarioPainel } from "@/lib/api";
import { fmtDataHora, fmtRelativo } from "@/lib/formato";
import { useUsuarios } from "@/hooks/use-usuarios";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Paginacao, usePaginacao } from "@/components/ui/paginacao";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { EmptyState, PageHeader, PageLoader, Pills } from "@/components/widgets/widgets";
import { Selecao } from "@/components/fabrica/campos";

/*
 * Usuários e permissões: quem entrou com o Google fica pendente até o dono (ou um administrador) aprovar e
 * escolher o papel. O papel aplica um conjunto pronto de permissões, e o dono pode ligar e desligar cada
 * uma. Regras do servidor: ninguém altera o dono nem a si mesmo; só o dono mexe em administradores e dá
 * "gerenciar usuários".
 */

const SITUACAO: Record<SituacaoUsuario, { rotulo: string; tom: "alerta" | "sucesso" | "erro" }> = {
  pendente: { rotulo: "Pendente", tom: "alerta" },
  ativo: { rotulo: "Ativo", tom: "sucesso" },
  bloqueado: { rotulo: "Bloqueado", tom: "erro" },
};

type Filtro = "todos" | SituacaoUsuario;

const useOpcoesUsuarios = () =>
  useQuery({ queryKey: ["usuarios-opcoes"], queryFn: () => api<OpcoesUsuarios>("/usuarios/opcoes"), staleTime: Infinity });

export function Usuarios() {
  const usuarios = useUsuarios();
  const opcoes = useOpcoesUsuarios();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<string | null>(null);
  const lista = usuarios.data?.usuarios ?? [];
  const nomePapel = (id: string | null) => (id === "dono" ? "Dono" : (opcoes.data?.papeis.find((p) => p.id === id)?.nome ?? id ?? "—"));

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lista.filter(
      (u) => (filtro === "todos" || u.situacao === filtro) && (!termo || `${u.nome} ${u.email}`.toLowerCase().includes(termo)),
    );
  }, [lista, busca, filtro]);
  const paginacao = usePaginacao(visiveis, 25);
  const conta = (s: SituacaoUsuario) => lista.filter((u) => u.situacao === s).length;

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Usuários e permissões"
        icon={Users}
        description="Quem entra com o Google fica pendente até ser aprovado. Escolha o papel e, se precisar, ajuste cada permissão."
      />

      {usuarios.isLoading && <PageLoader className="h-[50vh]" label="Carregando os usuários" />}
      {usuarios.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível carregar os usuários">{(usuarios.error as Error).message}</EmptyState>
        </div>
      )}

      {usuarios.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar por nome ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Pills
              rotulo="Situação"
              value={filtro}
              onChange={setFiltro}
              options={[
                { value: "todos", label: `Todos (${lista.length})` },
                { value: "pendente", label: `Pendentes (${conta("pendente")})` },
                { value: "ativo", label: `Ativos (${conta("ativo")})` },
                { value: "bloqueado", label: `Bloqueados (${conta("bloqueado")})` },
              ]}
            />
          </div>

          <TableWrapper className="max-h-[calc(100dvh-15rem)]">
            <Table className="min-w-[900px]">
              <TableHeader>
                <tr>
                  <TableHead icone={UserRound}>Pessoa</TableHead>
                  <TableHead icone={ShieldCheck}>Papel</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Permissões</TableHead>
                  <TableHead icone={Clock3}>Último acesso</TableHead>
                  <TableHead icone={Calendar}>Alterado por</TableHead>
                  <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
                </tr>
              </TableHeader>
              <tbody>
                {visiveis.length === 0 && <TableEmpty colSpan={7}>Ninguém com esse filtro.</TableEmpty>}
                {paginacao.itens.map((u) => (
                  <TableRow
                    key={u.email}
                    className={cn("group cursor-pointer", u.situacao === "pendente" && "bg-warning/5")}
                    onClick={() => setAberto(u.email)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-semibold">
                        {u.nome || u.email}
                        {u.email === usuarios.data.voce && <span className="text-xs font-normal text-muted-foreground">(você)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      {u.papel ? (
                        <Chip tom={u.papel === "dono" ? "primario" : "info"}>
                          {u.papel === "dono" && <Crown className="size-3" />}
                          {nomePapel(u.papel)}
                        </Chip>
                      ) : (
                        <span className="text-xs text-muted-foreground">sem papel</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip tom={SITUACAO[u.situacao].tom}>{SITUACAO[u.situacao].rotulo}</Chip>
                    </TableCell>
                    <TableCell numeric>
                      {u.permissoes.length}
                      {opcoes.data && <span className="text-muted-foreground"> / {opcoes.data.permissoes.length}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" title={fmtDataHora(u.ultimo_acesso)}>
                      {u.ultimo_acesso ? fmtRelativo(u.ultimo_acesso) : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {u.atualizado_por ? (
                        <>
                          <div className="text-xs">{u.atualizado_por}</div>
                          <div className="text-xs text-muted-foreground">{fmtDataHora(u.atualizado_em)}</div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="sticky right-0 bg-card transition-colors group-hover:bg-muted"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          title={u.situacao === "pendente" ? "Aprovar" : "Editar"}
                          aria-label={`Abrir ${u.email}`}
                          onClick={() => setAberto(u.email)}
                        >
                          {u.situacao === "pendente" ? <UserCheck /> : <Pencil />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableWrapper>
          {visiveis.length > 25 && <Paginacao {...paginacao} opcoes={[25, 50, 100]} />}
        </div>
      )}

      <FormUsuario
        usuario={lista.find((u) => u.email === aberto) ?? null}
        voce={usuarios.data?.voce ?? ""}
        opcoes={opcoes.data}
        aoFechar={() => setAberto(null)}
      />
    </div>
  );
}

function FormUsuario({
  usuario,
  voce,
  opcoes,
  aoFechar,
}: {
  usuario: UsuarioPainel | null;
  voce: string;
  opcoes?: OpcoesUsuarios;
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const [papel, setPapel] = useState("");
  const [permissoes, setPermissoes] = useState<Permissao[]>([]);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  useEffect(() => {
    if (!usuario) return;
    setPapel(usuario.papel ?? "");
    setPermissoes(usuario.permissoes);
    setConfirmarRemocao(false);
  }, [usuario?.email, usuario?.atualizado_em]); // eslint-disable-line react-hooks/exhaustive-deps

  const dono = usuario?.papel === "dono";
  const euMesmo = usuario?.email === voce;
  const travado = dono || euMesmo;
  const pendente = usuario?.situacao === "pendente";
  const alterado =
    !!usuario &&
    (papel !== (usuario.papel ?? "") || JSON.stringify([...permissoes].sort()) !== JSON.stringify([...usuario.permissoes].sort()));

  const alterar = useMutation({
    mutationFn: (corpo: { papel?: string; permissoes?: Permissao[]; situacao?: SituacaoUsuario }) =>
      api<UsuarioPainel>(`/usuarios/${encodeURIComponent(usuario!.email)}`, { method: "PUT", body: JSON.stringify(corpo) }),
    onSuccess: (u, corpo) => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      toast.success(
        corpo.situacao === "ativo" && pendente
          ? `${u.nome || u.email} aprovado`
          : corpo.situacao === "bloqueado"
            ? `${u.nome || u.email} bloqueado`
            : corpo.situacao === "ativo"
              ? `${u.nome || u.email} desbloqueado`
              : `${u.nome || u.email} salvo`,
      );
    },
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });
  const remover = useMutation({
    mutationFn: () => api(`/usuarios/${encodeURIComponent(usuario!.email)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      toast.success("Pessoa removida da lista", { description: "Se entrar de novo, volta como pendente." });
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível remover", { description: e.message }),
  });

  // Trocar de papel aplica as permissões dele; depois, cada uma liga e desliga.
  const escolherPapel = (id: string) => {
    setPapel(id);
    const doPapel = opcoes?.papeis.find((p) => p.id === id);
    if (doPapel) setPermissoes(doPapel.permissoes);
  };
  const salvar = () => {
    if (!usuario) return;
    const corpo: { papel?: string; permissoes?: Permissao[]; situacao?: SituacaoUsuario } = {};
    if (papel !== (usuario.papel ?? "")) corpo.papel = papel;
    corpo.permissoes = permissoes;
    if (pendente) corpo.situacao = "ativo";
    alterar.mutate(corpo);
  };

  return (
    <PainelLateral
      aberto={usuario !== null}
      aoMudar={(a) => !a && aoFechar()}
      largura="lg"
      rotulo="Usuário"
      icone={<UserRound />}
      titulo={usuario ? usuario.nome || usuario.email : ""}
      descricao={usuario ? usuario.email : undefined}
      rodape={
        usuario && !travado ? (
          <>
            <div className="mr-auto flex items-center gap-2">
              {confirmarRemocao ? (
                <>
                  <span className="text-xs text-destructive">Tirar da lista?</span>
                  <Button size="sm" variant="destructive" disabled={remover.isPending} onClick={() => remover.mutate()}>
                    Remover
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmarRemocao(false)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button variant="ghost" className="text-destructive" onClick={() => setConfirmarRemocao(true)}>
                  <Trash2 /> Remover
                </Button>
              )}
            </div>
            {usuario.situacao === "bloqueado" ? (
              <Button
                variant="outline"
                disabled={alterar.isPending || !usuario.papel}
                onClick={() => alterar.mutate({ situacao: "ativo" })}
              >
                <Check /> Desbloquear
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-destructive"
                disabled={alterar.isPending}
                onClick={() => alterar.mutate({ situacao: "bloqueado" })}
              >
                <Ban /> Bloquear
              </Button>
            )}
            <Button disabled={alterar.isPending || !papel || (!pendente && !alterado)} onClick={salvar}>
              {pendente ? (
                <>
                  <UserCheck /> Aprovar
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </>
        ) : undefined
      }
    >
      {usuario && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tom={SITUACAO[usuario.situacao].tom}>{SITUACAO[usuario.situacao].rotulo}</Chip>
            <span className="text-xs text-muted-foreground">
              Primeiro acesso {fmtDataHora(usuario.criado_em)} · último {usuario.ultimo_acesso ? fmtRelativo(usuario.ultimo_acesso) : "—"}
            </span>
          </div>

          {travado && (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {dono
                ? "O dono pode tudo e não é alterado pelo painel."
                : "Ninguém altera o próprio acesso: peça a outra pessoa com essa permissão."}
            </p>
          )}

          {!dono && (
            <>
              <SecaoPainel titulo="Papel">
                <Campo
                  rotulo="Conjunto pronto de permissões"
                  ajuda={pendente ? "Para aprovar, escolha um papel." : "Trocar de papel aplica as permissões dele."}
                >
                  <Selecao value={papel} disabled={travado} onChange={(e) => escolherPapel(e.target.value)}>
                    <option value="" disabled>
                      Escolha o papel
                    </option>
                    {opcoes?.papeis.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome} · {p.descricao}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </SecaoPainel>

              <SecaoPainel titulo="Permissões" contagem={permissoes.length}>
                <ul className="space-y-1.5">
                  {opcoes?.permissoes.map((p) => {
                    const ligada = permissoes.includes(p.id);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={ligada}
                          disabled={travado}
                          onClick={() => setPermissoes(ligada ? permissoes.filter((x) => x !== p.id) : [...permissoes, p.id])}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default",
                            ligada ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{p.nome}</span>
                            <span className="block text-xs text-muted-foreground">{p.descricao}</span>
                          </span>
                          <span
                            className={cn(
                              "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                              ligada ? "bg-primary" : "bg-muted-foreground/30",
                            )}
                          >
                            <span
                              className={cn(
                                "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
                                ligada ? "left-[1.125rem]" : "left-0.5",
                              )}
                            />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </SecaoPainel>
            </>
          )}
        </div>
      )}
    </PainelLateral>
  );
}
