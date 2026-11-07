import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Factory, Plus } from "lucide-react";
import { api, type AgenteFabrica, type OpcoesFabrica } from "@/lib/api";
import { CATEGORIA_FIXA, CORES, FERRAMENTA_OBRIGATORIA, ID_VALIDO, idDoNome } from "@/lib/fabrica";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Campo, PainelLateral } from "@/components/ui/painel-lateral";
import { Alertas, AssistenteIA, type Rascunho } from "./assistente";
import { AvatarAgente, EscolhaDeCor } from "./campos";

/** O que o assistente sugere além da identidade; vai junto no POST. */
type Comportamento = {
  ferramentas: string[];
  categorias: Record<string, string>;
  quando_transferir: string;
  memoria: string;
  minutos_inatividade: number;
};

type RascunhoIA = Rascunho<{ id: string; nome: string; area: string; cargo: string; descricao: string } & Comportamento>;

/**
 * Cria o agente como rascunho: identidade mínima e a transferência para a equipe, ou o que a IA montar a
 * partir de uma descrição (motivos, quando transferir, memória). O servidor já monta as instruções e a
 * base iniciais a partir de um modelo; o resto se ajusta no editor, antes de publicar.
 */
export function NovoAgente({
  aberto,
  aoMudar,
  opcoes,
  ocupadas,
  aoCriar,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  opcoes?: OpcoesFabrica;
  /** Cores dos agentes que já existem: a sugestão é a primeira livre. */
  ocupadas: string[];
  aoCriar: (agente: AgenteFabrica) => void;
}) {
  const qc = useQueryClient();
  const vazio = () => ({
    nome: "",
    id: "",
    idEditado: false,
    descricao: "",
    cargo: "",
    area: "",
    cor: (opcoes?.cores ?? CORES).find((c) => !ocupadas.includes(c.toLowerCase())) ?? CORES[0],
  });
  const [f, setF] = useState(vazio);
  const [sugerido, setSugerido] = useState<RascunhoIA | null>(null);
  const comportamento: Comportamento = {
    ferramentas: sugerido?.ferramentas ?? [FERRAMENTA_OBRIGATORIA],
    categorias: sugerido?.categorias ?? {},
    quando_transferir: sugerido?.quando_transferir ?? "",
    memoria: sugerido?.memoria ?? "",
    minutos_inatividade: sugerido?.minutos_inatividade ?? opcoes?.limites.inatividade_max ?? 1380,
  };
  const id = f.idEditado ? f.id : idDoNome(f.nome);
  const idValido = ID_VALIDO.test(id);
  const pronto = f.nome.trim() && f.descricao.trim() && f.area.trim() && idValido;

  const criar = useMutation({
    mutationFn: () =>
      api<AgenteFabrica>("/fabrica/agentes", {
        method: "POST",
        body: JSON.stringify({
          id,
          nome: f.nome.trim(),
          descricao: f.descricao.trim(),
          cargo: f.cargo.trim(),
          area: f.area.trim(),
          cor: f.cor,
          modelo: null,
          raciocinio: null,
          skills: [],
          ...comportamento,
          ferramentas: [...new Set([...comportamento.ferramentas, FERRAMENTA_OBRIGATORIA])],
          categorias: { ...comportamento.categorias, [CATEGORIA_FIXA.chave]: CATEGORIA_FIXA.rotulo },
        }),
      }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["fabrica-agentes"] });
      qc.invalidateQueries({ queryKey: ["calibracao-opcoes"] });
      toast.success(`${a.nome} criado como rascunho`, { description: "Ajuste as instruções e a base, teste no chat e publique." });
      setF(vazio());
      setSugerido(null);
      aoCriar(a);
    },
    onError: (e: Error) => toast.error("Não foi possível criar o agente", { description: e.message }),
  });

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={aoMudar}
      largura="md"
      rotulo="Fábrica de agentes"
      icone={<Factory className="size-4" />}
      titulo="Novo agente"
      descricao="Nasce como rascunho, com instruções e base de conhecimento de modelo. Só atende depois de publicado."
      rodape={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => aoMudar(false)}>
            Cancelar
          </Button>
          <Button disabled={!pronto || criar.isPending} onClick={() => criar.mutate()}>
            <Plus /> Criar rascunho
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <AssistenteIA<RascunhoIA>
          tipo="agente"
          titulo="Criar com IA"
          ajuda="Descreva o atendimento. A IA preenche nome, área, descrição, motivos de transferência, quando transferir e memória; você revisa antes de criar."
          placeholder="Ex.: uma agente para tirar dúvidas de matrícula dos alunos novos da pós-graduação: prazos, documentos, acesso à plataforma. Pedidos de desconto vão para a equipe."
          rotuloBotao="Criar rascunho com IA"
          aoReceber={(r) => {
            setSugerido(r);
            setF((x) => ({ ...x, nome: r.nome, id: r.id, idEditado: true, descricao: r.descricao, cargo: r.cargo, area: r.area }));
          }}
        />
        {sugerido && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs">
            <div className="font-semibold">Também vai junto, sugerido pela IA</div>
            <div>
              <span className="text-muted-foreground">Motivos de transferência: </span>
              {Object.values(sugerido.categorias).join(", ") || "só “Outro assunto”"}
            </div>
            <div>
              <span className="text-muted-foreground">Ferramentas: </span>
              {sugerido.ferramentas.map((id) => opcoes?.ferramentas.find((x) => x.id === id)?.nome ?? id).join(", ")}
            </div>
            <div className="line-clamp-2">
              <span className="text-muted-foreground">Quando transferir: </span>
              {sugerido.quando_transferir}
            </div>
            <p className="text-muted-foreground">Tudo isso pode ser ajustado no editor depois de criar.</p>
            <Alertas itens={sugerido.alertas ?? []} />
          </div>
        )}
        <Campo rotulo="Nome" ajuda="Como o agente se apresenta e aparece no painel e na Central.">
          <Input autoFocus value={f.nome} maxLength={60} placeholder="Ex.: Bia" onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo
          rotulo="Identificador"
          ajuda={
            idValido || !id
              ? "Usado nos endereços e nos registros. Não muda depois de criado."
              : "Use de 3 a 30 caracteres: letras minúsculas, números e hífen."
          }
        >
          <Input
            className="num"
            value={id}
            maxLength={30}
            aria-invalid={!!id && !idValido}
            onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase(), idEditado: true })}
          />
        </Campo>
        <Campo rotulo="Descrição" ajuda="Uma frase com a função do agente. Aparece como função no AgentOS e na Central.">
          <Input
            value={f.descricao}
            maxLength={160}
            placeholder="Ex.: Tira dúvidas de matrícula e acesso dos alunos novos"
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Cargo" ajuda="Opcional.">
            <Input value={f.cargo} maxLength={60} placeholder="Ex.: Atendimento" onChange={(e) => setF({ ...f, cargo: e.target.value })} />
          </Campo>
          <Campo rotulo="Área" ajuda="Agrupa os agentes nos filtros do painel.">
            <Input list="fabrica-areas-novo" value={f.area} maxLength={60} onChange={(e) => setF({ ...f, area: e.target.value })} />
            <datalist id="fabrica-areas-novo">
              {opcoes?.areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Campo>
        </div>
        <Campo rotulo="Cor" ajuda="A cor do agente na Central e nos filtros.">
          <div className="flex flex-wrap items-center gap-4">
            <AvatarAgente cor={f.cor} tamanho="lg" />
            <EscolhaDeCor valor={f.cor} cores={opcoes?.cores} aoMudar={(cor) => setF({ ...f, cor })} />
          </div>
        </Campo>
      </div>
    </PainelLateral>
  );
}
