import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Loader2, Timer, Workflow, X } from "lucide-react";
import { api } from "@/lib/api";
import { TextoSimples } from "@/components/widgets/texto-simples";

/*
 * O chat com o Assistente de Processos (na página Atividades e processos), no estilo da implantação: o assistente em
 * texto limpo, a pessoa em balão azul-claro, "Trabalhou por N s" e o campo embaixo. O assistente propõe e grava só o
 * que a pessoa confirmar; depois de cada resposta, a lista de atividades se atualiza.
 */

type Mensagem = { papel: "contato" | "agente"; texto: string; segundos?: number };
interface Conversa {
  boas_vindas: string;
  historico: { papel: "contato" | "agente"; texto: string }[];
}

const RESPOSTAS_RAPIDAS = ["Sim, pode gravar", "Quero ajustar"];

export function ChatProcessos({ aoFechar }: { aoFechar: () => void }) {
  const qc = useQueryClient();
  const conversa = useQuery({
    queryKey: ["processos-conversa"],
    queryFn: () => api<Conversa>("/organizacao/processos/conversa"),
    staleTime: Infinity,
    retry: false,
  });
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [desde, setDesde] = useState<number | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const fim = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!conversa.data) return;
    setMensagens([{ papel: "agente", texto: conversa.data.boas_vindas }, ...conversa.data.historico]);
  }, [conversa.data]);
  useEffect(() => {
    if (desde == null) return;
    const relogio = setInterval(() => setAgora(Date.now()), 500);
    return () => clearInterval(relogio);
  }, [desde]);
  const primeiraRolagem = useRef(true);
  useEffect(() => {
    const lista = fim.current?.parentElement;
    if (!lista) return;
    lista.scrollTo({ top: lista.scrollHeight, behavior: primeiraRolagem.current ? "auto" : "smooth" });
    if (mensagens.length) primeiraRolagem.current = false;
  }, [mensagens, enviando]);

  async function enviar(e?: FormEvent, pronta?: string) {
    e?.preventDefault();
    const mensagem = (pronta ?? texto).trim();
    if (!mensagem || enviando) return;
    setErro(null);
    if (!pronta) setTexto("");
    setMensagens((m) => [...m, { papel: "contato", texto: mensagem }]);
    setEnviando(true);
    const comeco = Date.now();
    setDesde(comeco);
    setAgora(comeco);
    try {
      const r = await api<{ resposta: string | null }>("/organizacao/processos/mensagem", {
        method: "POST",
        body: JSON.stringify({ mensagem }),
      });
      const segundos = Math.max(1, Math.round((Date.now() - comeco) / 1000));
      if (r.resposta) setMensagens((m) => [...m, { papel: "agente", texto: r.resposta as string, segundos }]);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "O assistente não conseguiu responder agora.");
    } finally {
      // Mesmo com erro, o assistente pode ter gravado algo antes de falhar: a lista se atualiza sempre.
      qc.invalidateQueries({ queryKey: ["organizacao-atividades"] });
      setEnviando(false);
      setDesde(null);
      caixa.current?.focus();
    }
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void enviar();
    }
  }

  const ultima = mensagens.at(-1);
  const rapidas = !enviando && ultima?.papel === "agente" && ultima.texto.trim().endsWith("?") ? RESPOSTAS_RAPIDAS : [];

  return (
    <section aria-label="Conversa com o Assistente de Processos" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-text">
            <Workflow className="size-3.5" />
          </span>
          <span className="truncate">Assistente de Processos</span>
        </span>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar a conversa"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="thin-scroll relative min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-4 pb-6" aria-live="polite">
        {conversa.isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Abrindo a conversa
          </p>
        )}
        {conversa.isError && (
          <p role="alert" className="text-sm text-destructive">
            {(conversa.error as Error).message}
          </p>
        )}
        {mensagens.map((m, i) => (m.papel === "agente" ? <RespostaDoAssistente key={i} m={m} /> : <MensagemDaPessoa key={i} texto={m.texto} />))}
        {enviando && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Trabalhando{desde ? ` · ${Math.max(0, Math.round((agora - desde) / 1000))} s` : ""}
          </div>
        )}
        <div ref={fim} />
      </div>

      <form onSubmit={enviar} className="px-3 pb-3">
        {erro && (
          <p role="alert" className="mb-2 px-1 text-sm text-destructive">
            {erro}
          </p>
        )}
        {rapidas.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <p className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">Responder rápido</p>
            <ul>
              {rapidas.map((r, n) => (
                <li key={r}>
                  <button
                    type="button"
                    onClick={() => void enviar(undefined, r)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm outline-none hover:bg-secondary focus-visible:bg-secondary"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-md border border-border text-[11px] font-semibold text-muted-foreground">{n + 1}</span>
                    {r}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="rounded-2xl border border-border bg-background shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_rgba(26,99,216,0.12)]">
          <label htmlFor="mensagem-processos" className="sr-only">
            Mensagem para o Assistente de Processos
          </label>
          <textarea
            ref={caixa}
            id="mensagem-processos"
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={teclas}
            placeholder="Mensagem para o assistente…"
            className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
            <span className="text-[11px] text-muted-foreground">Enter envia · Shift+Enter quebra a linha</span>
            <button
              type="submit"
              disabled={enviando || !texto.trim()}
              aria-label="Enviar"
              className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function RespostaDoAssistente({ m }: { m: Mensagem }) {
  return (
    <div className="space-y-2">
      <div className="text-[15px] leading-relaxed text-foreground">
        <span className="sr-only">Assistente: </span>
        <TextoSimples texto={m.texto} />
      </div>
      {m.segundos != null && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Timer className="size-3.5" /> Trabalhou por {m.segundos} s
        </p>
      )}
    </div>
  );
}

function MensagemDaPessoa({ texto }: { texto: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-[#E3ECFB] px-4 py-2 text-[15px] leading-relaxed whitespace-pre-wrap text-[#0D1B38] dark:bg-[#1A63D8]/25 dark:text-white">
        <span className="sr-only">Você: </span>
        {texto}
      </div>
    </div>
  );
}
