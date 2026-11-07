import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";

/*
 * O agente de IA na planta: um astronauta com proporções humanas (cabeça ≈ 1/7 da altura). Traje branco
 * com juntas, luvas e faixas na cor do agente, mochila de suporte de vida, capacete com viseira espelhada
 * e o CF no painel do peito. Fica de frente para +z. Sentado na mesa, respira, digita quando atende e
 * olha em volta quando está livre; quando sai para um setor (postura vinda da cena), levanta, anda
 * balançando braços e pernas, busca com as mãos à frente e volta, às vezes carregando uma pasta. Em foco
 * ou com o mouse em cima, acena. Todas as animações são ângulos calculados a cada quadro (nunca somados).
 */

/** O que a cena diz ao agente a cada quadro (ele mesmo suaviza as transições). */
export interface PosturaAgente {
  /** 0 = sentado, 1 = em pé. */
  emPe: number;
  andando: boolean;
  /** Em pé no setor, com as mãos à frente (procurando). */
  buscando: boolean;
  /** Carrega a pasta da conversa (transferência). */
  levando: boolean;
  /** Fase da passada (avança com a distância andada). */
  passo: number;
}

const QUADRIL_SENTADO = 0.55;
const QUADRIL_EM_PE = 0.92;
const COXA = 0.4;
const CANELA = 0.4;
const OMBRO_X = 0.21;
const BRACO = 0.27;
const ANTEBRACO = 0.25;
// Sentado, fica um pouco à frente do centro da cadeira, perto da mesa.
const FRENTE = 0.1;
const lerp = THREE.MathUtils.lerp;

function Membro({ comprimento, raio, material }: { comprimento: number; raio: [number, number]; material: THREE.Material }) {
  // Cilindro com a ponta arredondada, pendurado da articulação para baixo (-y).
  return (
    <group>
      <mesh position={[0, -comprimento / 2, 0]} material={material} castShadow>
        <cylinderGeometry args={[raio[0], raio[1], comprimento, 18]} />
      </mesh>
      <mesh position={[0, -comprimento, 0]} material={material} castShadow>
        <sphereGeometry args={[raio[1], 16, 12]} />
      </mesh>
    </group>
  );
}

export function AgenteIA({
  cor,
  ocupado,
  destacado,
  aoClicar,
  postura,
}: {
  cor: string;
  /** Tem conversa ativa: digita. */
  ocupado: boolean;
  destacado: boolean;
  aoClicar: () => void;
  postura?: MutableRefObject<PosturaAgente>;
}) {
  const logo = useTexture("/painel/espaco/cf-laranja.png");
  logo.colorSpace = THREE.SRGBColorSpace;
  const m = useMemo(
    () => ({
      traje: new THREE.MeshPhysicalMaterial({ color: "#eef1f5", roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color("#ffffff") }),
      destaque: new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.4, clearcoat: 0.6 }),
      junta: new THREE.MeshStandardMaterial({ color: "#2b3344", roughness: 0.45, metalness: 0.5 }),
      capacete: new THREE.MeshPhysicalMaterial({ color: "#f5f7fa", roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }),
      viseira: new THREE.MeshPhysicalMaterial({ color: "#0d1424", roughness: 0.05, metalness: 0.9, clearcoat: 1 }),
      reflexo: new THREE.MeshBasicMaterial({ color: "#ffd8ad", transparent: true, opacity: 0.6 }),
      luz: new THREE.MeshStandardMaterial({ color: cor, emissive: cor, emissiveIntensity: 1.4 }),
      painel: new THREE.MeshStandardMaterial({ color: "#14295a", roughness: 0.4, metalness: 0.4 }),
      logo: new THREE.MeshBasicMaterial({ map: logo, transparent: true, toneMapped: false }),
      pasta: new THREE.MeshStandardMaterial({ color: "#f7931e", roughness: 0.6 }),
      papel: new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.8 }),
    }),
    [cor, logo],
  );

  const corpo = useRef<THREE.Group>(null);
  const tronco = useRef<THREE.Group>(null);
  const cabeca = useRef<THREE.Group>(null);
  const quadris = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const joelhos = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const ombros = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const cotovelos = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const pasta = useRef<THREE.Group>(null);
  const anel = useRef<THREE.MeshBasicMaterial>(null);
  const sobre = useRef(false);
  const aceno = useRef(0);
  const pe = useRef(0);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const p = postura?.current;
    pe.current = THREE.MathUtils.damp(pe.current, p?.emPe ?? 0, 7, dt);
    const e = pe.current;
    const andando = !!p?.andando;
    const buscando = !!p?.buscando;
    const levando = !!p?.levando;
    const passada = andando ? Math.sin(p!.passo) : 0;
    aceno.current = THREE.MathUtils.damp(aceno.current, (destacado || sobre.current) && !andando && !levando ? 1 : 0, 6, dt);

    if (corpo.current) corpo.current.position.z = lerp(FRENTE, 0, e);
    // Pernas: sentado (coxa à frente, canela para baixo) ↔ em pé (passada alternada).
    quadris.forEach((q, lado) => {
      const joelho = joelhos[lado].current;
      if (!q.current || !joelho) return;
      const balanco = (lado === 0 ? 1 : -1) * passada * 0.55;
      q.current.position.y = lerp(QUADRIL_SENTADO, QUADRIL_EM_PE, e);
      q.current.rotation.x = lerp(-Math.PI / 2, balanco, e);
      joelho.rotation.x = lerp(Math.PI / 2 - 0.08, Math.max(0, balanco) * 1.1 + 0.04, e);
    });
    if (tronco.current) {
      tronco.current.position.y = lerp(QUADRIL_SENTADO, QUADRIL_EM_PE, e) + (andando ? Math.abs(passada) * 0.025 : 0);
      tronco.current.rotation.x = lerp(ocupado ? 0.12 : 0.04, buscando ? 0.18 : 0.03, e);
      tronco.current.scale.y = 1 + Math.sin(t * 1.6) * 0.01;
    }
    if (cabeca.current) {
      const olhar = buscando ? Math.sin(t * 1.4) * 0.25 : andando ? 0 : ocupado ? Math.sin(t * 0.7) * 0.08 : Math.sin(t * 0.35) * 0.35;
      cabeca.current.rotation.y = olhar;
      cabeca.current.rotation.x = buscando ? 0.25 : ocupado && e < 0.5 ? 0.15 : Math.sin(t * 0.5) * 0.04;
    }
    if (pasta.current) pasta.current.visible = levando && e > 0.5;
    if (anel.current) anel.current.opacity = destacado ? 0.9 : ocupado ? 0.45 + Math.sin(t * 3) * 0.15 : 0.35;

    ombros.forEach((ombro, lado) => {
      const cotovelo = cotovelos[lado].current;
      if (!ombro.current || !cotovelo) return;
      // Sentado: braços à frente, luvas no teclado (digitando quando atende).
      const digitar = ocupado ? Math.sin(t * 13 + lado * Math.PI) * 0.07 : Math.sin(t * 1.2 + lado) * 0.02;
      let ombroX = -0.9;
      let ombroZ = lado === 0 ? -0.1 : 0.1;
      let cotoveloX = -0.7 + digitar;
      // Em pé: andando balança ao contrário das pernas; buscando, mãos à frente remexendo; levando, segura a pasta.
      const emPeX = levando ? -0.75 : buscando ? -1.25 + Math.sin(t * 6 + lado * 2) * 0.12 : (lado === 0 ? -1 : 1) * passada * 0.5;
      const emPeCotovelo = levando ? -0.85 : buscando ? -0.45 : andando ? -0.35 : -0.15;
      ombroX = lerp(ombroX, emPeX, e);
      ombroZ = lerp(ombroZ, lado === 0 ? -0.08 : 0.08, e);
      cotoveloX = lerp(cotoveloX, emPeCotovelo, e);
      if (lado === 1 && aceno.current > 0.01) {
        const a = aceno.current;
        ombroX = lerp(ombroX, -0.4, a);
        ombroZ = lerp(ombroZ, 2.5, a);
        cotoveloX = lerp(cotoveloX, -0.25 + Math.sin(t * 9) * 0.35, a);
      }
      ombro.current.rotation.set(ombroX, 0, ombroZ);
      cotovelo.rotation.x = cotoveloX;
    });
  });

  return (
    <group
      onClick={(ev: ThreeEvent<MouseEvent>) => {
        ev.stopPropagation();
        aoClicar();
      }}
      onPointerOver={(ev: ThreeEvent<PointerEvent>) => {
        ev.stopPropagation();
        sobre.current = true;
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        sobre.current = false;
        document.body.style.cursor = "";
      }}
    >
      <mesh position={[0, 0.025, 0.15]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.7, 48]} />
        <meshBasicMaterial ref={anel} color={cor} transparent opacity={0.35} />
      </mesh>

      <group ref={corpo} position={[0, 0, FRENTE]}>
        {/* Pernas: quadril → coxa → joelho → canela → bota */}
        {[-1, 1].map((lado, i) => (
          <group key={lado} ref={quadris[i]} position={[lado * 0.1, QUADRIL_SENTADO, 0]}>
            <Membro comprimento={COXA} raio={[0.085, 0.065]} material={m.traje} />
            <group ref={joelhos[i]} position={[0, -COXA, 0]}>
              <mesh material={m.destaque} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.066, 0.016, 8, 20]} />
              </mesh>
              <Membro comprimento={CANELA} raio={[0.064, 0.055]} material={m.traje} />
              <mesh position={[0, -CANELA + 0.03, 0]} material={m.destaque}>
                <cylinderGeometry args={[0.066, 0.066, 0.05, 18]} />
              </mesh>
              <RoundedBox args={[0.12, 0.1, 0.26]} radius={0.035} position={[0, -CANELA - 0.06, 0.05]} material={m.junta} castShadow />
            </group>
          </group>
        ))}

        <group ref={tronco} position={[0, QUADRIL_SENTADO, 0]}>
          {/* Quadril e tronco do traje */}
          <mesh position={[0, 0.04, -0.01]} scale={[1.2, 0.72, 0.9]} material={m.traje} castShadow>
            <sphereGeometry args={[0.16, 24, 16]} />
          </mesh>
          <mesh position={[0, 0.26, 0]} scale={[1, 1, 0.7]} material={m.traje} castShadow>
            <cylinderGeometry args={[0.215, 0.17, 0.4, 28]} />
          </mesh>
          <mesh position={[0, 0.46, 0]} scale={[1, 0.45, 0.7]} material={m.traje} castShadow>
            <sphereGeometry args={[0.215, 28, 16]} />
          </mesh>
          {/* Painel do peito com o CF e luzes de status */}
          <RoundedBox args={[0.2, 0.15, 0.05]} radius={0.02} position={[0, 0.3, 0.14]} material={m.painel} />
          <mesh position={[-0.035, 0.3, 0.167]} material={m.logo}>
            <planeGeometry args={[0.11, 0.11]} />
          </mesh>
          {[0.03, 0.06].map((y) => (
            <mesh key={y} position={[0.06, 0.27 + y, 0.167]} material={m.luz}>
              <circleGeometry args={[0.012, 12]} />
            </mesh>
          ))}
          {/* Faixa na cor do agente e mochila de suporte de vida */}
          <mesh position={[0, 0.12, 0]} scale={[1, 1, 0.72]} material={m.destaque}>
            <cylinderGeometry args={[0.178, 0.178, 0.04, 28]} />
          </mesh>
          <RoundedBox args={[0.36, 0.42, 0.16]} radius={0.05} position={[0, 0.3, -0.2]} material={m.traje} castShadow />
          <mesh position={[0, 0.42, -0.285]} material={m.luz}>
            <boxGeometry args={[0.2, 0.025, 0.01]} />
          </mesh>
          {/* A pasta da conversa, na frente do peito, quando leva uma transferência */}
          <group ref={pasta} position={[0, 0.22, 0.3]} rotation={[0.25, 0, 0]} visible={false}>
            <RoundedBox args={[0.34, 0.26, 0.04]} radius={0.01} material={m.pasta} castShadow />
            <mesh position={[0, 0.14, 0]} material={m.papel}>
              <boxGeometry args={[0.28, 0.04, 0.025]} />
            </mesh>
          </group>

          {/* Colar e capacete com viseira espelhada */}
          <mesh position={[0, 0.54, 0]} material={m.junta}>
            <cylinderGeometry args={[0.1, 0.12, 0.06, 24]} />
          </mesh>
          <group ref={cabeca} position={[0, 0.69, 0.01]}>
            <mesh material={m.capacete} castShadow>
              <sphereGeometry args={[0.15, 32, 24]} />
            </mesh>
            <mesh position={[0, 0.005, 0.02]} scale={[1, 0.82, 1]} material={m.viseira}>
              <sphereGeometry args={[0.142, 32, 20, -Math.PI * 0.36, Math.PI * 0.72, Math.PI * 0.22, Math.PI * 0.5]} />
            </mesh>
            <mesh position={[-0.05, 0.04, 0.128]} rotation={[0, -0.35, 0.5]} material={m.reflexo}>
              <planeGeometry args={[0.05, 0.015]} />
            </mesh>
            {[-1, 1].map((lado) => (
              <mesh key={lado} position={[lado * 0.148, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={m.destaque}>
                <cylinderGeometry args={[0.035, 0.035, 0.03, 20]} />
              </mesh>
            ))}
          </group>

          {/* Braços: ombro → cotovelo → luva */}
          {[-1, 1].map((lado, i) => (
            <group key={lado} ref={ombros[i]} position={[lado * OMBRO_X, 0.45, 0]}>
              <mesh material={m.destaque}>
                <sphereGeometry args={[0.065, 16, 12]} />
              </mesh>
              <Membro comprimento={BRACO} raio={[0.058, 0.05]} material={m.traje} />
              <group ref={cotovelos[i]} position={[0, -BRACO, 0]}>
                <Membro comprimento={ANTEBRACO} raio={[0.05, 0.045]} material={m.traje} />
                <mesh position={[0, -ANTEBRACO + 0.02, 0]} material={m.destaque}>
                  <cylinderGeometry args={[0.052, 0.052, 0.04, 16]} />
                </mesh>
                <RoundedBox args={[0.085, 0.11, 0.045]} radius={0.02} position={[0, -ANTEBRACO - 0.06, 0]} material={m.junta} castShadow />
              </group>
            </group>
          ))}
        </group>
      </group>
      <pointLight color={cor} intensity={1.2} distance={3} position={[0, 1.6, 0.4]} />
    </group>
  );
}
