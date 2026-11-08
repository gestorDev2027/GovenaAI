import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type { EventoCentral } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RoboAgente, type Humor } from "./robo-agente";
import type { PosturaAgente } from "./agente-ia";
import { ANDAR, CascaDoAndar, PE_DIREITO, Quarteirao, limitesDoQuarteirao } from "./exterior";
import { Banner, Cadeira, DivisoriaVidro, Estacao, Estante, PALETAS, Planta, SalaReuniao, TvAula, type Paleta } from "./moveis";
import { ControleCamera, PisoClicavel, Projetor, useEscuro, type Alvo, type ApiCamera, type Retangulo, type Rotulo } from "./escritorio";

/*
 * O prédio da Secretaria de Saúde pelo cadastro da prefeitura: cada SETOR é uma sala de vidro, com o agente do
 * setor sentado na mesa dele, a placa com o nome e o responsável. No centro, o CCO (Centro de Comando e Operações),
 * de onde a secretaria acompanha tudo. As salas nascem na implantação: setor novo, sala nova; agente ligado ao
 * setor, robô na mesa. Quando um agente trabalha (ao vivo), o rosto dele muda (pensando, feliz, alerta).
 */

export interface SetorNoPredio {
  id: string;
  nome: string;
  responsavel?: { nome: string } | null;
  agentes: { agente_id: string }[];
}
export interface AgenteNoPredio {
  id: string;
  nome: string;
  cor?: string | null;
}
export type SelecaoPredio = { tipo: "setor" | "agente" | "cco"; id: string } | null;

// Medidas (metros da cena).
const SALA_L = 7;
const SALA_P = 5.6;
const MEIO = 8.4; // a faixa do meio: corredor em volta do CCO
const CCO_L = 9;
const CCO_P = 4.4;
const PORTA = 1.6;
const ESPESSURA_PISO = 0.12;
const CORES = ["#1A63D8", "#52A2FF", "#F4B800", "#22c55e", "#ec4899", "#a855f7", "#14b8a6", "#f97316"];
const PARADO: PosturaAgente = { emPe: 0, andando: false, buscando: false, levando: false, passo: 0 };

/** A expressão do robô diante de cada acontecimento ao vivo, e por quantos segundos. */
const REACOES: Partial<Record<EventoCentral["tipo"], [Humor, number]>> = {
  mensagem: ["foco", 4],
  pensando: ["pensando", 6],
  ferramenta: ["pensando", 4],
  respondeu: ["feliz", 3],
  transferiu: ["levando", 3],
  encerrou: ["feliz", 4],
  erro: ["alerta", 8],
  guardrail: ["alerta", 8],
};

interface Sala {
  setor: SetorNoPredio;
  ret: Retangulo;
  cor: string;
  /** A sala fica na fileira de cima (porta para +z) ou de baixo (porta para -z). */
  cima: boolean;
}

function montarPlanta(setores: SetorNoPredio[]) {
  const colunas = Math.max(2, Math.ceil(setores.length / 2));
  const largura = colunas * SALA_L;
  const x0 = -largura / 2;
  const salas: Sala[] = setores.map((setor, i) => {
    const cima = i < colunas;
    const col = cima ? i : i - colunas;
    const z0 = cima ? -MEIO / 2 - SALA_P : MEIO / 2;
    return {
      setor,
      cima,
      cor: CORES[i % CORES.length],
      ret: { x0: x0 + col * SALA_L, x1: x0 + (col + 1) * SALA_L, z0, z1: z0 + SALA_P },
    };
  });
  const z0 = -MEIO / 2 - SALA_P;
  const z1 = MEIO / 2 + SALA_P;
  return { salas, largura, profundidade: z1 - z0, x0, x1: x0 + largura, z0, z1 };
}

export default function PredioSecretaria({
  setores,
  agentes,
  eventos,
  inicio,
  selecao,
  aoSelecionar,
  margemDireita,
  api,
  aberto,
  aoAbrir,
}: {
  setores: SetorNoPredio[];
  agentes: AgenteNoPredio[];
  eventos: EventoCentral[];
  inicio: number | null;
  selecao: SelecaoPredio;
  aoSelecionar: (s: SelecaoPredio) => void;
  margemDireita: number;
  api: MutableRefObject<ApiCamera | null>;
  aberto: boolean;
  aoAbrir: () => void;
}) {
  const escuro = useEscuro();
  const p = escuro ? PALETAS.escuro : PALETAS.claro;
  const planta = useMemo(() => montarPlanta(setores), [setores]);
  const predio = useMemo(
    () => ({ x0: planta.x0 - 0.5, x1: planta.x1 + 0.5, z0: planta.z0 - 0.5, z1: planta.z1 + 0.5 }),
    [planta],
  );
  const centro = new THREE.Vector3(0, 0, 0);
  const geral = useMemo<Alvo>(() => {
    if (aberto) return { centro: new THREE.Vector3(0, 0, 0), largura: planta.largura + 3, profundidade: planta.profundidade + 3, altura: 2.4 };
    const q = limitesDoQuarteirao(predio);
    return {
      centro: new THREE.Vector3((q.x0 + q.x1) / 2 + 2, -ANDAR / 2, (q.z0 + q.z1) / 2 + 2),
      largura: q.x1 - q.x0 - 20,
      profundidade: q.z1 - q.z0 - 20,
      altura: ANDAR + PE_DIREITO + 2,
    };
  }, [aberto, planta, predio]);
  const salaEmFoco = selecao?.tipo === "setor" ? planta.salas.find((s) => s.setor.id === selecao.id) : undefined;
  const foco = useMemo<Alvo | null>(() => {
    if (!salaEmFoco) return null;
    const r = salaEmFoco.ret;
    return { centro: new THREE.Vector3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2), largura: SALA_L + 2, profundidade: SALA_P + 2, altura: 2.4 };
  }, [salaEmFoco]);

  // As reações ao vivo: um ref por agente, que o robô lê a cada quadro.
  const reacoes = useRef<Record<string, { humor: Humor; ate: number } | null>>({});
  const visto = useRef(0);
  const [ativos, setAtivos] = useState<Record<string, number>>({});
  useEffect(() => {
    if (inicio == null) return;
    const novos = eventos.filter((e) => e.id > Math.max(visto.current, inicio));
    if (!novos.length) return;
    visto.current = Math.max(visto.current, ...novos.map((e) => e.id));
    const agora = performance.now();
    const marcados: Record<string, number> = {};
    for (const e of novos) {
      const r = REACOES[e.tipo];
      if (r) reacoes.current[e.agente] = { humor: r[0], ate: agora + r[1] * 1000 };
      marcados[e.agente] = Date.now();
    }
    setAtivos((a) => ({ ...a, ...marcados }));
  }, [eventos, inicio]);

  const nomeDe = (id: string) => agentes.find((a) => a.id === id)?.nome ?? id;
  const corDe = (id: string, padrao: string) => agentes.find((a) => a.id === id)?.cor || padrao;

  const rotulos: Rotulo[] = [
    ...planta.salas.map((s) => {
      const agente = s.setor.agentes[0]?.agente_id;
      const ativa = selecao?.tipo === "setor" && selecao.id === s.setor.id;
      return {
        id: `sala-${s.setor.id}`,
        posicao: new THREE.Vector3((s.ret.x0 + s.ret.x1) / 2, 3.1, s.cima ? s.ret.z1 - 0.4 : s.ret.z0 + 0.4),
        conteudo: (
          <button
            type="button"
            onClick={() => aoSelecionar({ tipo: "setor", id: s.setor.id })}
            className={cn(
              "flex max-w-56 flex-col items-start rounded-xl border bg-white/95 px-2.5 py-1.5 text-left shadow-md backdrop-blur dark:bg-[#0D1B38]/90",
              ativa ? "border-[#1A63D8] ring-2 ring-[#1A63D8]/40" : "border-white/60 dark:border-white/10",
            )}
          >
            <span className="flex items-center gap-1.5 text-[12px] leading-tight font-semibold text-[#0D1B38] dark:text-white">
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.cor }} />
              {s.setor.nome}
            </span>
            <span className="text-[10px] leading-tight text-[#424E6B] dark:text-white/70">
              {agente ? nomeDe(agente) : "sem agente"} · {s.setor.responsavel?.nome ?? "sem responsável"}
            </span>
          </button>
        ),
      };
    }),
    {
      id: "cco",
      posicao: new THREE.Vector3(0, 3.3, CCO_P / 2),
      conteudo: (
        <button
          type="button"
          onClick={() => aoSelecionar({ tipo: "cco", id: "cco" })}
          className="rounded-full border border-[#F4B800]/60 bg-[#0D1B38]/90 px-3 py-1 text-[12px] font-semibold text-white shadow-md"
        >
          CCO · Centro de Comando
        </button>
      ),
    },
  ];
  const elementos = useRef<Record<string, HTMLDivElement | null>>({});
  const [, setPronto] = useState(false);
  useEffect(() => setPronto(true), []);

  return (
    <div className="relative h-full w-full">
      <Canvas
        orthographic
        shadows
        flat
        dpr={[1, 2]}
        camera={{ position: [40, 37, 40], zoom: 20, near: -200, far: 400 }}
        onPointerMissed={() => aoSelecionar(null)}
      >
        <ambientLight intensity={p.luzAmbiente} />
        <hemisphereLight args={[p.ceu, p.chao, 0.6]} />
        <directionalLight castShadow position={[20, 34, 18]} intensity={p.luzSol} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}>
          <orthographicCamera attach="shadow-camera" args={[-planta.largura / 2 - 8, planta.largura / 2 + 8, 24, -24, 0.5, 120]} />
        </directionalLight>

        <Suspense fallback={null}>
          <group position={[0, -ANDAR, 0]}>
            <Quarteirao p={p} predio={predio} escuro={escuro} entradaX={0} />
          </group>
          <CascaDoAndar predio={predio} escuro={escuro} aberto={aberto} aoAbrir={aoAbrir} />
        </Suspense>

        {/* O piso do andar */}
        <mesh position={[centro.x, -ESPESSURA_PISO / 2, centro.z]} receiveShadow>
          <boxGeometry args={[planta.largura + 1, ESPESSURA_PISO, planta.profundidade + 1]} />
          <meshStandardMaterial color={p.piso} roughness={0.55} metalness={0.15} />
        </mesh>

        {/* As salas dos setores */}
        {planta.salas.map((s) => {
          const agente = s.setor.agentes[0]?.agente_id;
          return (
            <SalaDoSetor
              key={s.setor.id}
              sala={s}
              p={p}
              ativa={selecao?.tipo === "setor" && selecao.id === s.setor.id}
              aoSelecionar={() => aoSelecionar({ tipo: "setor", id: s.setor.id })}
              agente={agente ? { id: agente, cor: corDe(agente, s.cor) } : null}
              agenteDestacado={selecao?.tipo === "agente" && selecao.id === agente}
              ocupado={!!agente && Date.now() - (ativos[agente] ?? 0) < 120_000}
              aoClicarAgente={() => agente && aoSelecionar({ tipo: "agente", id: agente })}
              reacao={agente ? { get current() { return reacoes.current[agente] ?? null; }, set current(v) { reacoes.current[agente] = v; } } : undefined}
            />
          );
        })}

        {/* O CCO, no centro */}
        <CCO p={p} ativo={selecao?.tipo === "cco"} aoClicar={() => aoSelecionar({ tipo: "cco", id: "cco" })} />

        <ControleCamera geral={geral} foco={foco} margemDireita={margemDireita} api={api} />
        <Projetor rotulos={aberto ? rotulos : []} elementos={elementos} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {aberto &&
          rotulos.map((r) => (
            <div
              key={r.id}
              ref={(el) => {
                elementos.current[r.id] = el;
              }}
              className="pointer-events-auto absolute top-0 left-0 will-change-transform"
              style={{ visibility: "hidden" }}
            >
              {r.conteudo}
            </div>
          ))}
      </div>
    </div>
  );
}

/** Uma parede de vidro de x0 a x1 em z (ou, com `emZ`, de z0 a z1 em x), com um vão de porta no meio. */
function Parede({ p, de, ate, em, emZ = false, porta = false }: { p: Paleta; de: number; ate: number; em: number; emZ?: boolean; porta?: boolean }) {
  const trechos: [number, number][] = porta
    ? [
        [de, (de + ate) / 2 - PORTA / 2],
        [(de + ate) / 2 + PORTA / 2, ate],
      ]
    : [[de, ate]];
  return (
    <>
      {trechos.map(([a, b]) => {
        const meio = (a + b) / 2;
        return (
          <group key={a} position={emZ ? [em, 0, meio] : [meio, 0, em]} rotation={[0, emZ ? Math.PI / 2 : 0, 0]}>
            <DivisoriaVidro p={p} comprimento={b - a} altura={2.4} />
          </group>
        );
      })}
    </>
  );
}

function SalaDoSetor({
  sala,
  p,
  ativa,
  aoSelecionar,
  agente,
  agenteDestacado,
  ocupado,
  aoClicarAgente,
  reacao,
}: {
  sala: Sala;
  p: Paleta;
  ativa: boolean;
  aoSelecionar: () => void;
  agente: { id: string; cor: string } | null;
  agenteDestacado: boolean;
  ocupado: boolean;
  aoClicarAgente: () => void;
  reacao?: MutableRefObject<{ humor: Humor; ate: number } | null>;
}) {
  const { ret, cima, cor } = sala;
  const cx = (ret.x0 + ret.x1) / 2;
  // A mesa fica no fundo da sala, com quem senta de costas para a parede do fundo e de frente para a porta.
  const fundoZ = cima ? ret.z0 : ret.z1;
  const mesaZ = cima ? ret.z0 + 2.2 : ret.z1 - 2.2;
  const giro = cima ? 0 : Math.PI;
  const cadeiraZ = cima ? mesaZ - 0.95 : mesaZ + 0.95;
  const postura = useRef<PosturaAgente>({ ...PARADO });
  return (
    <group>
      <PisoClicavel ret={ret} cor={cor} ativo={ativa} aoClicar={aoSelecionar} opacidade={0.16} />
      {/* Paredes: o fundo e os lados inteiros; a frente (para o corredor) com a porta */}
      <Parede p={p} de={ret.x0} ate={ret.x1} em={fundoZ} />
      <Parede p={p} de={ret.z0} ate={ret.z1} em={ret.x0} emZ />
      <Parede p={p} de={ret.z0} ate={ret.z1} em={ret.x1} emZ />
      <Parede p={p} de={ret.x0} ate={ret.x1} em={cima ? ret.z1 : ret.z0} porta />
      {/* Estante no fundo e uma planta no canto */}
      <group position={[ret.x0 + 1.4, 0, cima ? fundoZ + 0.3 : fundoZ - 0.3]} rotation={[0, cima ? 0 : Math.PI, 0]}>
        <Estante p={p} largura={1.6} />
      </group>
      <Planta p={p} posicao={[ret.x1 - 0.6, 0, cima ? ret.z1 - 0.6 : ret.z0 + 0.6]} escala={0.8} />
      {/* A mesa do agente */}
      <group position={[cx, 0, mesaZ]} rotation={[0, giro, 0]}>
        <Estacao p={p} ocupada={!!agente} cor={agente?.cor ?? cor} />
      </group>
      <group position={[cx, 0, cadeiraZ]} rotation={[0, giro, 0]}>
        <Cadeira p={p} />
      </group>
      {agente && (
        <group position={[cx, 0, cadeiraZ]} rotation={[0, giro, 0]}>
          <Suspense fallback={null}>
            <RoboAgente cor={agente.cor} ocupado={ocupado} destacado={agenteDestacado} aoClicar={aoClicarAgente} postura={postura} reacao={reacao} />
          </Suspense>
        </group>
      )}
    </group>
  );
}

function CCO({ p, ativo, aoClicar }: { p: Paleta; ativo: boolean; aoClicar: () => void }) {
  const ret = { x0: -CCO_L / 2, x1: CCO_L / 2, z0: -CCO_P / 2, z1: CCO_P / 2 };
  return (
    <group>
      <PisoClicavel ret={ret} cor="#F4B800" ativo={ativo} aoClicar={aoClicar} opacidade={0.18} />
      <Parede p={p} de={ret.x0} ate={ret.x1} em={ret.z0} />
      <Parede p={p} de={ret.z0} ate={ret.z1} em={ret.x0} emZ porta />
      <Parede p={p} de={ret.z0} ate={ret.z1} em={ret.x1} emZ porta />
      <Parede p={p} de={ret.x0} ate={ret.x1} em={ret.z1} porta />
      <Suspense fallback={null}>
        <group position={[0, 0, 0.3]}>
          <SalaReuniao p={p} />
        </group>
        <group position={[-2.2, 1.5, ret.z0 + 0.15]}>
          <TvAula />
        </group>
        <group position={[2.2, 1.5, ret.z0 + 0.15]}>
          <TvAula />
        </group>
        <group position={[0, 1.9, ret.z0 + 0.1]}>
          <Banner cor="#F4B800" />
        </group>
      </Suspense>
    </group>
  );
}
