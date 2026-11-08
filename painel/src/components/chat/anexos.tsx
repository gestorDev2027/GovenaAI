import { FileText, ImageIcon, Mic } from "lucide-react";

/** Como cada ferramenta aparece no chat e no rastreamento de uma conversa. */
export const ROTULO_FERRAMENTA: Record<string, string> = {
  transferir_para_humano: "Transferiu para a equipe",
  encerrar_atendimento: "Encerrou a conversa",
  consultar_organizacao: "Consultou o cadastro da organização",
  consultar_dados: "Consultou os dados",
  listar_unidades: "Listou as unidades",
  update_user_memory: "Registrou na memória",
};

export interface AnexoExibido {
  tipo: "imagem" | "arquivo" | "audio";
  nome: string;
  /** URL local (arquivo recém-enviado). Sem ela, mostra só o nome (conversa reaberta). */
  url?: string;
}

export function Anexos({ anexos }: { anexos: AnexoExibido[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {anexos.map((a, i) =>
        a.tipo === "imagem" && a.url ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.nome}>
            <img src={a.url} alt={a.nome} className="max-h-48 max-w-56 rounded-xl border object-cover" />
          </a>
        ) : a.tipo === "audio" && a.url ? (
          <audio key={i} controls src={a.url} className="h-10 max-w-64" />
        ) : (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background/50 px-2.5 py-1.5 text-xs"
            title={a.nome}
          >
            {a.tipo === "imagem" ? <ImageIcon className="size-3.5" /> : a.tipo === "audio" ? <Mic className="size-3.5" /> : <FileText className="size-3.5" />}
            <span className="max-w-44 truncate">{a.nome}</span>
          </span>
        ),
      )}
    </div>
  );
}
