import { Fragment } from "react";

/**
 * O texto dos agentes, formatado: negrito com **, listas com "- " / "* " / "•", linhas "---" ou "***" como
 * separador e as quebras de linha. É o que os agentes escrevem (sem Markdown completo, de propósito).
 */
export function TextoSimples({ texto }: { texto: string }) {
  const negrito = (linha: string) =>
    linha.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
      parte.startsWith("**") && parte.endsWith("**") ? <strong key={i}>{parte.slice(2, -2)}</strong> : <Fragment key={i}>{parte}</Fragment>,
    );
  return (
    <>
      {texto.split("\n").map((linha, i) => {
        if (/^\s*([-*_])\1{2,}\s*$/.test(linha)) return <hr key={i} className="my-2 border-border" />;
        const item = linha.match(/^\s*[-*•]\s+(.*)$/);
        if (item)
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span aria-hidden="true" className="text-muted-foreground">
                •
              </span>
              <span>{negrito(item[1])}</span>
            </div>
          );
        return linha.trim() ? <p key={i}>{negrito(linha)}</p> : <div key={i} className="h-2" />;
      })}
    </>
  );
}
