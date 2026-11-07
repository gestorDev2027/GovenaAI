import { useEffect, useRef, useState } from "react";

const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Anima de um número ao outro quando `target` muda. Respeita reduced-motion. */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const valorRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const aplicar = (v: number) => {
      valorRef.current = v;
      setValue(v);
    };
    if (prefersReduced() || duration <= 0) {
      aplicar(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) {
      aplicar(target);
      return;
    }
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / duration);
      aplicar(from + delta * (1 - Math.pow(1 - p, 3)));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = valorRef.current;
    };
  }, [target, duration]);

  return value;
}
