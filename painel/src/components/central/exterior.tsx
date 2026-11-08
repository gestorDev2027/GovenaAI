import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { DivisoriaVidro, LogoGestorGov, Planta, Sofa, type Paleta } from "./moveis";

/*
 * O prédio da Secretaria de Saúde numa maquete de quarteirão. O escritório (a cena da Central) fica no segundo andar; embaixo,
 * o térreo de vidro com a recepção, os elevadores e a entrada com marquise e totem. Em volta, calçada, jardins
 * (cerca viva, canteiros floridos, árvores de três tipos e uma praça com chafariz) e duas ruas, na frente e à
 * direita (os lados que a câmera vê), com faixa, postes e carros passando.
 *
 * Fechado, o segundo andar tem fachada de vidro escuro e cobertura com painéis solares e o letreiro: é a
 * vista de fora. Ao abrir (clique no prédio ou numa seleção), a cobertura sobe e some e a fachada fica
 * transparente, mostrando o escritório. No tema escuro é noite: postes, faróis e filetes de luz acesos.
 *
 * Coordenadas: o Quarteirao usa o piso do térreo como y = 0 (a cena o coloca em y = -ANDAR); a casca do
 * segundo andar usa o piso do escritório como y = 0, como o resto da cena.
 */

export interface RetanguloPredio {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Altura do térreo (do piso dele ao piso do escritório). */
export const ANDAR = 3.4;
/** Altura do segundo andar até a laje da cobertura. */
export const PE_DIREITO = 3.3;
const NIVEL_RUA = -0.45;
const LAJE = 0.4;
const CALCADA = 2.4;
const JARDIM = 3.2;
const RUA = 5.2;
const CALCADA_LONGE = 2;
const MARGEM_LONGE = 4;
const MARGEM_FUNDO = 11;
const ENTRADA = 2.8;

const CORES = {
  escuro: {
    base: "#141922", grama: "#1d3a2b", gramaFaixa: "#203f2f", gramaClara: "#24452f", calcada: "#4a515c", piso: "#5a616d",
    asfalto: "#16191f", faixa: "#c9ced6", pedra: "#2a303b", laje: "#3b4350", led: "#F4B800", poste: "#1e2430",
    lampada: "#ffd9a0", tronco: "#5b4130", folha: "#2f8f5f", folhaEscura: "#23704a", cipreste: "#1f6b46", florida: "#d9779f",
    sebe: "#256b45", terra: "#3a2a20", agua: "#38bdf8", flor: ["#f472b6", "#facc15", "#a78bfa", "#fb923c"], banco: "#7c5a3c",
    vidroFachada: "#1c3552", cobertura: "#2b313c", solar: "#1d3b78", luzPoca: 0.55, farol: 1, janela: 0.9,
  },
  claro: {
    base: "#c3cad4", grama: "#8cc28a", gramaFaixa: "#93c891", gramaClara: "#9fd09b", calcada: "#e3e5e8", piso: "#f1f2f4",
    asfalto: "#4b515b", faixa: "#ffffff", pedra: "#b9c0ca", laje: "#eef0f3", led: "#F4B800", poste: "#3b4250",
    lampada: "#fff4d6", tronco: "#7a5638", folha: "#3fa56e", folhaEscura: "#2f8a59", cipreste: "#2a7a50", florida: "#f0a3c2",
    sebe: "#3a9a62", terra: "#6b4a33", agua: "#7dd3fc", flor: ["#ec4899", "#eab308", "#8b5cf6", "#1A63D8"], banco: "#9a7350",
    vidroFachada: "#5f86ad", cobertura: "#d5d9df", solar: "#27477f", luzPoca: 0, farol: 0.35, janela: 0.35,
  },
};
type Cores = (typeof CORES)["escuro"];

function cores(escuro: boolean): Cores {
  return escuro ? CORES.escuro : CORES.claro;
}

/** Gradiente radial (branco no meio, transparente na borda): sombra das árvores e poça de luz dos postes. */
function useGradienteRadial() {
  const textura = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useEffect(() => () => textura.dispose(), [textura]);
  return textura;
}

/** Texto branco numa textura (letreiros), uma linha por item. */
function useTextoEmTextura(linhas: string[], largura = 512, altura = 128) {
  const chave = linhas.join("|");
  const textura = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d")!;
    const texto = chave.split("|");
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(altura / (texto.length + 0.9))}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    texto.forEach((l, i) => ctx.fillText(l, largura / 2, (altura / texto.length) * (i + 0.5)));
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [chave, largura, altura]);
  useEffect(() => () => textura.dispose(), [textura]);
  return textura;
}

/** Determinístico: o mesmo quarteirão a cada carga (a posição das árvores não pula). */
function aleatorio(semente: number) {
  let s = semente;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ───────── Jardim ───────── */

type TipoArvore = "copa" | "cipreste" | "florida";

function Arvore({ c, tipo, posicao, escala = 1, sombra }: { c: Cores; tipo: TipoArvore; posicao: [number, number, number]; escala?: number; sombra: THREE.Texture }) {
  const cipreste = tipo === "cipreste";
  return (
    <group position={posicao} scale={escala}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={cipreste ? [1.4, 1.4] : [2.4, 2.4]} />
        <meshBasicMaterial map={sombra} color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[0, cipreste ? 0.3 : 0.7, 0]}>
        <cylinderGeometry args={[0.07, 0.11, cipreste ? 0.6 : 1.4, 8]} />
        <meshStandardMaterial color={c.tronco} roughness={0.9} />
      </mesh>
      {cipreste ? (
        <mesh position={[0, 1.55, 0]}>
          <coneGeometry args={[0.55, 2.4, 9]} />
          <meshStandardMaterial color={c.cipreste} roughness={0.85} flatShading />
        </mesh>
      ) : (
        [
          [0, 1.75, 0, 0.75],
          [0.35, 1.45, 0.15, 0.5],
          [-0.3, 1.5, -0.1, 0.52],
          [0.05, 2.2, -0.05, 0.48],
        ].map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]}>
            <icosahedronGeometry args={[r, 1]} />
            <meshStandardMaterial color={tipo === "florida" ? (i % 2 ? c.florida : "#f6c1d6") : i % 2 ? c.folhaEscura : c.folha} roughness={0.85} flatShading />
          </mesh>
        ))
      )}
    </group>
  );
}

/** Cerca viva aparada ao longo de x (ou girada). */
function Sebe({ c, posicao, comprimento, giro = 0 }: { c: Cores; posicao: [number, number, number]; comprimento: number; giro?: number }) {
  if (comprimento <= 0.5) return null;
  return (
    <RoundedBox args={[comprimento, 0.6, 0.55]} radius={0.12} position={[posicao[0], posicao[1] + 0.3, posicao[2]]} rotation={[0, giro, 0]}>
      <meshStandardMaterial color={c.sebe} roughness={0.95} />
    </RoundedBox>
  );
}

/** Canteiro elevado com borda de pedra, terra e um maciço de flores de uma cor. */
function Canteiro({ c, posicao, largura, profundidade, cor, semente }: { c: Cores; posicao: [number, number, number]; largura: number; profundidade: number; cor: string; semente: number }) {
  const flores = useMemo(() => {
    const r = aleatorio(semente);
    return Array.from({ length: Math.round(largura * profundidade * 9) }, () => [(r() - 0.5) * (largura - 0.3), (r() - 0.5) * (profundidade - 0.3), 0.06 + r() * 0.05] as const);
  }, [largura, profundidade, semente]);
  return (
    <group position={posicao}>
      <RoundedBox args={[largura, 0.32, profundidade]} radius={0.06} position={[0, 0.16, 0]}>
        <meshStandardMaterial color={c.pedra} roughness={0.8} />
      </RoundedBox>
      <mesh position={[0, 0.322, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[largura - 0.16, profundidade - 0.16]} />
        <meshStandardMaterial color={c.terra} roughness={1} />
      </mesh>
      {flores.map(([x, z, r], i) => (
        <mesh key={i} position={[x, 0.36 + r, z]}>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={i % 4 === 0 ? c.folha : cor} roughness={0.6} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Praça redonda com piso, chafariz (o jato sobe e desce) e quatro bancos. */
function Praca({ c, posicao }: { c: Cores; posicao: [number, number, number] }) {
  const jato = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (jato.current) jato.current.scale.y = 0.85 + Math.sin(clock.elapsedTime * 2.2) * 0.15;
  });
  return (
    <group position={posicao}>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[4.2, 4.2, 0.06, 48]} />
        <meshStandardMaterial color={c.calcada} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[1.6, 1.7, 0.4, 40]} />
        <meshStandardMaterial color={c.pedra} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.45, 40]} />
        <meshStandardMaterial color={c.agua} emissive={c.agua} emissiveIntensity={0.25} roughness={0.05} metalness={0.3} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.18, 0.28, 0.4, 16]} />
        <meshStandardMaterial color={c.pedra} roughness={0.7} />
      </mesh>
      <mesh ref={jato} position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.04, 0.12, 0.9, 10]} />
        <meshStandardMaterial color={c.agua} emissive={c.agua} emissiveIntensity={0.5} transparent opacity={0.6} />
      </mesh>
      {[0, 1, 2, 3].map((k) => {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        return <Banco key={k} c={c} posicao={[Math.sin(a) * 3.1, 0.06, Math.cos(a) * 3.1]} giro={a + Math.PI} />;
      })}
    </group>
  );
}

function Poste({ c, posicao, giro, poca }: { c: Cores; posicao: [number, number, number]; giro: number; poca: THREE.Texture }) {
  return (
    <group position={posicao} rotation={[0, giro, 0]}>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 3.2, 8]} />
        <meshStandardMaterial color={c.poste} roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0, 3.18, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 6]} />
        <meshStandardMaterial color={c.poste} roughness={0.5} metalness={0.5} />
      </mesh>
      <RoundedBox args={[0.22, 0.08, 0.42]} radius={0.03} position={[0, 3.14, 0.68]}>
        <meshStandardMaterial color={c.poste} roughness={0.4} metalness={0.5} />
      </RoundedBox>
      <mesh position={[0, 3.095, 0.68]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.16, 0.34]} />
        <meshStandardMaterial color={c.lampada} emissive={c.lampada} emissiveIntensity={c.luzPoca ? 2.5 : 0.6} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {c.luzPoca > 0 && (
        <mesh position={[0, 0.03, 0.68]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[4.2, 4.2]} />
          <meshBasicMaterial map={poca} color={c.lampada} transparent opacity={c.luzPoca} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function Banco({ c, posicao, giro }: { c: Cores; posicao: [number, number, number]; giro: number }) {
  return (
    <group position={posicao} rotation={[0, giro, 0]}>
      {[0, 0.16].map((z) => (
        <mesh key={z} position={[0, 0.42, z - 0.08]}>
          <boxGeometry args={[1.4, 0.05, 0.13]} />
          <meshStandardMaterial color={c.banco} roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 0.66, -0.2]} rotation={[-0.15, 0, 0]}>
        <boxGeometry args={[1.4, 0.3, 0.05]} />
        <meshStandardMaterial color={c.banco} roughness={0.8} />
      </mesh>
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.21, 0]}>
          <boxGeometry args={[0.06, 0.42, 0.4]} />
          <meshStandardMaterial color={c.poste} roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/* ───────── Ruas ───────── */

const CORES_CARRO = ["#ef4444", "#f8fafc", "#3b82f6", "#111827", "#F4B800", "#10b981"];

function Carro({ c, cor, farol = true }: { c: Cores; cor: string; farol?: boolean }) {
  // De frente para +x.
  const acesos = farol ? c.farol : 0;
  return (
    <group>
      <RoundedBox args={[2, 0.42, 0.95]} radius={0.14} position={[0, 0.38, 0]}>
        <meshPhysicalMaterial color={cor} roughness={0.3} metalness={0.4} clearcoat={1} />
      </RoundedBox>
      <RoundedBox args={[1.05, 0.36, 0.84]} radius={0.12} position={[-0.12, 0.72, 0]}>
        <meshPhysicalMaterial color="#0d1320" roughness={0.1} metalness={0.3} clearcoat={1} />
      </RoundedBox>
      {[-0.65, 0.65].map((x) =>
        [-0.45, 0.45].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.2, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.19, 0.19, 0.14, 14]} />
            <meshStandardMaterial color="#0b0d11" roughness={0.8} />
          </mesh>
        )),
      )}
      {[-0.3, 0.3].map((z) => (
        <mesh key={z} position={[1.005, 0.42, z]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.2, 0.08]} />
          <meshStandardMaterial color="#fff7e0" emissive="#fff7e0" emissiveIntensity={2 * acesos + 0.3} toneMapped={false} />
        </mesh>
      ))}
      {[-0.32, 0.32].map((z) => (
        <mesh key={z} position={[-1.005, 0.42, z]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[0.18, 0.07]} />
          <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.5 * acesos + 0.3} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Carro andando numa reta (de `de` até `ate`, ao longo de x ou z), recomeçando quando chega ao fim. */
function CarroAndando({ c, cor, de, ate, eixo, faixa, velocidade, inicio }: { c: Cores; cor: string; de: number; ate: number; eixo: "x" | "z"; faixa: number; velocidade: number; inicio: number }) {
  const grupo = useRef<THREE.Group>(null);
  const andado = useRef(inicio);
  const sentido = Math.sign(ate - de);
  useFrame((_, dt) => {
    const g = grupo.current;
    if (!g) return;
    const total = Math.abs(ate - de);
    andado.current = (andado.current + velocidade * Math.min(dt, 0.1)) % total;
    const pos = de + sentido * andado.current;
    if (eixo === "x") g.position.set(pos, NIVEL_RUA + 0.02, faixa);
    else g.position.set(faixa, NIVEL_RUA + 0.02, pos);
    // Some suavemente nas pontas da maquete.
    const borda = Math.min(andado.current, total - andado.current);
    g.scale.setScalar(THREE.MathUtils.clamp(borda / 1.5, 0.001, 1));
  });
  const giro = eixo === "x" ? (sentido > 0 ? 0 : Math.PI) : sentido > 0 ? -Math.PI / 2 : Math.PI / 2;
  return (
    <group ref={grupo}>
      <group rotation={[0, giro, 0]}>
        <Carro c={c} cor={cor} />
      </group>
    </group>
  );
}

/* ───────── Térreo ───────── */

/** Totem com o símbolo e o nome do GestorGov, ao lado da entrada (de frente para +z). */
function Totem({ c, linhas = ["Secretaria", "de Saúde"] }: { c: Cores; linhas?: string[] }) {
  const nome = useTextoEmTextura(linhas);
  return (
    <group>
      <RoundedBox args={[1.5, 2.6, 0.35]} radius={0.06} position={[0, 1.3, 0]} castShadow>
        <meshStandardMaterial color="#14295a" roughness={0.5} metalness={0.2} />
      </RoundedBox>
      <mesh position={[0, 0.12, 0.18]}>
        <boxGeometry args={[1.5, 0.04, 0.01]} />
        <meshStandardMaterial color={c.led} emissive={c.led} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <group position={[0, 1.85, 0.18]}>
        <LogoGestorGov tamanho={0.95} />
      </group>
      <mesh position={[0, 0.95, 0.18]}>
        <planeGeometry args={[1.35, 0.34]} />
        <meshBasicMaterial map={nome} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** O térreo: piso, colunas, fachada de vidro, recepção, elevadores e a laje com a faixa clara. */
function Terreo({ c, p, predio, entradaX }: { c: Cores; p: Paleta; predio: RetanguloPredio; entradaX: number }) {
  const { x0, x1, z0, z1 } = predio;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const largura = x1 - x0;
  const profundidade = z1 - z0;
  const alturaVidro = ANDAR - LAJE;
  const vaos = Math.max(1, Math.round((largura - 1) / 6.5));
  const colunas: [number, number][] = [];
  for (let i = 0; i <= vaos; i++) for (const z of [z0 + 0.5, z1 - 0.5]) colunas.push([x0 + 0.5 + (i * (largura - 1)) / vaos, z]);
  for (let z = z0 + 7; z < z1 - 3; z += 6.5) for (const x of [x0 + 0.5, x1 - 0.5]) colunas.push([x, z]);
  const faixas = [
    [cx, z1 + 0.03, largura + 0.12, 0.06],
    [cx, z0 - 0.03, largura + 0.12, 0.06],
    [x1 + 0.03, cz, 0.06, profundidade],
    [x0 - 0.03, cz, 0.06, profundidade],
  ] as const;
  return (
    <group>
      <mesh position={[cx, 0.003, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[largura, profundidade]} />
        <meshStandardMaterial color={c.piso} roughness={0.35} metalness={0.1} />
      </mesh>
      {colunas.map(([x, z], i) => (
        <mesh key={i} position={[x, alturaVidro / 2, z]} castShadow>
          <boxGeometry args={[0.36, alturaVidro, 0.36]} />
          <meshStandardMaterial color={c.laje} roughness={0.6} />
        </mesh>
      ))}

      {/* Fachada de vidro nos quatro lados, com a abertura da entrada na frente */}
      <group position={[(x0 + entradaX - ENTRADA / 2) / 2, 0, z1 - 0.05]}>
        <DivisoriaVidro p={p} comprimento={entradaX - ENTRADA / 2 - x0} altura={alturaVidro} />
      </group>
      <group position={[(entradaX + ENTRADA / 2 + x1) / 2, 0, z1 - 0.05]}>
        <DivisoriaVidro p={p} comprimento={x1 - entradaX - ENTRADA / 2} altura={alturaVidro} />
      </group>
      <group position={[x1 - 0.05, 0, cz]} rotation={[0, Math.PI / 2, 0]}>
        <DivisoriaVidro p={p} comprimento={profundidade} altura={alturaVidro} />
      </group>
      <group position={[cx, 0, z0 + 0.05]}>
        <DivisoriaVidro p={p} comprimento={largura} altura={alturaVidro} />
      </group>
      <group position={[x0 + 0.05, 0, cz]} rotation={[0, Math.PI / 2, 0]}>
        <DivisoriaVidro p={p} comprimento={profundidade} altura={alturaVidro} />
      </group>

      {/* Recepção: balcão com o filete amarelo, a parede ripada com o GestorGov, sofás, plantas e tapete */}
      <group position={[entradaX, 0, z1 - 5.2]}>
        <mesh position={[0, 0.006, 1.6]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[5, 3]} />
          <meshStandardMaterial color="#14295a" roughness={1} />
        </mesh>
        <RoundedBox args={[3.4, 1.05, 0.7]} radius={0.08} position={[0, 0.525, 0]} castShadow>
          <meshStandardMaterial color="#f4f6f8" roughness={0.4} />
        </RoundedBox>
        <mesh position={[0, 0.3, 0.355]}>
          <boxGeometry args={[3.2, 0.05, 0.01]} />
          <meshStandardMaterial color={c.led} emissive={c.led} emissiveIntensity={2} toneMapped={false} />
        </mesh>
        <RoundedBox args={[5, 2.5, 0.2]} radius={0.04} position={[0, 1.4, -1.6]} castShadow>
          <meshStandardMaterial color={p.madeira} roughness={0.8} />
        </RoundedBox>
        <group position={[0, 1.6, -1.48]}>
          <LogoGestorGov tamanho={1.3} />
        </group>
        <group position={[-3.6, 0, 1.4]} rotation={[0, Math.PI / 2, 0]}>
          <Sofa cor="#334155" />
        </group>
        <group position={[3.6, 0, 1.4]} rotation={[0, -Math.PI / 2, 0]}>
          <Sofa cor="#334155" />
        </group>
        <Planta p={p} posicao={[-2.6, 0, -1]} escala={0.9} />
        <Planta p={p} posicao={[2.6, 0, -1]} escala={0.9} />
      </group>
      {/* Núcleo dos elevadores, no fundo */}
      <group position={[cx, 0, z0 + 2]}>
        <mesh position={[0, alturaVidro / 2, 0]} castShadow>
          <boxGeometry args={[5, alturaVidro, 2.6]} />
          <meshStandardMaterial color={c.laje} roughness={0.7} />
        </mesh>
        {[-1.2, 1.2].map((x) => (
          <group key={x} position={[x, 0, 1.31]}>
            <mesh position={[0, 1.15, 0]}>
              <planeGeometry args={[1.2, 2.3]} />
              <meshStandardMaterial color="#9aa4b2" roughness={0.25} metalness={0.8} />
            </mesh>
            <mesh position={[0, 1.15, 0.002]}>
              <planeGeometry args={[0.02, 2.3]} />
              <meshBasicMaterial color="#1f2937" />
            </mesh>
            <mesh position={[0, 2.5, 0.002]}>
              <planeGeometry args={[0.3, 0.1]} />
              <meshStandardMaterial color={c.led} emissive={c.led} emissiveIntensity={1.5} toneMapped={false} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Laje entre os andares: faixa clara em volta, com o filete de luz embaixo, e o teto do térreo */}
      {faixas.map(([x, z, l, pr], i) => (
        <mesh key={i} position={[x, ANDAR - LAJE / 2 - 0.06, z]} castShadow>
          <boxGeometry args={[l, LAJE - 0.12, pr]} />
          <meshStandardMaterial color={c.laje} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[cx, ANDAR - LAJE + 0.01, z1 + 0.065]}>
        <boxGeometry args={[largura, 0.03, 0.01]} />
        <meshStandardMaterial color={c.led} emissive={c.led} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      <mesh position={[x1 + 0.065, ANDAR - LAJE + 0.01, cz]}>
        <boxGeometry args={[0.01, 0.03, profundidade]} />
        <meshStandardMaterial color={c.led} emissive={c.led} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      <mesh position={[cx, ANDAR - LAJE + 0.02, cz]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[largura - 0.1, profundidade - 0.1]} />
        <meshStandardMaterial color={c.laje} roughness={0.8} />
      </mesh>
    </group>
  );
}

/* ───────── Quarteirão ───────── */

export function Quarteirao({ p, predio, escuro, entradaX, totem }: { p: Paleta; predio: RetanguloPredio; escuro: boolean; entradaX: number; totem?: string[] }) {
  const c = cores(escuro);
  const gradiente = useGradienteRadial();
  const { x0, x1, z0, z1 } = predio;

  // Faixas a partir do prédio, para a frente (+z) e para a direita (+x).
  const calcadaZ = z1 + CALCADA;
  const ruaZ0 = calcadaZ + JARDIM;
  const ruaZ1 = ruaZ0 + RUA;
  const calcadaX = x1 + CALCADA;
  const ruaX0 = calcadaX + JARDIM;
  const ruaX1 = ruaX0 + RUA;
  const base = limitesDoQuarteirao(predio);
  const bx = (base.x0 + base.x1) / 2;
  const bz = (base.z0 + base.z1) / 2;
  const bl = base.x1 - base.x0;
  const bp = base.z1 - base.z0;
  const y = NIVEL_RUA;

  const verde = useMemo(() => {
    const r = aleatorio(7);
    const tipos: TipoArvore[] = ["copa", "cipreste", "copa", "florida"];
    const arvores: { p: [number, number, number]; e: number; tipo: TipoArvore }[] = [];
    // Jardim da frente e da direita: árvores alternando com canteiros.
    let k = 0;
    for (let x = x0 + 2; x < ruaX0 - 1.5; x += 6.4, k++) arvores.push({ p: [x, y, calcadaZ + JARDIM / 2], e: 0.95, tipo: k % 2 ? "florida" : "copa" });
    k = 0;
    for (let z = z0 + 2; z < ruaZ0 - 3; z += 6.4, k++) arvores.push({ p: [calcadaX + JARDIM / 2, y, z], e: 0.95, tipo: k % 2 ? "florida" : "copa" });
    // Do outro lado das ruas.
    for (let x = base.x0 + 2; x < base.x1 - 1; x += 3.6) arvores.push({ p: [x + r() * 0.8, y, ruaZ1 + CALCADA_LONGE + 1.5 + r() * 1.4], e: 0.8 + r() * 0.4, tipo: tipos[Math.floor(r() * 4)] });
    for (let z = base.z0 + 2; z < ruaZ0 - 2; z += 3.6) arvores.push({ p: [ruaX1 + CALCADA_LONGE + 1.5 + r() * 1.4, y, z + r() * 0.8], e: 0.8 + r() * 0.4, tipo: tipos[Math.floor(r() * 4)] });
    // Fundos: fileira de ciprestes junto à divisa e árvores de copa soltas.
    for (let x = base.x0 + 1.5; x < calcadaX; x += 2.2) arvores.push({ p: [x, y, base.z0 + 1.3], e: 0.9 + r() * 0.2, tipo: "cipreste" });
    for (let z = base.z0 + 3.5; z < calcadaZ; z += 2.2) arvores.push({ p: [base.x0 + 1.3, y, z], e: 0.9 + r() * 0.2, tipo: "cipreste" });
    for (let x = x0 + 4; x < x1; x += 7) arvores.push({ p: [x + r() * 2, y, z0 - CALCADA - 4 - r() * 2], e: 1 + r() * 0.3, tipo: r() > 0.7 ? "florida" : "copa" });
    const canteiros: { p: [number, number, number]; l: number; pr: number; cor: string }[] = [];
    k = 0;
    for (let x = x0 + 5.2; x < ruaX0 - 3; x += 6.4, k++) canteiros.push({ p: [x, y, calcadaZ + JARDIM / 2], l: 2.6, pr: 1.4, cor: c.flor[k % c.flor.length] });
    for (let z = z0 + 5.2; z < ruaZ0 - 4; z += 6.4, k++) canteiros.push({ p: [calcadaX + JARDIM / 2, y, z], l: 1.4, pr: 2.6, cor: c.flor[k % c.flor.length] });
    return { arvores, canteiros };
  }, [x0, x1, z0, ruaX0, ruaZ0, ruaX1, ruaZ1, calcadaX, calcadaZ, base.x0, base.x1, base.z0, y, c.flor]);

  const tracos = (de: number, ate: number, pulo: [number, number]) => {
    const lista: number[] = [];
    for (let v = de + 1; v < ate - 1; v += 2.4) if (v < pulo[0] - 0.6 || v > pulo[1] + 0.6) lista.push(v);
    return lista;
  };
  // Faixas de grama aparada no gramado (efeito de cortador).
  const faixasGrama = Array.from({ length: Math.floor((ruaX0 - base.x0) / 3) }, (_, i) => base.x0 + 1.5 + i * 3).filter((_, i) => i % 2 === 0);

  return (
    <group>
      {/* A maquete: base escura com borda arredondada, grama com faixas de corte */}
      <RoundedBox args={[bl, 1.2, bp]} radius={0.35} position={[bx, y - 0.6, bz]} receiveShadow>
        <meshStandardMaterial color={c.base} roughness={0.7} metalness={0.2} />
      </RoundedBox>
      <mesh position={[bx, y + 0.002, bz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[bl - 0.5, bp - 0.5]} />
        <meshStandardMaterial color={c.grama} roughness={1} />
      </mesh>
      {faixasGrama.map((x) => (
        <mesh key={x} position={[x, y + 0.004, (base.z0 + ruaZ0) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.5, ruaZ0 - base.z0 - 0.5]} />
          <meshStandardMaterial color={c.gramaFaixa} roughness={1} />
        </mesh>
      ))}
      <mesh position={[(x0 + ruaX0) / 2, y + 0.006, calcadaZ + JARDIM / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ruaX0 - x0 + CALCADA, JARDIM - 0.3]} />
        <meshStandardMaterial color={c.gramaClara} roughness={1} />
      </mesh>
      <mesh position={[calcadaX + JARDIM / 2, y + 0.006, (z0 + ruaZ0) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[JARDIM - 0.3, ruaZ0 - z0]} />
        <meshStandardMaterial color={c.gramaClara} roughness={1} />
      </mesh>

      {/* Calçada em volta do prédio, caminho até a praça e calçadas do outro lado das ruas */}
      <mesh position={[(x0 - CALCADA + calcadaX) / 2, y + 0.04, (z0 - CALCADA + calcadaZ) / 2]} receiveShadow>
        <boxGeometry args={[x1 - x0 + CALCADA * 2, 0.08, z1 - z0 + CALCADA * 2]} />
        <meshStandardMaterial color={c.calcada} roughness={0.9} />
      </mesh>
      <mesh position={[x0 - CALCADA - 0.75, y + 0.03, z0 + 6]} receiveShadow>
        <boxGeometry args={[1.5, 0.06, 1.4]} />
        <meshStandardMaterial color={c.calcada} roughness={0.9} />
      </mesh>
      <mesh position={[bx, y + 0.04, ruaZ1 + CALCADA_LONGE / 2]} receiveShadow>
        <boxGeometry args={[bl - 0.5, 0.08, CALCADA_LONGE]} />
        <meshStandardMaterial color={c.calcada} roughness={0.9} />
      </mesh>
      <mesh position={[ruaX1 + CALCADA_LONGE / 2, y + 0.04, (base.z0 + ruaZ0) / 2]} receiveShadow>
        <boxGeometry args={[CALCADA_LONGE, 0.08, ruaZ0 - base.z0 - 0.25]} />
        <meshStandardMaterial color={c.calcada} roughness={0.9} />
      </mesh>

      {/* Ruas: asfalto, faixa central tracejada e faixas de pedestre na esquina */}
      <mesh position={[bx, y + 0.012, (ruaZ0 + ruaZ1) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[bl - 0.5, RUA]} />
        <meshStandardMaterial color={c.asfalto} roughness={0.95} />
      </mesh>
      <mesh position={[(ruaX0 + ruaX1) / 2, y + 0.013, (base.z0 + ruaZ0) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[RUA, ruaZ0 - base.z0 - 0.25]} />
        <meshStandardMaterial color={c.asfalto} roughness={0.95} />
      </mesh>
      {tracos(base.x0, base.x1, [ruaX0, ruaX1]).map((x) => (
        <mesh key={`tx${x}`} position={[x, y + 0.02, (ruaZ0 + ruaZ1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.2, 0.12]} />
          <meshBasicMaterial color={c.faixa} />
        </mesh>
      ))}
      {tracos(base.z0, ruaZ0, [ruaZ0, ruaZ1]).map((z) => (
        <mesh key={`tz${z}`} position={[(ruaX0 + ruaX1) / 2, y + 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.12, 1.2]} />
          <meshBasicMaterial color={c.faixa} />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <group key={`zebra${i}`}>
          <mesh position={[ruaX0 - 1.4, y + 0.02, ruaZ0 + 0.45 + i * 0.72]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.6, 0.36]} />
            <meshBasicMaterial color={c.faixa} />
          </mesh>
          <mesh position={[ruaX0 + 0.45 + i * 0.72, y + 0.02, ruaZ0 - 1.4]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.36, 1.6]} />
            <meshBasicMaterial color={c.faixa} />
          </mesh>
        </group>
      ))}

      {/* Embasamento de pedra (da calçada ao piso do térreo) */}
      <mesh position={[(x0 + x1) / 2, (y + 0.08) / 2, (z0 + z1) / 2]} receiveShadow>
        <boxGeometry args={[x1 - x0 + 0.2, -y - 0.08, z1 - z0 + 0.2]} />
        <meshStandardMaterial color={c.pedra} roughness={0.75} />
      </mesh>

      <Terreo c={c} p={p} predio={predio} entradaX={entradaX} />

      {/* Entrada: degraus, marquise com o filete amarelo e o totem */}
      {[0, 1].map((k) => (
        <mesh key={k} position={[entradaX, y + 0.08 + (k + 0.5) * ((-y - 0.08) / 2), z1 + 0.55 - k * 0.22]} receiveShadow>
          <boxGeometry args={[ENTRADA + 0.6, (-y - 0.08) / 2, 1.1 - k * 0.45]} />
          <meshStandardMaterial color={c.calcada} roughness={0.85} />
        </mesh>
      ))}
      <group position={[entradaX, 0, z1]}>
        <RoundedBox args={[ENTRADA + 1.6, 0.12, 1.8]} radius={0.04} position={[0, ANDAR - LAJE - 0.25, 0.85]} castShadow>
          <meshStandardMaterial color={c.laje} roughness={0.5} />
        </RoundedBox>
        <mesh position={[0, ANDAR - LAJE - 0.25, 1.752]}>
          <boxGeometry args={[ENTRADA + 1.6, 0.04, 0.01]} />
          <meshStandardMaterial color={c.led} emissive={c.led} emissiveIntensity={2} toneMapped={false} />
        </mesh>
      </group>
      <group position={[entradaX + ENTRADA / 2 + 2.4, y + 0.08, z1 + 1.4]}>
        <Totem c={c} linhas={totem} />
      </group>

      {/* Jardim: cerca viva na calçada do prédio, canteiros, árvores e a praça com chafariz */}
      <Sebe c={c} posicao={[(x0 + entradaX - ENTRADA / 2 - 1.5) / 2, y + 0.08, calcadaZ - 0.35]} comprimento={entradaX - ENTRADA / 2 - 1.5 - x0} />
      <Sebe c={c} posicao={[(entradaX + ENTRADA / 2 + 4 + x1) / 2, y + 0.08, calcadaZ - 0.35]} comprimento={x1 - entradaX - ENTRADA / 2 - 4} />
      <Sebe c={c} posicao={[calcadaX - 0.35, y + 0.08, (z0 + z1) / 2]} comprimento={z1 - z0} giro={Math.PI / 2} />
      {verde.canteiros.map((k, i) => (
        <Canteiro key={i} c={c} posicao={k.p} largura={k.l} profundidade={k.pr} cor={k.cor} semente={i + 3} />
      ))}
      {verde.arvores.map((a, i) => (
        <Arvore key={i} c={c} tipo={a.tipo} posicao={a.p} escala={a.e} sombra={gradiente} />
      ))}
      <Praca c={c} posicao={[x0 - CALCADA - 5.6, y, z0 + 6]} />

      {/* Postes e banco */}
      {Array.from({ length: Math.floor((ruaX0 - x0) / 6.4) }, (_, i) => (
        <Poste key={`pf${i}`} c={c} posicao={[x0 + 3.6 + i * 6.4, y + 0.08, ruaZ0 - 0.35]} giro={0} poca={gradiente} />
      ))}
      {Array.from({ length: Math.floor((ruaZ0 - z0) / 6.4) }, (_, i) => (
        <Poste key={`pd${i}`} c={c} posicao={[ruaX0 - 0.35, y + 0.08, z0 + 3.6 + i * 6.4]} giro={Math.PI / 2} poca={gradiente} />
      ))}
      <Banco c={c} posicao={[entradaX - ENTRADA / 2 - 3.4, y + 0.08, z1 + 1.5]} giro={Math.PI} />

      {/* Carros: dois passando em cada rua e dois estacionados */}
      <CarroAndando c={c} cor={CORES_CARRO[0]} de={base.x0} ate={base.x1} eixo="x" faixa={ruaZ0 + RUA * 0.72} velocidade={3.2} inicio={4} />
      <CarroAndando c={c} cor={CORES_CARRO[2]} de={base.x1} ate={base.x0} eixo="x" faixa={ruaZ0 + RUA * 0.28} velocidade={2.6} inicio={18} />
      <CarroAndando c={c} cor={CORES_CARRO[1]} de={base.z0} ate={base.z1} eixo="z" faixa={ruaX0 + RUA * 0.28} velocidade={2.9} inicio={10} />
      <CarroAndando c={c} cor={CORES_CARRO[4]} de={base.z1} ate={base.z0} eixo="z" faixa={ruaX0 + RUA * 0.72} velocidade={3.4} inicio={25} />
      <group position={[x0 + 6, y + 0.02, ruaZ0 + 0.75]}>
        <Carro c={c} cor={CORES_CARRO[3]} farol={false} />
      </group>
      <group position={[ruaX1 - 0.75, y + 0.02, z0 + 8]} rotation={[0, -Math.PI / 2, 0]}>
        <Carro c={c} cor={CORES_CARRO[5]} farol={false} />
      </group>
    </group>
  );
}

/* ───────── Casca do segundo andar ───────── */

/**
 * A fachada e a cobertura do andar do escritório. Fechada, é o prédio visto de fora; `aberto` faz a cobertura
 * subir e sumir e a fachada ficar transparente. Fechada, um clique em qualquer parte dela chama `aoAbrir`.
 */
export function CascaDoAndar({ predio, escuro, aberto, aoAbrir, nome: nomeFachada = "Secretaria Municipal de Saúde" }: { predio: RetanguloPredio; escuro: boolean; aberto: boolean; aoAbrir: () => void; nome?: string }) {
  const c = cores(escuro);
  const { x0, x1, z0, z1 } = predio;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const largura = x1 - x0;
  const profundidade = z1 - z0;
  const nome = useTextoEmTextura([nomeFachada], 1024, 128);
  const grupo = useRef<THREE.Group>(null);
  const cobertura = useRef<THREE.Group>(null);
  const abertura = useRef(aberto ? 1 : 0);

  const m = useMemo(
    () => ({
      vidro: new THREE.MeshPhysicalMaterial({ color: c.vidroFachada, roughness: 0.08, metalness: 0.6, clearcoat: 1, transparent: true, opacity: 0.88, depthWrite: false }),
      janela: new THREE.MeshStandardMaterial({ color: "#ffe2b0", emissive: "#ffd28a", emissiveIntensity: c.janela, transparent: true, opacity: 0.55, depthWrite: false }),
      perfil: new THREE.MeshStandardMaterial({ color: "#0c0f14", roughness: 0.4, metalness: 0.5, transparent: true }),
      laje: new THREE.MeshStandardMaterial({ color: c.laje, roughness: 0.6, transparent: true }),
      cobertura: new THREE.MeshStandardMaterial({ color: c.cobertura, roughness: 0.9, transparent: true }),
      solar: new THREE.MeshPhysicalMaterial({ color: c.solar, roughness: 0.15, metalness: 0.7, clearcoat: 1, transparent: true }),
      maquina: new THREE.MeshStandardMaterial({ color: "#9aa3af", roughness: 0.5, metalness: 0.4, transparent: true }),
      led: new THREE.MeshStandardMaterial({ color: c.led, emissive: c.led, emissiveIntensity: 2, toneMapped: false, transparent: true }),
      placa: new THREE.MeshStandardMaterial({ color: "#14295a", roughness: 0.5, transparent: true }),
      nome: new THREE.MeshBasicMaterial({ map: nome, transparent: true, toneMapped: false }),
    }),
    [c.vidroFachada, c.janela, c.laje, c.cobertura, c.solar, c.led, nome],
  );
  useEffect(() => () => Object.values(m).forEach((material) => material.dispose()), [m]);

  useFrame((_, dt) => {
    abertura.current = THREE.MathUtils.damp(abertura.current, aberto ? 1 : 0, 3.2, dt);
    const a = abertura.current;
    const visivel = 1 - a;
    m.vidro.opacity = 0.88 * visivel;
    m.janela.opacity = 0.55 * visivel;
    for (const material of [m.perfil, m.laje, m.cobertura, m.solar, m.maquina, m.led, m.placa, m.nome]) {
      material.opacity = visivel;
      material.depthWrite = visivel > 0.98;
    }
    if (cobertura.current) cobertura.current.position.y = PE_DIREITO + a * a * 5;
    if (grupo.current) grupo.current.visible = a < 0.985;
  });

  // Aberta, a casca não recebe o mouse (o escritório embaixo dela recebe).
  const eventos = aberto
    ? {}
    : {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          aoAbrir();
        },
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => {
          document.body.style.cursor = "";
        },
      };

  // Fachada de vidro com montantes a cada ~1,6 m, nos quatro lados.
  const lados = [
    { x: cx, z: z1, giro: 0, comprimento: largura },
    { x: x1, z: cz, giro: Math.PI / 2, comprimento: profundidade },
    { x: cx, z: z0, giro: 0, comprimento: largura },
    { x: x0, z: cz, giro: Math.PI / 2, comprimento: profundidade },
  ];
  const paineis = { colunas: Math.max(2, Math.round(largura / 2.6)), linhas: Math.max(2, Math.round(profundidade / 2.6)) };
  const platibanda = [
    [cx, z1 - 0.06, largura + 0.12, 0.2],
    [cx, z0 + 0.06, largura + 0.12, 0.2],
    [x1 - 0.06, cz, 0.2, profundidade + 0.12],
    [x0 + 0.06, cz, 0.2, profundidade + 0.12],
  ] as const;

  return (
    <group ref={grupo} {...eventos}>
      {lados.map((l, i) => {
        const montantes = Math.max(2, Math.round(l.comprimento / 1.6) + 1);
        const vao = l.comprimento / (montantes - 1);
        return (
          <group key={i} position={[l.x, 0, l.z]} rotation={[0, l.giro, 0]}>
            <mesh position={[0, PE_DIREITO / 2, 0]} material={m.vidro}>
              <boxGeometry args={[l.comprimento, PE_DIREITO, 0.04]} />
            </mesh>
            {/* Algumas janelas acesas atrás do vidro */}
            {Array.from({ length: montantes - 1 }, (_, k) =>
              (k * 7 + i * 3) % 5 < 2 ? (
                <mesh key={k} position={[-l.comprimento / 2 + (k + 0.5) * vao, PE_DIREITO * 0.55, 0.03]} material={m.janela}>
                  <planeGeometry args={[vao - 0.12, PE_DIREITO * 0.7]} />
                </mesh>
              ) : null,
            )}
            {Array.from({ length: montantes }, (_, k) => (
              <mesh key={`m${k}`} position={[-l.comprimento / 2 + k * vao, PE_DIREITO / 2, 0.03]} material={m.perfil}>
                <boxGeometry args={[0.06, PE_DIREITO, 0.06]} />
              </mesh>
            ))}
            <mesh position={[0, 1.1, 0.03]} material={m.perfil}>
              <boxGeometry args={[l.comprimento, 0.05, 0.05]} />
            </mesh>
          </group>
        );
      })}

      <group ref={cobertura} position={[0, PE_DIREITO, 0]}>
        {/* Laje da cobertura, platibanda com o filete amarelo e o letreiro */}
        <mesh position={[cx, 0.15, cz]} material={m.laje} castShadow>
          <boxGeometry args={[largura + 0.12, 0.3, profundidade + 0.12]} />
        </mesh>
        <mesh position={[cx, 0.305, cz]} rotation={[-Math.PI / 2, 0, 0]} material={m.cobertura}>
          <planeGeometry args={[largura - 0.4, profundidade - 0.4]} />
        </mesh>
        {platibanda.map(([x, z, l, pr], i) => (
          <mesh key={i} position={[x, 0.55, z]} material={m.laje} castShadow>
            <boxGeometry args={[l, 0.5, pr]} />
          </mesh>
        ))}
        <mesh position={[cx, 0.06, z1 + 0.065]} material={m.led}>
          <boxGeometry args={[largura, 0.035, 0.01]} />
        </mesh>
        <mesh position={[x1 + 0.065, 0.06, cz]} material={m.led}>
          <boxGeometry args={[0.01, 0.035, profundidade]} />
        </mesh>
        {/* Painéis solares inclinados e as máquinas do ar-condicionado */}
        {Array.from({ length: paineis.colunas }, (_, i) =>
          Array.from({ length: paineis.linhas }, (_, k) =>
            (i + k) % 4 === 3 ? null : (
              <mesh
                key={`${i}-${k}`}
                position={[x0 + 1.6 + (i * (largura - 3.2)) / (paineis.colunas - 1), 0.55, z0 + 1.6 + (k * (profundidade - 5.5)) / (paineis.linhas - 1)]}
                rotation={[-Math.PI / 2 + 0.35, 0, 0]}
                material={m.solar}
              >
                <boxGeometry args={[2, 1.3, 0.05]} />
              </mesh>
            ),
          ),
        )}
        {[0, 1, 2].map((k) => (
          <RoundedBox key={k} args={[1.1, 0.8, 1.1]} radius={0.06} position={[x1 - 2 - k * 1.5, 0.7, z1 - 2.2]} material={m.maquina} castShadow />
        ))}
        <group position={[cx, 0.8, z1 - 0.06]}>
          <mesh position={[0, 0.55, 0]} material={m.placa}>
            <boxGeometry args={[8.4, 1.1, 0.12]} />
          </mesh>
          <group position={[-3.45, 0.55, 0.07]}>
            <LogoGestorGov tamanho={0.95} />
          </group>
          <mesh position={[0.55, 0.55, 0.07]} material={m.nome}>
            <planeGeometry args={[6.6, 0.82]} />
          </mesh>
          <mesh position={[0, 0.02, 0.07]} material={m.led}>
            <boxGeometry args={[8.4, 0.04, 0.01]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** Tamanho total da maquete a partir do prédio (para a câmera enquadrar o quarteirão). */
export function limitesDoQuarteirao(predio: RetanguloPredio) {
  const ruaX1 = predio.x1 + CALCADA + JARDIM + RUA;
  const ruaZ1 = predio.z1 + CALCADA + JARDIM + RUA;
  return { x0: predio.x0 - MARGEM_FUNDO, x1: ruaX1 + CALCADA_LONGE + MARGEM_LONGE, z0: predio.z0 - MARGEM_FUNDO, z1: ruaZ1 + CALCADA_LONGE + MARGEM_LONGE };
}
