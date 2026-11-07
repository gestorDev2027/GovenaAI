import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { api, type AgenteFabrica, type OpcoesFabrica } from "@/lib/api";
import { CORES, ID_VALIDO, idDoNome } from "@/lib/fabrica";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Campo, PainelLateral } from "@/components/ui/painel-lateral";
import { AvatarAgente, EscolhaDeCor } from "./campos";

type Resultado = AgenteFabrica & { documentos_copiados: { copiados: string[]; falhas: { nome: string; erro: string }[] } | null };

/**
 * Duplica um agente em rascunho: a configuração, as instruções vigentes e o roteiro da base vêm do original e,
 * marcado, também os documentos em uso. A cópia é um agente do painel: edita, testa, publica e exclui como
 * qualquer outro, e o original não muda. Os exemplos da Calibração não vêm: cada agente forma os seus.
 */
export function DuplicarAgente({
  original,
  aoFechar,
  opcoes,
  ocupadas,
  aoDuplicar,
}: {
  original: AgenteFabrica | null;
  aoFechar: () => void;
  opcoes?: OpcoesFabrica;
  /** Cores dos agentes que já existem: a sugestão é a primeira livre. */
  ocupadas: string[];
  aoDuplicar: (agente: AgenteFabrica) => void;
}) {
  const qc = useQueryClient();
  const inicial = (a: AgenteFabrica | null) => ({
    nome: a ? `${a.nome} (cópia)` : "",
    id: "",
    idEditado: false,
    descricao: a?.descricao ?? "",
    cor: (opcoes?.cores ?? CORES).find((c) => !ocupadas.includes(c.toLowerCase())) ?? CORES[0],
    documentos: true,
  });
  const [f, setF] = useState(() => inicial(original));
  // Cada vez que abre para um agente, o formulário recomeça com os dados dele.
  useEffect(() => {
    if (original) setF(inicial(original));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original?.id]);

  const id = f.idEditado ? f.id : idDoNome(f.nome);
  const idValido = ID_VALIDO.test(id);
  const pronto = !!original && f.nome.trim() && f.descricao.trim() && idValido;

  const duplicar = useMutation({
    mutationFn: () =>
      api<Resultado>(`/fabrica/agentes/${encodeURIComponent(original!.id)}/duplicar`, {
        method: "POST",
        body: JSON.stringify({ id, nome: f.nome.trim(), descricao: f.descricao.trim(), cor: f.cor, copiar_documentos: f.documentos }),
      }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["fabrica-agentes"] });
      qc.invalidateQueries({ queryKey: ["calibracao-opcoes"] });
      const docs = a.documentos_copiados;
      const partes = [
        docs ? `${docs.copiados.length} documento(s) copiado(s)` : "sem documentos",
        ...(docs?.falhas.length ? [`${docs.falhas.length} não copiado(s): ${docs.falhas.map((x) => x.nome).join(", ")}`] : []),
      ];
      toast.success(`${a.nome} criado como rascunho`, { description: `Cópia de ${original?.nome}: ${partes.join("; ")}. Teste no chat e publique.` });
      aoDuplicar(a);
    },
    onError: (e: Error) => toast.error("Não foi possível duplicar o agente", { description: e.message }),
  });

  return (
    <PainelLateral
      aberto={!!original}
      aoMudar={(aberto) => !aberto && aoFechar()}
      largura="md"
      rotulo="Fábrica de agentes"
      icone={<Copy className="size-4" />}
      titulo={original ? `Duplicar ${original.nome}` : "Duplicar agente"}
      descricao="A cópia nasce como rascunho e só atende depois de publicada. O original não muda."
      rodape={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={!pronto || duplicar.isPending} onClick={() => duplicar.mutate()}>
            <Copy /> {duplicar.isPending ? "Duplicando…" : "Duplicar"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-3 text-xs leading-relaxed">
          <div className="font-semibold">O que vem de {original?.nome}</div>
          <p className="text-muted-foreground">
            Área, cargo, modelo, ferramentas, skills, motivos de transferência, quando transferir, memória, prazo de inatividade, as
            instruções em uso e o roteiro da base de conhecimento. Depois de criada, a cópia se edita e se exclui como qualquer agente
            do painel.
          </p>
          <p className="text-muted-foreground">
            Não vêm os exemplos da Calibração (cada agente forma os seus) nem o lugar nas equipes e no Canal WhatsApp. Para as
            boas-vindas com a janela de 24 h fechada, a cópia precisa do próprio template (UNNICHAT_TEMPLATE_BOAS_VINDAS_
            <span className="num">{(id || "ID").toUpperCase()}</span>).
          </p>
        </div>
        <Campo rotulo="Nome" ajuda="Como a cópia se apresenta e aparece no painel e na Central.">
          <Input autoFocus value={f.nome} maxLength={60} onChange={(e) => setF({ ...f, nome: e.target.value })} />
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
        <Campo rotulo="Descrição" ajuda="Uma frase com a função da cópia. Vale mudar para dizer no que ela difere do original.">
          <Input value={f.descricao} maxLength={160} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        </Campo>
        <Campo rotulo="Cor" ajuda="A cor da cópia na Central e nos filtros.">
          <div className="flex flex-wrap items-center gap-4">
            <AvatarAgente cor={f.cor} tamanho="lg" />
            <EscolhaDeCor valor={f.cor} cores={opcoes?.cores} aoMudar={(cor) => setF({ ...f, cor })} />
          </div>
        </Campo>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={f.documentos}
            onChange={(e) => setF({ ...f, documentos: e.target.checked })}
          />
          <span>
            <span className="font-medium">Copiar também os documentos da base</span>
            <span className="block text-xs text-muted-foreground">
              A versão em uso de cada documento, já processada. Excluir um documento na cópia não mexe no original.
            </span>
          </span>
        </label>
      </div>
    </PainelLateral>
  );
}
