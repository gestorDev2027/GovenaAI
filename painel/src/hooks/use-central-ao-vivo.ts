import { useEffect, useRef, useState } from "react";
import { api, apiEmLinhas, type EventoCentral } from "@/lib/api";

const GUARDAR = 150;

type Linha = EventoCentral | { tipo: "conectado"; ultimo_id: number } | { tipo: "ping" };

/**
 * Os acontecimentos dos atendimentos ao vivo (/secretaria/eventos): começa com o feed recente e segue a
 * conexão aberta; se ela cair, reabre em alguns segundos e busca o que se perdeu (depois_de = último id).
 * `inicio` é o último id que já existia ao abrir a tela: só o que vem depois dele vira animação.
 */
export function useCentralAoVivo() {
  const [eventos, setEventos] = useState<EventoCentral[]>([]);
  const [conectado, setConectado] = useState(false);
  const [inicio, setInicio] = useState<number | null>(null);
  const ultimo = useRef(0);

  useEffect(() => {
    let ativo = true;
    let controle: AbortController | null = null;
    const juntar = (novos: EventoCentral[]) => {
      if (!novos.length) return;
      ultimo.current = Math.max(ultimo.current, ...novos.map((e) => e.id));
      setEventos((atuais) => {
        const vistos = new Set(atuais.map((e) => e.id));
        return [...atuais, ...novos.filter((e) => !vistos.has(e.id))].slice(-GUARDAR);
      });
    };

    const conectar = async () => {
      while (ativo) {
        try {
          const { eventos: recentes } = await api<{ eventos: EventoCentral[] }>(`/secretaria/feed?limite=100&depois_de=${ultimo.current}`);
          juntar(recentes);
          setInicio((i) => i ?? ultimo.current);
          controle = new AbortController();
          await apiEmLinhas<Linha>("/secretaria/eventos", { signal: controle.signal }, (linha) => {
            if (linha.tipo === "conectado") setConectado(true);
            else if (linha.tipo !== "ping") juntar([linha]);
          });
        } catch {
          // Caiu (ou o servidor reiniciou): tenta de novo daqui a pouco.
        }
        setConectado(false);
        if (ativo) await new Promise((r) => setTimeout(r, 4000));
      }
    };
    conectar();
    return () => {
      ativo = false;
      controle?.abort();
    };
  }, []);

  return { eventos, conectado, inicio };
}
