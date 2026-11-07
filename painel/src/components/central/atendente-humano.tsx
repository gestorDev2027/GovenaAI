import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

/*
 * Um atendente da equipe humana, sentado na mesa: as mesmas proporções do astronauta (agente-ia.tsx), mas
 * com roupa comum, pele e cabelo. Fica de frente para +z, como o agente. Quando há transferências esperando a
 * equipe, digita; livre, mexe de leve a cabeça e as mãos. Cada um tem um visual (pele, cabelo, camisa) pela
 * posição, para a sala não parecer povoada de clones.
 */

const QUADRIL = 0.55;
const COXA = 0.4;
const CANELA = 0.4;
const OMBRO_X = 0.2;
const BRACO = 0.27;
const ANTEBRACO = 0.25;
const FRENTE = 0.1;

const PELES = ["#f1c7a5", "#c68b62", "#8d5a3b", "#e0ac83", "#5c3a26", "#f3d2b8"];
const CABELOS = ["#2b1b12", "#5a3a22", "#111111", "#a0522d", "#1c1c1c", "#c9a36b"];
const CAMISAS = ["#2f80ff", "#f7931e", "#10b981", "#8b5cf6", "#ef4444", "#0ea5e9"];
// 0 curto, 1 longo, 2 coque
const PENTEADOS = [0, 1, 0, 2, 0, 1];

function Membro({ comprimento, raio, material }: { comprimento: number; raio: [number, number]; material: THREE.Material }) {
  return (
    <group>
      <mesh position={[0, -comprimento / 2, 0]} material={material} castShadow>
        <cylinderGeometry args={[raio[0], raio[1], comprimento, 14]} />
      </mesh>
      <mesh position={[0, -comprimento, 0]} material={material} castShadow>
        <sphereGeometry args={[raio[1], 12, 10]} />
      </mesh>
    </group>
  );
}

export function AtendenteHumano({ visual, atendendo }: { visual: number; atendendo: boolean }) {
  const i = ((visual % PELES.length) + PELES.length) % PELES.length;
  const m = useMemo(
    () => ({
      pele: new THREE.MeshStandardMaterial({ color: PELES[i], roughness: 0.7 }),
      cabelo: new THREE.MeshStandardMaterial({ color: CABELOS[i], roughness: 0.8 }),
      camisa: new THREE.MeshStandardMaterial({ color: CAMISAS[i], roughness: 0.75 }),
      calca: new THREE.MeshStandardMaterial({ color: "#26303f", roughness: 0.8 }),
      sapato: new THREE.MeshStandardMaterial({ color: "#151a22", roughness: 0.5 }),
      olho: new THREE.MeshBasicMaterial({ color: "#1b1b1b" }),
      fone: new THREE.MeshStandardMaterial({ color: "#2b3344", roughness: 0.4, metalness: 0.4 }),
    }),
    [i],
  );
  const penteado = PENTEADOS[i];
  const tronco = useRef<THREE.Group>(null);
  const cabeca = useRef<THREE.Group>(null);
  const ombros = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const cotovelos = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const fase = i * 1.7;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + fase;
    if (tronco.current) {
      tronco.current.rotation.x = atendendo ? 0.12 : 0.04;
      tronco.current.scale.y = 1 + Math.sin(t * 1.6) * 0.01;
    }
    if (cabeca.current) {
      cabeca.current.rotation.y = atendendo ? Math.sin(t * 0.7) * 0.08 : Math.sin(t * 0.35) * 0.3;
      cabeca.current.rotation.x = atendendo ? 0.15 : Math.sin(t * 0.5) * 0.04;
    }
    ombros.forEach((ombro, lado) => {
      const cotovelo = cotovelos[lado].current;
      if (!ombro.current || !cotovelo) return;
      const digitar = atendendo ? Math.sin(t * 13 + lado * Math.PI) * 0.07 : Math.sin(t * 1.2 + lado) * 0.02;
      ombro.current.rotation.set(-0.9, 0, lado === 0 ? -0.1 : 0.1);
      cotovelo.rotation.x = -0.7 + digitar;
    });
  });

  return (
    <group position={[0, 0, FRENTE]}>
      {/* Pernas sentadas: coxa à frente, canela para baixo, sapato */}
      {[-1, 1].map((lado) => (
        <group key={lado} position={[lado * 0.1, QUADRIL, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <Membro comprimento={COXA} raio={[0.08, 0.065]} material={m.calca} />
          <group position={[0, -COXA, 0]} rotation={[Math.PI / 2 - 0.08, 0, 0]}>
            <Membro comprimento={CANELA} raio={[0.06, 0.05]} material={m.calca} />
            <RoundedBox args={[0.11, 0.08, 0.24]} radius={0.03} position={[0, -CANELA - 0.05, 0.05]} material={m.sapato} castShadow />
          </group>
        </group>
      ))}

      <group ref={tronco} position={[0, QUADRIL, 0]}>
        {/* Quadril e tronco com a camisa */}
        <mesh position={[0, 0.04, -0.01]} scale={[1.15, 0.7, 0.85]} material={m.calca} castShadow>
          <sphereGeometry args={[0.15, 20, 14]} />
        </mesh>
        <mesh position={[0, 0.26, 0]} scale={[1, 1, 0.65]} material={m.camisa} castShadow>
          <cylinderGeometry args={[0.2, 0.16, 0.4, 24]} />
        </mesh>
        <mesh position={[0, 0.45, 0]} scale={[1, 0.42, 0.65]} material={m.camisa} castShadow>
          <sphereGeometry args={[0.2, 24, 14]} />
        </mesh>
        {/* Pescoço e cabeça */}
        <mesh position={[0, 0.53, 0]} material={m.pele}>
          <cylinderGeometry args={[0.055, 0.06, 0.08, 14]} />
        </mesh>
        <group ref={cabeca} position={[0, 0.67, 0.01]}>
          <mesh material={m.pele} castShadow>
            <sphereGeometry args={[0.12, 28, 20]} />
          </mesh>
          {[-1, 1].map((lado) => (
            <mesh key={lado} position={[lado * 0.04, 0.015, 0.112]} material={m.olho}>
              <sphereGeometry args={[0.012, 8, 8]} />
            </mesh>
          ))}
          {/* Cabelo: calota por cima e por trás; longo desce até o ombro; coque atrás */}
          <mesh position={[0, 0.025, -0.012]} scale={[1.06, 1, 1.06]} material={m.cabelo} castShadow>
            <sphereGeometry args={[0.125, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          </mesh>
          <mesh position={[0, -0.01, -0.04]} scale={[1.05, 1.05, 0.9]} material={m.cabelo}>
            <sphereGeometry args={[0.122, 20, 14, Math.PI * 0.2, Math.PI * 1.6, Math.PI * 0.3, Math.PI * 0.45]} />
          </mesh>
          {penteado === 1 && (
            <RoundedBox args={[0.24, 0.22, 0.09]} radius={0.04} position={[0, -0.1, -0.08]} material={m.cabelo} />
          )}
          {penteado === 2 && (
            <mesh position={[0, 0.06, -0.13]} material={m.cabelo}>
              <sphereGeometry args={[0.055, 14, 10]} />
            </mesh>
          )}
          {/* Fone de atendimento */}
          <mesh position={[0, 0.03, 0]} rotation={[0, 0, 0]} material={m.fone}>
            <torusGeometry args={[0.13, 0.008, 6, 20, Math.PI]} />
          </mesh>
          <mesh position={[-0.125, -0.01, 0]} rotation={[0, 0, Math.PI / 2]} material={m.fone}>
            <cylinderGeometry args={[0.03, 0.03, 0.025, 14]} />
          </mesh>
        </group>

        {/* Braços: ombro → cotovelo → mão, com a manga da camisa */}
        {[-1, 1].map((lado, k) => (
          <group key={lado} ref={ombros[k]} position={[lado * OMBRO_X, 0.44, 0]}>
            <Membro comprimento={BRACO} raio={[0.055, 0.048]} material={m.camisa} />
            <group ref={cotovelos[k]} position={[0, -BRACO, 0]}>
              <Membro comprimento={ANTEBRACO} raio={[0.044, 0.04]} material={m.pele} />
              <mesh position={[0, -ANTEBRACO - 0.04, 0]} material={m.pele} castShadow>
                <sphereGeometry args={[0.045, 12, 10]} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}
