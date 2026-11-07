import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";

/*
 * Móveis e acabamento da central, no estilo de um prédio de secretaria: piso de
 * concreto, divisórias de vidro com perfil preto, painel de madeira, estações brancas com divisória
 * azul de tecido e dois monitores, cadeiras pretas de tela e luminárias lineares penduradas.
 */

export const PALETAS = {
  escuro: {
    piso: "#3b414b", juntas: "#474e59", parede: "#2a3240", vidro: "#9db6d0", perfil: "#0c0f14", madeira: "#9a6640",
    mesa: "#eef1f5", pernaMesa: "#c9cfd8", divisoria: "#4769a0", monitor: "#0b0e13", telaApagada: "#1c2533",
    cadeira: "#1a1d23", cadeiraDetalhe: "#323843", planta: "#3fb57e", plantaEscura: "#2f9466", vaso: "#e5e7eb",
    luminaria: "#f8fafc", luzAmbiente: 0.9, luzSol: 1.75, ceu: "#d6e0ff", chao: "#20242c",
  },
  claro: {
    piso: "#d2d5da", juntas: "#c2c6cc", parede: "#f2f3f5", vidro: "#b7cbe0", perfil: "#1d2127", madeira: "#b07a4a",
    mesa: "#ffffff", pernaMesa: "#d6dae0", divisoria: "#5677a1", monitor: "#101317", telaApagada: "#283140",
    cadeira: "#1b1e24", cadeiraDetalhe: "#3a3f48", planta: "#3aa874", plantaEscura: "#2b8a5e", vaso: "#ffffff",
    luminaria: "#ffffff", luzAmbiente: 0.82, luzSol: 1.3, ceu: "#ffffff", chao: "#cfd6e2",
  },
};
export type Paleta = (typeof PALETAS)["escuro"];

/**
 * Estação de trabalho: quem senta fica no lado -z; monitores, divisória e sinal ficam no lado +z.
 * `ocupada` acende as telas (a da esquerda na cor do agente, como o chat aberto).
 */
export function Estacao({ p, ocupada, cor, detalhe = 0 }: { p: Paleta; ocupada: boolean; cor: string; detalhe?: number }) {
  return (
    <group>
      {/* Tampo e pés em painel */}
      <RoundedBox args={[2.4, 0.06, 1.1]} radius={0.025} position={[0, 0.76, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={p.mesa} roughness={0.55} />
      </RoundedBox>
      {[-1.12, 1.12].map((x) => (
        <mesh key={x} position={[x, 0.365, 0.05]} castShadow receiveShadow>
          <boxGeometry args={[0.05, 0.73, 0.9]} />
          <meshStandardMaterial color={p.pernaMesa} roughness={0.6} />
        </mesh>
      ))}
      {/* Divisória de tecido azul (frente e lateral), com acabamento claro no topo */}
      <RoundedBox args={[2.4, 0.5, 0.05]} radius={0.02} position={[0, 1.04, 0.54]} castShadow>
        <meshStandardMaterial color={p.divisoria} roughness={1} />
      </RoundedBox>
      <mesh position={[0, 1.295, 0.54]}>
        <boxGeometry args={[2.4, 0.02, 0.06]} />
        <meshStandardMaterial color={p.pernaMesa} roughness={0.5} />
      </mesh>
      <RoundedBox args={[0.04, 0.36, 0.9]} radius={0.015} position={[1.19, 0.96, 0.08]} castShadow>
        <meshStandardMaterial color={p.divisoria} roughness={1} />
      </RoundedBox>

      {/* Dois monitores virados para quem senta */}
      {[-0.37, 0.37].map((x, i) => (
        <group key={x} position={[x, 0, 0.3]} rotation={[0, x < 0 ? -0.14 : 0.14, 0]}>
          <mesh position={[0, 0.79, 0.02]}>
            <cylinderGeometry args={[0.09, 0.1, 0.015, 20]} />
            <meshStandardMaterial color={p.monitor} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.88, 0.03]}>
            <boxGeometry args={[0.04, 0.18, 0.03]} />
            <meshStandardMaterial color={p.monitor} roughness={0.4} />
          </mesh>
          <RoundedBox args={[0.68, 0.41, 0.03]} radius={0.012} position={[0, 1.1, 0.03]} castShadow>
            <meshStandardMaterial color={p.monitor} roughness={0.35} metalness={0.2} />
          </RoundedBox>
          <mesh position={[0, 1.1, 0.012]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.62, 0.35]} />
            <meshStandardMaterial
              color={ocupada ? (i === 0 ? cor : "#dbe4f0") : p.telaApagada}
              emissive={ocupada ? (i === 0 ? cor : "#9fb3cc") : "#000000"}
              emissiveIntensity={ocupada ? (i === 0 ? 0.75 : 0.35) : 0}
            />
          </mesh>
          {/* Tela da direita com o símbolo do GestorGov, quando a mesa está ocupada */}
          {ocupada && i === 1 && (
            <group position={[0, 1.1, 0.008]} rotation={[0, Math.PI, 0]}>
              <LogoGestorGov tamanho={0.22} />
            </group>
          )}
        </group>
      ))}

      {/* Teclado, mouse e um objeto pessoal */}
      <RoundedBox args={[0.55, 0.025, 0.17]} radius={0.01} position={[0, 0.8, -0.14]}>
        <meshStandardMaterial color={p.cadeiraDetalhe} roughness={0.6} />
      </RoundedBox>
      <RoundedBox args={[0.07, 0.03, 0.11]} radius={0.015} position={[0.4, 0.8, -0.12]}>
        <meshStandardMaterial color={p.cadeiraDetalhe} roughness={0.5} />
      </RoundedBox>
      {detalhe % 3 === 0 && (
        <mesh position={[-0.88, 0.84, -0.05]} castShadow>
          <cylinderGeometry args={[0.05, 0.045, 0.11, 16]} />
          <meshStandardMaterial color="#f5f5f4" roughness={0.4} />
        </mesh>
      )}
      {detalhe % 3 === 1 && !ocupada && (
        <mesh position={[-0.75, 0.81, 0]} rotation={[-Math.PI / 2, 0, 0.4]}>
          <torusGeometry args={[0.11, 0.02, 8, 20, Math.PI * 1.3]} />
          <meshStandardMaterial color="#111318" roughness={0.6} />
        </mesh>
      )}
      {detalhe % 3 === 2 && (
        <group position={[-0.85, 0.79, 0.12]}>
          <mesh position={[0, 0.06, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.05, 0.12, 12]} />
            <meshStandardMaterial color="#ffffff" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.17, 0]}>
            <icosahedronGeometry args={[0.09, 0]} />
            <meshStandardMaterial color={p.planta} roughness={0.8} flatShading />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** Cadeira preta de tela, com base de cinco pontas e rodízios; quem senta olha para +z. */
export function Cadeira({ p }: { p: Paleta }) {
  return (
    <group>
      {Array.from({ length: 5 }, (_, k) => {
        const angulo = (k * Math.PI * 2) / 5;
        return (
          <group key={k} rotation={[0, angulo, 0]}>
            <mesh position={[0, 0.07, 0.15]} castShadow>
              <boxGeometry args={[0.045, 0.035, 0.3]} />
              <meshStandardMaterial color={p.cadeiraDetalhe} roughness={0.5} />
            </mesh>
            <mesh position={[0, 0.035, 0.29]}>
              <sphereGeometry args={[0.035, 10, 10]} />
              <meshStandardMaterial color={p.cadeira} roughness={0.6} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.03, 0.035, 0.34, 10]} />
        <meshStandardMaterial color={p.cadeiraDetalhe} metalness={0.5} roughness={0.3} />
      </mesh>
      <RoundedBox args={[0.52, 0.08, 0.5]} radius={0.035} position={[0, 0.45, 0]} castShadow>
        <meshStandardMaterial color={p.cadeira} roughness={0.85} />
      </RoundedBox>
      <RoundedBox args={[0.48, 0.64, 0.06]} radius={0.03} position={[0, 0.86, -0.26]} rotation={[-0.12, 0, 0]} castShadow>
        <meshStandardMaterial color={p.cadeira} roughness={0.9} />
      </RoundedBox>
      {[-0.27, 0.27].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.56, -0.02]}>
            <boxGeometry args={[0.035, 0.2, 0.035]} />
            <meshStandardMaterial color={p.cadeiraDetalhe} />
          </mesh>
          <RoundedBox args={[0.06, 0.03, 0.25]} radius={0.012} position={[x, 0.67, 0.01]}>
            <meshStandardMaterial color={p.cadeira} roughness={0.7} />
          </RoundedBox>
        </group>
      ))}
    </group>
  );
}

export function Planta({ p, posicao, escala = 1 }: { p: Paleta; posicao: [number, number, number]; escala?: number }) {
  const folhas: [number, number, number, number][] = [
    [0, 1.05, 0, 0.5], [0.28, 1.35, 0.1, 0.34], [-0.25, 1.3, -0.08, 0.32], [0.05, 1.6, -0.12, 0.28], [-0.1, 0.85, 0.22, 0.3],
  ];
  return (
    <group position={posicao} scale={escala}>
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.26, 0.64, 20]} />
        <meshStandardMaterial color={p.vaso} roughness={0.45} />
      </mesh>
      {folhas.map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial color={i % 2 ? p.plantaEscura : p.planta} roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Luminária linear pendurada (como as do escritório). */
export function Luminaria({ p, comprimento }: { p: Paleta; comprimento: number }) {
  return (
    <group>
      {[-comprimento / 2 + 0.3, comprimento / 2 - 0.3].map((x) => (
        <mesh key={x} position={[x, 3.85, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 0.9, 4]} />
          <meshBasicMaterial color={p.perfil} />
        </mesh>
      ))}
      <RoundedBox args={[comprimento, 0.06, 0.16]} radius={0.02} position={[0, 3.4, 0]}>
        <meshStandardMaterial color={p.perfil} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 3.365, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[comprimento - 0.08, 0.1]} />
        <meshStandardMaterial color={p.luminaria} emissive={p.luminaria} emissiveIntensity={1.3} />
      </mesh>
    </group>
  );
}

/** Divisória de vidro com perfis pretos ao longo de x. */
export function DivisoriaVidro({ p, comprimento, altura = 2.9 }: { p: Paleta; comprimento: number; altura?: number }) {
  const montantes = Math.max(2, Math.round(comprimento / 2.2) + 1);
  return (
    <group>
      <mesh position={[0, altura / 2, 0]}>
        <boxGeometry args={[comprimento, altura, 0.02]} />
        <meshStandardMaterial color={p.vidro} transparent opacity={0.22} roughness={0.05} metalness={0.2} depthWrite={false} />
      </mesh>
      {[0.03, altura - 0.03, 1.05].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[comprimento, 0.05, 0.05]} />
          <meshStandardMaterial color={p.perfil} roughness={0.5} />
        </mesh>
      ))}
      {Array.from({ length: montantes }, (_, i) => (
        <mesh key={i} position={[-comprimento / 2 + (i * comprimento) / (montantes - 1), altura / 2, 0]} castShadow>
          <boxGeometry args={[0.05, altura, 0.05]} />
          <meshStandardMaterial color={p.perfil} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Sala de reunião atrás do vidro: mesa redonda e cadeiras. */
export function SalaReuniao({ p }: { p: Paleta }) {
  return (
    <group>
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.75, 0.75, 0.05, 32]} />
        <meshStandardMaterial color={p.mesa} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.07, 0.25, 0.72, 16]} />
        <meshStandardMaterial color={p.cadeiraDetalhe} />
      </mesh>
      {[0, 1.57, 3.14, 4.71].map((a) => (
        <group key={a} position={[Math.sin(a) * 1.1, 0, Math.cos(a) * 1.1]} rotation={[0, a + Math.PI, 0]} scale={0.85}>
          <Cadeira p={p} />
        </group>
      ))}
    </group>
  );
}

/** Painel de ripas de madeira com a TV grande, na parede lateral (eixo z). */
export function PainelMadeira({ p, profundidade }: { p: Paleta; profundidade: number }) {
  const ripas = Math.floor(profundidade / 0.22);
  return (
    <group>
      {Array.from({ length: ripas }, (_, i) => (
        <mesh key={i} position={[0, 1.45, -profundidade / 2 + 0.11 + i * 0.22]} castShadow receiveShadow>
          <boxGeometry args={[0.06, 2.9, 0.15]} />
          <meshStandardMaterial color={i % 2 ? p.madeira : new THREE.Color(p.madeira).offsetHSL(0, 0, 0.04)} roughness={0.8} />
        </mesh>
      ))}
      {/* TV */}
      <RoundedBox args={[0.08, 1.35, 2.35]} radius={0.02} position={[0.09, 1.75, 0]} castShadow>
        <meshStandardMaterial color="#07090c" roughness={0.25} metalness={0.4} />
      </RoundedBox>
      <mesh position={[0.135, 1.75, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.22, 1.24]} />
        <meshStandardMaterial color="#0f1a2e" emissive="#1d3b6b" emissiveIntensity={0.55} roughness={0.2} />
      </mesh>
    </group>
  );
}

/** Banner com o símbolo da equipe, na parede do fundo. */
export function Banner({ cor }: { cor: string }) {
  // Quadro azul-marinho com o símbolo do GestorGov e um filete na cor da marca.
  return (
    <group>
      <RoundedBox args={[1.5, 1.05, 0.04]} radius={0.02} position={[0, 0, 0]}>
        <meshStandardMaterial color="#14295a" roughness={0.7} />
      </RoundedBox>
      <mesh position={[0, -0.45, 0.025]}>
        <boxGeometry args={[1.3, 0.03, 0.01]} />
        <meshStandardMaterial color={cor} emissive={cor} emissiveIntensity={0.6} />
      </mesh>
      <group position={[0, 0.04, 0.025]}>
        <LogoGestorGov tamanho={0.75} />
      </group>
    </group>
  );
}

/** O símbolo do GestorGov num plano (colorido ou branco). */
export function LogoGestorGov({ tamanho = 1, cor = "cor", opacidade = 1 }: { tamanho?: number; cor?: "cor" | "branco"; opacidade?: number }) {
  const textura = useTexture(`/painel/espaco/gestorgov-${cor}.png`);
  textura.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh>
      <planeGeometry args={[tamanho, tamanho]} />
      <meshBasicMaterial map={textura} transparent opacity={opacidade} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/* ───────── Móveis dos setores ───────── */

/** Arquivo de aço com 4 gavetas (de frente para +z). */
export function Arquivo() {
  return (
    <group>
      <RoundedBox args={[0.6, 1.4, 0.6]} radius={0.03} position={[0, 0.7, 0]} castShadow>
        <meshStandardMaterial color="#8a96a8" metalness={0.5} roughness={0.45} />
      </RoundedBox>
      {[0.25, 0.58, 0.91, 1.24].map((y) => (
        <group key={y} position={[0, y, 0.305]}>
          <mesh>
            <boxGeometry args={[0.52, 0.28, 0.01]} />
            <meshStandardMaterial color="#9ba7b8" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.06, 0.01]}>
            <boxGeometry args={[0.18, 0.03, 0.02]} />
            <meshStandardMaterial color="#2a3240" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Rack de servidor com luzes piscando. */
export function Rack() {
  const luzes = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    luzes.current?.children.forEach((l, i) => {
      ((l as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.sin(clock.elapsedTime * (3 + i) + i) > 0 ? 1 : 0.2;
    });
  });
  return (
    <group>
      <RoundedBox args={[0.7, 2, 0.7]} radius={0.03} position={[0, 1, 0]} castShadow>
        <meshStandardMaterial color="#141820" metalness={0.6} roughness={0.35} />
      </RoundedBox>
      <group ref={luzes}>
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i} position={[i % 2 ? 0.15 : -0.15, 0.4 + Math.floor(i / 2) * 0.32, 0.355]}>
            <boxGeometry args={[0.12, 0.03, 0.01]} />
            <meshBasicMaterial color={i % 3 ? "#22c55e" : "#38bdf8"} transparent />
          </mesh>
        ))}
      </group>
    </group>
  );
}

const LOMBADAS = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#f97316", "#0ea5e9", "#e11d48"];

/** Estante de livros (ou de pastas), de frente para +z. */
export function Estante({ p, largura = 1.8 }: { p: Paleta; largura?: number }) {
  const prateleiras = [0.35, 0.85, 1.35, 1.85];
  return (
    <group>
      <RoundedBox args={[largura, 2.2, 0.45]} radius={0.02} position={[0, 1.1, 0]} castShadow>
        <meshStandardMaterial color={p.madeira} roughness={0.7} />
      </RoundedBox>
      {prateleiras.map((y, k) => (
        <group key={y} position={[0, y, 0.12]}>
          {Array.from({ length: Math.floor(largura / 0.13) }, (_, i) => {
            const altura = 0.3 + ((i * 7 + k * 3) % 5) * 0.03;
            return (
              <mesh key={i} position={[-largura / 2 + 0.12 + i * 0.12, altura / 2, 0]}>
                <boxGeometry args={[0.09, altura, 0.3]} />
                <meshStandardMaterial color={LOMBADAS[(i + k * 3) % LOMBADAS.length]} roughness={0.8} />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

/** TV na parede com uma aula (botão de play). */
export function TvAula() {
  return (
    <group>
      <RoundedBox args={[2, 1.15, 0.06]} radius={0.02} castShadow>
        <meshStandardMaterial color="#0b0e13" roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[1.86, 1.02]} />
        <meshStandardMaterial color="#1e3a8a" emissive="#1d4ed8" emissiveIntensity={0.55} />
      </mesh>
      <mesh position={[0.03, 0, 0.04]} rotation={[0, 0, -Math.PI / 2]}>
        <circleGeometry args={[0.2, 3]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

const RABISCOS: [string, number, number, number][] = [
  ["#3b82f6", -0.6, 0.3, 0.9],
  ["#f7931e", 0.2, 0.05, 1.3],
  ["#10b981", -0.3, -0.25, 1.1],
];

/** Lousa branca com rabiscos coloridos. */
export function Lousa() {
  return (
    <group>
      <RoundedBox args={[2.4, 1.3, 0.05]} radius={0.02} castShadow>
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </RoundedBox>
      {RABISCOS.map(([cor, x, y, comprimento]) => (
        <mesh key={cor} position={[x, y, 0.03]}>
          <boxGeometry args={[comprimento, 0.05, 0.005]} />
          <meshBasicMaterial color={cor} />
        </mesh>
      ))}
    </group>
  );
}

/** Cofre com o disco de segredo e pilhas de moedas ao lado. */
export function Cofre() {
  return (
    <group>
      <RoundedBox args={[0.9, 1.1, 0.8]} radius={0.05} position={[0, 0.55, 0]} castShadow>
        <meshStandardMaterial color="#2f3640" metalness={0.7} roughness={0.35} />
      </RoundedBox>
      <mesh position={[0.12, 0.6, 0.41]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.04, 24]} />
        <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[-0.25, 0.6, 0.42]}>
        <boxGeometry args={[0.05, 0.3, 0.04]} />
        <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.25} />
      </mesh>
      {[0.75, 0.95].map((x, i) => (
        <mesh key={x} position={[x, 0.05 + i * 0.03, 0.1]}>
          <cylinderGeometry args={[0.1, 0.1, 0.1 + i * 0.06, 20]} />
          <meshStandardMaterial color="#e5b73b" metalness={0.8} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

/** Mesa com a caixa de entrada: uma pasta por transferência esperando a equipe (até 12). */
export function CaixaDePastas({ quantidade }: { quantidade: number }) {
  return (
    <group>
      <RoundedBox args={[1.2, 0.06, 0.7]} radius={0.02} position={[0, 0.76, 0]} castShadow>
        <meshStandardMaterial color="#eef1f5" roughness={0.55} />
      </RoundedBox>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.37, 0]}>
          <boxGeometry args={[0.05, 0.74, 0.6]} />
          <meshStandardMaterial color="#c9cfd8" />
        </mesh>
      ))}
      <mesh position={[0, 0.85, 0]}>
        <boxGeometry args={[0.5, 0.12, 0.38]} />
        <meshStandardMaterial color="#2a3240" />
      </mesh>
      {Array.from({ length: Math.min(quantidade, 12) }, (_, i) => (
        <mesh key={i} position={[(i % 2) * 0.02, 0.93 + i * 0.035, 0]} rotation={[0, (i % 3) * 0.08, 0]} castShadow>
          <boxGeometry args={[0.42, 0.03, 0.32]} />
          <meshStandardMaterial color="#f7931e" />
        </mesh>
      ))}
    </group>
  );
}

/** Balcão da recepção, com o balão verde das mensagens que chegam. */
export function Balcao() {
  const balao = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (balao.current) balao.current.position.y = 1.75 + Math.sin(clock.elapsedTime * 1.5) * 0.06;
  });
  return (
    <group>
      <RoundedBox args={[2.6, 1.05, 0.6]} radius={0.05} position={[0, 0.525, 0]} castShadow>
        <meshStandardMaterial color="#eef1f5" roughness={0.5} />
      </RoundedBox>
      <mesh position={[0, 0.5, 0.31]}>
        <boxGeometry args={[2.4, 0.08, 0.01]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.6} />
      </mesh>
      <group ref={balao} position={[0, 1.75, 0]} rotation={[0, Math.PI / 4, 0]}>
        <RoundedBox args={[0.7, 0.5, 0.08]} radius={0.15}>
          <meshStandardMaterial color="#22c55e" emissive="#16a34a" emissiveIntensity={0.4} />
        </RoundedBox>
        <mesh position={[-0.2, -0.27, 0]} rotation={[0, 0, Math.PI * 0.8]}>
          <coneGeometry args={[0.08, 0.16, 3]} />
          <meshStandardMaterial color="#22c55e" />
        </mesh>
        {[-0.15, 0, 0.15].map((x) => (
          <mesh key={x} position={[x, 0, 0.05]}>
            <sphereGeometry args={[0.045, 12, 10]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Sofá de dois lugares (de frente para +z). */
export function Sofa({ cor = "#475569" }: { cor?: string }) {
  return (
    <group>
      <RoundedBox args={[1.8, 0.4, 0.8]} radius={0.08} position={[0, 0.3, 0]} castShadow>
        <meshStandardMaterial color={cor} roughness={0.85} />
      </RoundedBox>
      <RoundedBox args={[1.8, 0.6, 0.2]} radius={0.08} position={[0, 0.6, -0.32]} castShadow>
        <meshStandardMaterial color={cor} roughness={0.85} />
      </RoundedBox>
      {[-0.95, 0.95].map((x) => (
        <RoundedBox key={x} args={[0.2, 0.55, 0.8]} radius={0.08} position={[x, 0.35, 0]} castShadow>
          <meshStandardMaterial color={cor} roughness={0.85} />
        </RoundedBox>
      ))}
    </group>
  );
}

/** Copa: bancada com cafeteira e a geladeira ao lado. */
export function Copa() {
  return (
    <group>
      <RoundedBox args={[2.2, 0.9, 0.6]} radius={0.03} position={[0, 0.45, 0]} castShadow>
        <meshStandardMaterial color="#d6dae0" roughness={0.5} />
      </RoundedBox>
      <RoundedBox args={[0.35, 0.45, 0.35]} radius={0.04} position={[-0.6, 1.12, 0]} castShadow>
        <meshStandardMaterial color="#1f2937" roughness={0.4} />
      </RoundedBox>
      <mesh position={[0.3, 0.98, 0]}>
        <cylinderGeometry args={[0.06, 0.05, 0.12, 16]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <RoundedBox args={[0.8, 1.9, 0.7]} radius={0.04} position={[1.6, 0.95, 0]} castShadow>
        <meshStandardMaterial color="#e5e7eb" metalness={0.3} roughness={0.35} />
      </RoundedBox>
    </group>
  );
}

/* ───────── Implantação (bancada, estantes e caixas) ───────── */

const PAPELAO = "#c49a6c";
const PAPELAO_ESCURO = "#ad8456";
const FITA = "#e2c391";
// Capas dos cadernos e pastas (laranja e azul-marinho).
const CAPAS = ["#f7931e", "#14295a"];

/** Caixa de papelão fechada: fita em cima e etiqueta branca na frente (+z). */
export function CaixaPapelao({ tamanho = [0.5, 0.36, 0.4], escura = false, etiqueta = true }: { tamanho?: [number, number, number]; escura?: boolean; etiqueta?: boolean }) {
  const [l, a, p] = tamanho;
  return (
    <group>
      <mesh position={[0, a / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={tamanho} />
        <meshStandardMaterial color={escura ? PAPELAO_ESCURO : PAPELAO} roughness={0.9} />
      </mesh>
      <mesh position={[0, a + 0.003, 0]}>
        <boxGeometry args={[l * 0.2, 0.006, p + 0.006]} />
        <meshStandardMaterial color={FITA} roughness={0.45} />
      </mesh>
      {etiqueta && (
        <mesh position={[l * 0.14, a * 0.55, p / 2 + 0.004]}>
          <planeGeometry args={[l * 0.42, a * 0.36]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.6} />
        </mesh>
      )}
    </group>
  );
}

/** Estante de aço com caixas nas prateleiras e a plaquinha de cada nível (de frente para +z). */
export function EstanteAco({ largura = 2.4, cor }: { largura?: number; cor: string }) {
  const niveis = [0.1, 0.72, 1.34, 1.96];
  const profundidade = 0.55;
  return (
    <group>
      {[-1, 1].flatMap((lx) =>
        [-1, 1].map((lz) => (
          <mesh key={`${lx}${lz}`} position={[(lx * (largura - 0.05)) / 2, 1.2, (lz * (profundidade - 0.05)) / 2]} castShadow>
            <boxGeometry args={[0.05, 2.4, 0.05]} />
            <meshStandardMaterial color="#5b6472" metalness={0.6} roughness={0.4} />
          </mesh>
        )),
      )}
      {niveis.map((y, k) => (
        <group key={y} position={[0, y, 0]}>
          <mesh receiveShadow castShadow>
            <boxGeometry args={[largura, 0.035, profundidade]} />
            <meshStandardMaterial color="#8a94a3" metalness={0.5} roughness={0.45} />
          </mesh>
          <mesh position={[0, 0, profundidade / 2 + 0.006]}>
            <boxGeometry args={[0.16, 0.03, 0.01]} />
            <meshStandardMaterial color={cor} emissive={cor} emissiveIntensity={0.4} />
          </mesh>
          {/* Caixas de tamanhos variados, sempre as mesmas em cada nível */}
          {Array.from({ length: 4 }, (_, i) => {
            const l = 0.42 + ((i * 5 + k * 3) % 4) * 0.05;
            const a = 0.3 + ((i * 3 + k) % 3) * 0.06;
            if ((i + k) % 5 === 4 || y + a > 2.35) return null;
            return (
              <group key={i} position={[-largura / 2 + 0.32 + i * ((largura - 0.64) / 3), 0.018, 0.02]} rotation={[0, (((i + k) % 3) - 1) * 0.05, 0]}>
                <CaixaPapelao tamanho={[l, a, 0.42]} escura={(i + k) % 2 === 1} />
              </group>
            );
          })}
        </group>
      ))}
    </group>
  );
}

/** Bancada de montagem: caixa aberta com os cadernos, pilhas de cadernos e pastas, a impressora de
 * etiquetas e o monitor com as etapas do envio (de frente para +z; quem embala fica do lado +z). */
export function BancadaExpedicao({ p }: { p: Paleta }) {
  const led = useRef<THREE.MeshBasicMaterial>(null);
  const etapaAtual = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (led.current) led.current.opacity = Math.sin(t * 4) > 0 ? 1 : 0.25;
    etapaAtual.current?.scale.setScalar(1 + Math.max(0, Math.sin(t * 3)) * 0.35);
  });
  return (
    <group>
      {/* Tampo de madeira sobre pés de aço, com prateleira embaixo */}
      <RoundedBox args={[2, 0.06, 0.8]} radius={0.02} position={[0, 0.9, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={p.madeira} roughness={0.7} />
      </RoundedBox>
      {[-0.95, 0.95].flatMap((x) =>
        [-0.35, 0.35].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.44, z]} castShadow>
            <boxGeometry args={[0.05, 0.88, 0.05]} />
            <meshStandardMaterial color="#5b6472" metalness={0.6} roughness={0.4} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[1.9, 0.03, 0.7]} />
        <meshStandardMaterial color="#8a94a3" metalness={0.5} roughness={0.45} />
      </mesh>
      {/* Caixas desmontadas na prateleira de baixo */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.4 + i * 0.02, 0.23 + i * 0.012, 0]}>
          <boxGeometry args={[1, 0.01, 0.6]} />
          <meshStandardMaterial color={i % 2 ? PAPELAO_ESCURO : PAPELAO} roughness={0.9} />
        </mesh>
      ))}

      {/* Caixa aberta, com as abas para fora e os cadernos dentro */}
      <group position={[-0.25, 0.93, 0.05]}>
        <mesh position={[0, 0.14, 0]} castShadow>
          <boxGeometry args={[0.6, 0.28, 0.44]} />
          <meshStandardMaterial color={PAPELAO} roughness={0.9} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, 0.35, s * 0.29]} rotation={[s * 0.5, 0, 0]}>
            <boxGeometry args={[0.6, 0.005, 0.16]} />
            <meshStandardMaterial color={PAPELAO_ESCURO} roughness={0.9} />
          </mesh>
        ))}
        {[0, 1].map((i) => (
          <mesh key={i} position={[-0.1 + i * 0.22, 0.285 + i * 0.01, 0]} rotation={[0, i * 0.12, 0]}>
            <boxGeometry args={[0.2, 0.04, 0.28]} />
            <meshStandardMaterial color={CAPAS[i]} roughness={0.6} />
          </mesh>
        ))}
      </group>

      {/* Pilhas de cadernos e de pastas esperando a caixa */}
      {[0.38, 0.72].map((x, k) => (
        <group key={x} position={[x, 0.93, -0.14]}>
          {Array.from({ length: 5 - k }, (_, i) => (
            <mesh key={i} position={[(i % 2) * 0.01, 0.025 + i * 0.05, 0]} rotation={[0, (i % 3) * 0.06, 0]} castShadow>
              <boxGeometry args={[0.24, 0.045, 0.32]} />
              <meshStandardMaterial color={CAPAS[k]} roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Impressora de etiquetas, com a etiqueta saindo e a luz piscando */}
      <group position={[0.62, 0.93, 0.24]}>
        <RoundedBox args={[0.26, 0.16, 0.22]} radius={0.03} position={[0, 0.08, 0]} castShadow>
          <meshStandardMaterial color="#1f2937" roughness={0.4} />
        </RoundedBox>
        <mesh position={[0, 0.1, 0.14]} rotation={[-0.5, 0, 0]}>
          <boxGeometry args={[0.18, 0.004, 0.1]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.6} />
        </mesh>
        <mesh position={[0.09, 0.161, 0.06]}>
          <boxGeometry args={[0.03, 0.005, 0.03]} />
          <meshBasicMaterial ref={led} color="#22c55e" transparent />
        </mesh>
      </group>

      {/* Fita adesiva */}
      <group position={[0.15, 0.93, 0.27]}>
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[0.18, 0.1, 0.09]} />
          <meshStandardMaterial color="#b91c1c" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.12, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 0.06, 18]} />
          <meshStandardMaterial color={FITA} roughness={0.4} />
        </mesh>
      </group>

      {/* Monitor com as cinco etapas do envio (preparação, etiquetado, postado, retirada, entregue) */}
      <group position={[-0.72, 0.93, -0.25]} rotation={[0, 0.25, 0]}>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.04, 0.2, 0.03]} />
          <meshStandardMaterial color={p.monitor} />
        </mesh>
        <RoundedBox args={[0.52, 0.34, 0.03]} radius={0.012} position={[0, 0.36, 0]} castShadow>
          <meshStandardMaterial color={p.monitor} roughness={0.35} metalness={0.2} />
        </RoundedBox>
        <mesh position={[0, 0.36, 0.017]}>
          <planeGeometry args={[0.47, 0.29]} />
          <meshStandardMaterial color="#0f172a" emissive="#1e293b" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, 0.36, 0.019]}>
          <planeGeometry args={[0.36, 0.008]} />
          <meshBasicMaterial color="#475569" />
        </mesh>
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} ref={i === 2 ? etapaAtual : undefined} position={[-0.18 + i * 0.09, 0.36, 0.021]}>
            <circleGeometry args={[0.022, 16]} />
            <meshBasicMaterial color={i < 2 ? "#22c55e" : i === 2 ? "#f59e0b" : "#64748b"} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Palete de madeira com caixas empilhadas em três camadas, prontas para a postagem. */
export function Palete() {
  const caixas: [number, number, number, boolean][] = [];
  for (let c = 0; c < 3; c++)
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) if (!(c === 2 && i === 1 && j === 1)) caixas.push([-0.27 + i * 0.54, c, -0.22 + j * 0.44, (i + j + c) % 2 === 1]);
  return (
    <group>
      {[-0.5, 0, 0.5].map((z) => (
        <mesh key={z} position={[0, 0.05, z]} castShadow receiveShadow>
          <boxGeometry args={[1.2, 0.1, 0.12]} />
          <meshStandardMaterial color="#a47148" roughness={0.85} />
        </mesh>
      ))}
      {[-0.45, -0.15, 0.15, 0.45].map((x) => (
        <mesh key={x} position={[x, 0.115, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.2, 0.03, 1.1]} />
          <meshStandardMaterial color="#b9845a" roughness={0.85} />
        </mesh>
      ))}
      {caixas.map(([x, c, z, escura]) => (
        <group key={`${x}${c}${z}`} position={[x, 0.13 + c * 0.38, z]}>
          <CaixaPapelao tamanho={[0.52, 0.38, 0.42]} escura={escura} />
        </group>
      ))}
    </group>
  );
}

/** Carrinho de carga com uma caixa (de frente para +z), inclinado como quem acabou de largar. */
export function CarrinhoDeCarga() {
  return (
    <group rotation={[-0.2, 0, 0]}>
      {[-0.22, 0.22].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.65, -0.12]} castShadow>
            <boxGeometry args={[0.04, 1.3, 0.04]} />
            <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[x * 1.25, 0.1, -0.16]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.1, 0.1, 0.06, 18]} />
            <meshStandardMaterial color="#111827" roughness={0.7} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.28, -0.12]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.022, 0.48, 10]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.03, 0.05]}>
        <boxGeometry args={[0.46, 0.03, 0.3]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
      </mesh>
      <group position={[0, 0.045, 0.06]}>
        <CaixaPapelao tamanho={[0.42, 0.34, 0.32]} />
      </group>
    </group>
  );
}
