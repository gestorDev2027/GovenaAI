import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Camera, Check, CheckCircle2, Loader2, MapPin, MessagesSquare, Pencil, Search, Star, Trash2, TriangleAlert, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAgentes } from "@/hooks/use-agentes";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDataHora } from "@/lib/formato";
import { useAcesso, usePodeNaPrefeitura } from "@/hooks/use-permissoes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";

/*
 * A ficha de uma unidade de saúde, a mesma na Central de comando, na Cidade e na implantação: a foto principal (ou a
 * vista de satélite do Mapbox, pelo ponto no mapa), os dados, a conferência pela secretaria e as fotos. Quem tem
 * "Cadastrar unidades" edita (o CEP busca o endereço no ViaCEP e põe o ponto no mapa), confere e envia fotos.
 */

export interface UnidadeSaude {
  id: string;
  tipo_id: string | null;
  cnes: string | null;
  nome: string;
  nome_fantasia?: string | null;
  endereco: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro: string | null;
  cep?: string | null;
  telefone: string | null;
  email?: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  coordenadas_origem?: string | null;
  gestao?: string | null;
  origem?: string | null;
  confirmada: boolean | null;
  conferida_por?: string | null;
  conferida_em?: string | null;
  foto_id?: string | null;
  fotos?: number;
  agente_id?: string | null;
}
export interface TipoUnidadeSaude {
  id: string;
  nome: string;
  cor: string | null;
  ordem?: number | null;
}
interface Foto {
  id: string;
  tipo: "fachada" | "interior" | "outra";
  legenda: string | null;
  principal: boolean;
  enviada_por: string;
  enviada_em: string;
}
interface Endereco {
  cep: string;
  municipio: string;
  uf: string;
  logradouro: string | null;
  bairro: string | null;
  latitude: number | null;
  longitude: number | null;
  coordenadas_origem: string | null;
  do_municipio: boolean;
}

const VINCULO: Record<string, string> = { publica: "Pública (municipal)", conveniada: "Conveniada ao SUS" };
const ORIGEM_PONTO: Record<string, string> = {
  cnes: "pelo endereço do CNES",
  endereco: "pela rua e número",
  cep: "pelo CEP (aproximado)",
  mapa: "ajustado no mapa",
  manual: "informado à mão",
};
const TIPO_FOTO: Record<Foto["tipo"], string> = { fachada: "Fachada", interior: "Interior", outra: "Outra" };

export const urlFoto = (id: string) => `/painel/api/prefeitura/fotos/${encodeURIComponent(id)}`;

/** Vista de satélite (Mapbox Static Images) com o pino da unidade. Nada é guardado: a imagem vem do ponto no mapa. */
export function urlSatelite(lat: number, lon: number, token: string, largura = 600, altura = 300, zoom = 17) {
  const ponto = `${lon.toFixed(6)},${lat.toFixed(6)}`;
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-l+F4B800(${ponto})/${ponto},${zoom},0/${largura}x${altura}@2x?access_token=${encodeURIComponent(token)}`;
}

const nomeDe = (u: UnidadeSaude) => u.nome_fantasia || u.nome;
const cepFormatado = (cep?: string | null) => (cep && cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep ?? "");

/** A imagem do topo da ficha: a foto principal; sem ela, o satélite; sem ponto no mapa, um aviso. */
export function CapaDaUnidade({ unidade, className }: { unidade: UnidadeSaude; className?: string }) {
  const token = useAcesso().data?.mapbox_token;
  const lat = unidade.latitude != null ? Number(unidade.latitude) : null;
  const lon = unidade.longitude != null ? Number(unidade.longitude) : null;
  if (unidade.foto_id)
    return <img src={urlFoto(unidade.foto_id)} alt={`Foto de ${nomeDe(unidade)}`} className={cn("h-44 w-full rounded-xl object-cover", className)} />;
  if (lat != null && lon != null && token)
    return (
      <figure className={cn("relative overflow-hidden rounded-xl", className)}>
        <img src={urlSatelite(lat, lon, token)} alt={`Vista de satélite de ${nomeDe(unidade)}`} className="h-44 w-full object-cover" />
        <figcaption className="absolute bottom-1.5 left-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
          Satélite · © Mapbox © OpenStreetMap
        </figcaption>
      </figure>
    );
  return (
    <div className={cn("grid h-28 place-items-center rounded-xl border border-dashed border-border text-xs text-muted-foreground", className)}>
      <span className="flex items-center gap-1.5">
        <MapPin className="size-4" /> Sem ponto no mapa: confira o CEP e o número.
      </span>
    </div>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** O conteúdo da ficha (o recipiente, slide-over ou cartão, é de quem usa). */
export function FichaUnidade({
  unidade,
  tipos,
  aoMudar,
}: {
  unidade: UnidadeSaude;
  tipos: TipoUnidadeSaude[];
  /** Depois de salvar, conferir ou mexer nas fotos: quem usa recarrega o panorama. */
  aoMudar: () => void;
}) {
  const pode = usePodeNaPrefeitura()("gerenciar_unidades");
  const [editando, setEditando] = useState(false);
  const tipo = tipos.find((t) => t.id === unidade.tipo_id);
  const conferir = useMutation({
    mutationFn: (conferida: boolean) =>
      api(`/prefeitura/unidades/${unidade.id}`, { method: "PUT", body: JSON.stringify({ conferida }) }),
    onSuccess: (_, conferida) => {
      toast.success(conferida ? "Unidade conferida" : "Conferência desfeita");
      aoMudar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  useEffect(() => setEditando(false), [unidade.id]);

  if (editando)
    return (
      <FormUnidade
        unidade={unidade}
        tipos={tipos}
        aoSalvar={() => {
          setEditando(false);
          aoMudar();
        }}
        aoCancelar={() => setEditando(false)}
      />
    );

  const endereco = [
    [unidade.endereco, unidade.numero].filter(Boolean).join(", "),
    unidade.complemento,
    unidade.bairro,
    cepFormatado(unidade.cep) && `CEP ${cepFormatado(unidade.cep)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <CapaDaUnidade unidade={unidade} />

      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
          unidade.confirmada ? "border-success/30 bg-success/10" : "border-warning/40 bg-warning/10",
        )}
      >
        {unidade.confirmada ? <CheckCircle2 className="size-4 text-success" /> : <TriangleAlert className="size-4 text-warning" />}
        <span className="min-w-0 flex-1">
          {unidade.confirmada ? (
            <>
              Conferida{unidade.conferida_por ? ` por ${unidade.conferida_por}` : ""}
              {unidade.conferida_em ? <span className="text-xs text-muted-foreground"> · {fmtDataHora(unidade.conferida_em)}</span> : null}
            </>
          ) : (
            "A conferir pela secretaria"
          )}
        </span>
        {pode &&
          (unidade.confirmada ? (
            <Button size="sm" variant="ghost" disabled={conferir.isPending} onClick={() => conferir.mutate(false)}>
              Desfazer
            </Button>
          ) : (
            <Button size="sm" disabled={conferir.isPending} onClick={() => conferir.mutate(true)}>
              <Check /> Marcar como conferida
            </Button>
          ))}
      </div>

      <AgenteDaUnidade agenteId={unidade.agente_id} />

      <dl className="space-y-3">
        <Dado rotulo="Tipo">{tipo?.nome ?? unidade.tipo_id}</Dado>
        <Dado rotulo="Vínculo">{unidade.gestao ? VINCULO[unidade.gestao] ?? unidade.gestao : null}</Dado>
        <Dado rotulo="Endereço">{endereco}</Dado>
        <Dado rotulo="Ponto no mapa">
          {unidade.latitude != null ? ORIGEM_PONTO[unidade.coordenadas_origem ?? ""] ?? "definido" : null}
        </Dado>
        <Dado rotulo="Telefone">{unidade.telefone}</Dado>
        <Dado rotulo="E-mail">{unidade.email}</Dado>
        <Dado rotulo="CNES">{unidade.cnes}</Dado>
      </dl>

      {pode && (
        <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
          <Pencil /> Editar dados e endereço
        </Button>
      )}

      <FotosUnidade unidade={unidade} pode={pode} aoMudar={aoMudar} />
    </div>
  );
}

/** O agente de IA da unidade: quem conversa com a equipe e reporta à secretaria. */
function AgenteDaUnidade({ agenteId }: { agenteId?: string | null }) {
  const agente = useAgentes().find((a) => a.id === agenteId);
  if (!agenteId) return <p className="text-xs text-muted-foreground">Esta unidade ainda não tem agente de IA.</p>;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full text-white" style={{ background: agente?.cor ?? "#14C4D4" }}>
        <Bot className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{agente?.nome ?? agenteId}</span>
        <span className="block text-xs text-muted-foreground">Agente da unidade: conversa com a equipe e reporta à secretaria</span>
      </span>
      <Link to="/chat" search={{ agente: agenteId }} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
        <MessagesSquare className="size-3.5" /> Conversar
      </Link>
    </div>
  );
}

/** As fotos da unidade: enviar (do computador ou da câmera do celular), escolher a principal e apagar. */
function FotosUnidade({ unidade, pode, aoMudar }: { unidade: UnidadeSaude; pode: boolean; aoMudar: () => void }) {
  const qc = useQueryClient();
  const chave = ["unidade-fotos", unidade.id];
  const fotos = useQuery({ queryKey: chave, queryFn: () => api<{ fotos: Foto[] }>(`/prefeitura/unidades/${unidade.id}/fotos`) });
  const entrada = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState<Foto["tipo"]>("fachada");
  const depois = () => {
    qc.invalidateQueries({ queryKey: chave });
    aoMudar();
  };
  const enviar = useMutation({
    mutationFn: async (arquivos: File[]) => {
      for (const arquivo of arquivos) {
        const corpo = new FormData();
        corpo.append("arquivo", arquivo);
        corpo.append("tipo", tipo);
        await api(`/prefeitura/unidades/${unidade.id}/fotos`, { method: "POST", body: corpo });
      }
    },
    onSuccess: (_, arquivos) => {
      toast.success(arquivos.length > 1 ? `${arquivos.length} fotos enviadas` : "Foto enviada");
      depois();
    },
    onError: (e: Error) => toast.error("Não foi possível enviar", { description: e.message }),
  });
  const principal = useMutation({
    mutationFn: (id: string) => api(`/prefeitura/fotos/${id}/principal`, { method: "POST" }),
    onSuccess: depois,
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });
  const apagar = useMutation({
    mutationFn: (id: string) => api(`/prefeitura/fotos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Foto apagada");
      depois();
    },
    onError: (e: Error) => toast.error("Não foi possível apagar", { description: e.message }),
  });
  const lista = fotos.data?.fotos ?? [];

  return (
    <section aria-label="Fotos da unidade" className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
        <Camera className="size-3.5" /> Fotos {lista.length ? `· ${lista.length}` : ""}
      </h3>
      {lista.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {lista.map((f) => (
            <li key={f.id} className="group relative overflow-hidden rounded-lg border border-border">
              <a href={urlFoto(f.id)} target="_blank" rel="noreferrer" title={`${TIPO_FOTO[f.tipo]} · ${f.enviada_por} · ${fmtDataHora(f.enviada_em)}`}>
                <img src={urlFoto(f.id)} alt={`${TIPO_FOTO[f.tipo]} de ${nomeDe(unidade)}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              </a>
              <span className="absolute top-1 left-1 rounded bg-black/55 px-1 text-[10px] text-white">
                {f.principal ? "★ " : ""}
                {TIPO_FOTO[f.tipo]}
              </span>
              {pode && (
                <span className="absolute right-1 bottom-1 flex gap-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  {!f.principal && (
                    <button
                      type="button"
                      onClick={() => principal.mutate(f.id)}
                      aria-label="Usar como foto principal"
                      title="Usar como foto principal"
                      className="grid size-6 place-items-center rounded bg-black/60 text-white hover:bg-black/80"
                    >
                      <Star className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => window.confirm("Apagar esta foto?") && apagar.mutate(f.id)}
                    aria-label="Apagar a foto"
                    title="Apagar a foto"
                    className="grid size-6 place-items-center rounded bg-black/60 text-white hover:bg-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!lista.length && !fotos.isLoading && (
        <p className="text-xs text-muted-foreground">Nenhuma foto ainda. A ficha mostra a vista de satélite até a equipe enviar a da fachada.</p>
      )}
      {pode && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`tipo-foto-${unidade.id}`}>
            Tipo da foto
          </label>
          <select
            id={`tipo-foto-${unidade.id}`}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as Foto["tipo"])}
            className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            {(Object.keys(TIPO_FOTO) as Foto["tipo"][]).map((t) => (
              <option key={t} value={t}>
                {TIPO_FOTO[t]}
              </option>
            ))}
          </select>
          <input
            ref={entrada}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const arquivos = [...(e.target.files ?? [])];
              e.target.value = "";
              if (arquivos.length) enviar.mutate(arquivos);
            }}
          />
          <Button size="sm" variant="outline" disabled={enviar.isPending} onClick={() => entrada.current?.click()}>
            {enviar.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Enviar foto
          </Button>
          <span className="text-[11px] text-muted-foreground">JPG, PNG ou WEBP até 10 MB. No celular, dá para tirar na hora.</span>
        </div>
      )}
    </section>
  );
}

/** Cadastro e edição: o CEP busca o endereço (ViaCEP) e o ponto no mapa; o número deixa o ponto mais preciso. */
export function FormUnidade({
  unidade,
  tipos,
  aoSalvar,
  aoCancelar,
}: {
  /** Sem unidade: cadastro de uma nova. */
  unidade?: UnidadeSaude;
  tipos: TipoUnidadeSaude[];
  aoSalvar: (salva: UnidadeSaude) => void;
  aoCancelar: () => void;
}) {
  const token = useAcesso().data?.mapbox_token;
  const [campos, setCampos] = useState({
    nome: unidade?.nome_fantasia || unidade?.nome || "",
    tipo_id: unidade?.tipo_id ?? "",
    cep: cepFormatado(unidade?.cep),
    endereco: unidade?.endereco ?? "",
    numero: unidade?.numero ?? "",
    complemento: unidade?.complemento ?? "",
    bairro: unidade?.bairro ?? "",
    telefone: unidade?.telefone ?? "",
    email: unidade?.email ?? "",
    cnes: unidade?.cnes ?? "",
  });
  const [ponto, setPonto] = useState<{ latitude: number; longitude: number; origem: string | null } | null>(
    unidade?.latitude != null && unidade?.longitude != null
      ? { latitude: Number(unidade.latitude), longitude: Number(unidade.longitude), origem: unidade.coordenadas_origem ?? null }
      : null,
  );
  const [aviso, setAviso] = useState<string | null>(null);
  const muda = (k: keyof typeof campos) => (e: { target: { value: string } }) => setCampos((c) => ({ ...c, [k]: e.target.value }));

  const buscar = useMutation({
    mutationFn: () => {
      const cep = campos.cep.replace(/\D/g, "");
      return api<Endereco>(`/prefeitura/cep/${cep}?numero=${encodeURIComponent(campos.numero.trim())}`);
    },
    onSuccess: (r) => {
      setCampos((c) => ({ ...c, endereco: r.logradouro || c.endereco, bairro: r.bairro || c.bairro }));
      if (r.latitude != null && r.longitude != null) setPonto({ latitude: r.latitude, longitude: r.longitude, origem: r.coordenadas_origem });
      setAviso(
        !r.do_municipio
          ? `Este CEP é de ${r.municipio}-${r.uf}, não do seu município. Confira.`
          : r.latitude == null
            ? "Endereço encontrado, mas sem o ponto no mapa. Confira o número."
            : null,
      );
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: campos.nome.trim(),
        tipo_id: campos.tipo_id,
        cep: campos.cep.replace(/\D/g, "") || null,
        endereco: campos.endereco.trim() || null,
        numero: campos.numero.trim() || null,
        complemento: campos.complemento.trim() || null,
        bairro: campos.bairro.trim() || null,
        telefone: campos.telefone.trim() || null,
        email: campos.email.trim() || null,
        cnes: campos.cnes.trim() || null,
        ...(ponto ? { latitude: ponto.latitude, longitude: ponto.longitude, coordenadas_origem: ponto.origem ?? "manual" } : {}),
        conferida: true,
      };
      return unidade
        ? api<UnidadeSaude>(`/prefeitura/unidades/${unidade.id}`, { method: "PUT", body: JSON.stringify(corpo) })
        : api<UnidadeSaude>("/prefeitura/unidades", { method: "POST", body: JSON.stringify(corpo) });
    },
    onSuccess: (salva) => {
      toast.success(unidade ? "Unidade salva e conferida" : "Unidade cadastrada");
      aoSalvar(salva);
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const cepCompleto = campos.cep.replace(/\D/g, "").length === 8;
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!campos.nome.trim() || !campos.tipo_id) {
      toast.error("Informe o nome e o tipo da unidade.");
      return;
    }
    salvar.mutate();
  }
  const id = unidade?.id ?? "nova";

  return (
    <form onSubmit={enviar} className="space-y-3" aria-label={unidade ? `Editar ${nomeDe(unidade)}` : "Nova unidade de saúde"}>
      <Campo rotulo="Nome da unidade" id={`nome-${id}`}>
        <Input id={`nome-${id}`} value={campos.nome} onChange={muda("nome")} required placeholder="Ex.: UBS Jardim Primavera" />
      </Campo>
      <Campo rotulo="Tipo" id={`tipo-${id}`}>
        <select
          id={`tipo-${id}`}
          value={campos.tipo_id}
          onChange={muda("tipo_id")}
          required
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Escolha…</option>
          {[...tipos]
            .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
        </select>
      </Campo>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Campo rotulo="CEP" id={`cep-${id}`}>
          <Input
            id={`cep-${id}`}
            inputMode="numeric"
            value={campos.cep}
            onChange={(e) => {
              const n = e.target.value.replace(/\D/g, "").slice(0, 8);
              setCampos((c) => ({ ...c, cep: n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n }));
            }}
            onBlur={() => cepCompleto && buscar.mutate()}
            placeholder="00000-000"
          />
        </Campo>
        <Campo rotulo="Número" id={`numero-${id}`}>
          <Input id={`numero-${id}`} value={campos.numero} onChange={muda("numero")} onBlur={() => cepCompleto && buscar.mutate()} />
        </Campo>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={!cepCompleto || buscar.isPending} onClick={() => buscar.mutate()}>
        {buscar.isPending ? <Loader2 className="animate-spin" /> : <Search />} Buscar endereço pelo CEP
      </Button>
      {aviso && (
        <p role="status" className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {aviso}
        </p>
      )}
      <Campo rotulo="Rua" id={`rua-${id}`}>
        <Input id={`rua-${id}`} value={campos.endereco} onChange={muda("endereco")} />
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Complemento" id={`compl-${id}`}>
          <Input id={`compl-${id}`} value={campos.complemento} onChange={muda("complemento")} />
        </Campo>
        <Campo rotulo="Bairro" id={`bairro-${id}`}>
          <Input id={`bairro-${id}`} value={campos.bairro} onChange={muda("bairro")} />
        </Campo>
      </div>
      {ponto && token && (
        <figure className="overflow-hidden rounded-xl border border-border">
          <img src={urlSatelite(ponto.latitude, ponto.longitude, token, 600, 240)} alt="O ponto da unidade no mapa, em vista de satélite" className="h-36 w-full object-cover" />
          <figcaption className="px-3 py-1.5 text-[11px] text-muted-foreground">
            Ponto no mapa {ORIGEM_PONTO[ponto.origem ?? ""] ?? ""}. Se não estiver na unidade, confira o número.
          </figcaption>
        </figure>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Telefone" id={`tel-${id}`}>
          <Input id={`tel-${id}`} inputMode="tel" value={campos.telefone} onChange={muda("telefone")} />
        </Campo>
        <Campo rotulo="CNES" id={`cnes-${id}`}>
          <Input id={`cnes-${id}`} inputMode="numeric" value={campos.cnes} onChange={muda("cnes")} maxLength={7} />
        </Campo>
      </div>
      <Campo rotulo="E-mail da unidade" id={`email-${id}`}>
        <Input id={`email-${id}`} type="email" value={campos.email} onChange={muda("email")} />
      </Campo>
      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Check />} {unidade ? "Salvar e marcar como conferida" : "Cadastrar unidade"}
        </Button>
        <Button type="button" variant="ghost" onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function Campo({ rotulo, id, children }: { rotulo: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {rotulo}
      </label>
      {children}
    </div>
  );
}
