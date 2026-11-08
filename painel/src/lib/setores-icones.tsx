import type { ReactNode } from "react";
import { BookOpen, Building2, FileSearch, Inbox, Landmark, Library, MessagesSquare, Package } from "lucide-react";
import type { SetorId } from "./setores";

/** O ícone de cada sala do escritório da Secretaria 3D. */
export const ICONE_SETOR: Record<SetorId, ReactNode> = {
  atendimento: <MessagesSquare />,
  recepcao: <Inbox />,
  secretaria: <FileSearch />,
  fontes: <Library />,
  base: <BookOpen />,
  implantacao: <Package />,
  catalogo: <Landmark />,
  equipe: <Building2 />,
};
