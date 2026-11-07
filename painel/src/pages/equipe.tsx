import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Crown, Loader2, Mail, UserCog, UserPlus, X } from "lucide-react";
import { api, type Acesso } from "@/lib/api";
import { fmtDataHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { EmptyState, PageHeader, PageLoader } from "@/components/widgets/widgets";
import { Table, TableCell, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { useCargos } from "./cargos";

/*
 * Equipe e acessos da prefeitura: quem entra no sistema e em que cargo (as permissões vêm do cargo). O dono
 * convida por um link (vale 7 dias; a pessoa cria a própria senha), troca o cargo e bloqueia quem sai.
 */

interface Membro {
  email: string;
  nome: string | null;
  papel: "dono" | "membro";
  ativo: boolean;
  cargo_id: string | null;
  cargo: string | null;
  criado_em: string | null;
}
interface Convite {
  id: string;
  email: string;
  nome: string | null;
  cargo: string | null;
  expira_em: string;
}

export function Equipe() {
  const qc = useQueryClient();
  const acesso = useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });
  const equipe = useQuery({ queryKey: ["prefeitura-equipe"], queryFn: () => api<{ membros: Membro[]; convites: Convite[] }>("/prefeitura/equipe") });
  const cargos = useCargos();
  const [convidando, setConvidando] = useState(false);
  const eu = acesso.data?.usuario?.email;

  const alterar = useMutation({
    mutationFn: ({ email, dados }: { email: string; dados: { cargo_id?: string | null; ativo?: boolean } }) =>
      api(`/prefeitura/membros/${encodeURIComponent(email)}`, { method: "PUT", body: JSON.stringify(dados) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prefeitura-equipe"] });
      qc.invalidateQueries({ queryKey: ["prefeitura-cargos"] });
    },
  });
  const cancelar = useMutation({
    mutationFn: (id: string) => api(`/prefeitura/convites/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefeitura-equipe"] }),
  });

  const listaCargos = cargos.data?.cargos ?? [];
  const membros = equipe.data?.membros ?? [];
  const convites = equipe.data?.convites ?? [];

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Equipe e acessos"
        icon={UserCog}
        description="Quem entra no sistema e em que cargo. O que cada pessoa pode fazer vem do cargo."
        actions={
          <Button onClick={() => setConvidando(true)}>
            <UserPlus /> Convidar pessoa
          </Button>
        }
      />

      {equipe.isLoading && <PageLoader className="h-[40vh]" label="Abrindo a equipe" />}
      {equipe.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível abrir a equipe">{(equipe.error as Error).message}</EmptyState>
        </div>
      )}

      {cargos.data && listaCargos.length === 0 && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning-text">
          Ainda não há cargos. Monte o organograma em{" "}
          <Link to="/cargos" className="font-semibold underline">
            Organograma e cargos
          </Link>{" "}
          para convidar cada pessoa já no cargo dela.
        </p>
      )}

      {equipe.data && (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {membros.map((m) => {
                  const dono = m.papel === "dono";
                  const voce = m.email === eu;
                  return (
                    <TableRow key={m.email}>
                      <TableCell>
                        <span className="flex items-center gap-3">
                          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary-text">
                            {(m.nome || m.email).charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium">
                              {m.nome || m.email}
                              {dono && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning-text">
                                  <Crown className="size-3" /> Dono
                                </span>
                              )}
                              {voce && <span className="text-xs text-muted-foreground">(você)</span>}
                            </span>
                            <span className="block text-xs text-muted-foreground">{m.email}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {dono ? (
                          <span className="text-sm text-muted-foreground">Todas as permissões</span>
                        ) : (
                          <select
                            aria-label={`Cargo de ${m.nome || m.email}`}
                            value={m.cargo_id ?? ""}
                            disabled={voce || alterar.isPending}
                            onChange={(e) => alterar.mutate({ email: m.email, dados: { cargo_id: e.target.value || null } })}
                            className="h-9 w-full max-w-72 rounded-lg border border-input bg-background px-2 text-sm"
                          >
                            <option value="">Sem cargo (sem permissões)</option>
                            {listaCargos.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nome}
                              </option>
                            ))}
                          </select>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                            m.ativo ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive",
                          )}
                        >
                          <span className="size-1.5 rounded-full bg-current" />
                          {m.ativo ? "Ativo" : "Bloqueado"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {!dono && !voce && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={alterar.isPending}
                            onClick={() => alterar.mutate({ email: m.email, dados: { ativo: !m.ativo } })}
                          >
                            {m.ativo ? "Bloquear" : "Desbloquear"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          </TableWrapper>
          {alterar.isError && <p className="text-sm text-destructive">{(alterar.error as Error).message}</p>}

          {convites.length > 0 && (
            <section className="surface-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Mail className="size-4 text-primary-text" /> Convites aguardando
              </h2>
              <ul className="divide-y divide-border">
                {convites.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span>
                      <span className="font-medium">{c.nome || c.email}</span>{" "}
                      <span className="text-muted-foreground">
                        · {c.email} · {c.cargo ?? "sem cargo"} · vence {fmtDataHora(c.expira_em)}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => cancelar.mutate(c.id)} disabled={cancelar.isPending}>
                      <X /> Cancelar
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {convidando && <Convidar aoFechar={() => setConvidando(false)} />}
    </div>
  );
}

function Convidar({ aoFechar }: { aoFechar: () => void }) {
  const qc = useQueryClient();
  const cargos = useCargos();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cargo, setCargo] = useState("");
  const [copiado, setCopiado] = useState(false);
  const convidar = useMutation({
    mutationFn: () =>
      api<{ link: string; validade_dias: number }>("/prefeitura/convites", {
        method: "POST",
        body: JSON.stringify({ nome: nome.trim(), email: email.trim(), cargo_id: cargo || null }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefeitura-equipe"] }),
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (email.includes("@")) convidar.mutate();
  }
  async function copiar(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }
  const link = convidar.data?.link;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" role="dialog" aria-modal="true" aria-labelledby="convidar">
      <div className="surface-card w-full max-w-lg space-y-4 p-6">
        <h2 id="convidar" className="text-lg font-semibold">
          Convidar pessoa
        </h2>
        {link ? (
          <>
            <p className="text-sm text-muted-foreground">
              Envie este link para {email}. Ele vale {convidar.data?.validade_dias} dias e só pode ser usado uma vez: a pessoa cria a própria senha e
              entra já no cargo.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="h-10 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Link do convite" />
              <Button type="button" variant="outline" onClick={() => copiar(link)}>
                {copiado ? <Check /> : <Copy />} {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={aoFechar}>Pronto</Button>
            </div>
          </>
        ) : (
          <form onSubmit={enviar} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="conv-nome" className="text-sm font-medium">
                Nome
              </label>
              <Input id="conv-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="conv-email" className="text-sm font-medium">
                E-mail institucional
              </label>
              <Input id="conv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="conv-cargo" className="text-sm font-medium">
                Cargo
              </label>
              <select id="conv-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
                <option value="">Sem cargo por enquanto</option>
                {(cargos.data?.cargos ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">As permissões da pessoa são as do cargo. Sem cargo, ela entra mas não pode fazer nada.</p>
            </div>
            {convidar.isError && <p className="text-sm text-destructive">{(convidar.error as Error).message}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={aoFechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!email.includes("@") || convidar.isPending}>
                {convidar.isPending && <Loader2 className="animate-spin" />}
                Gerar convite
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
