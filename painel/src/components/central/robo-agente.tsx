import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { PosturaAgente } from "./agente-ia";

/*
 * O agente de IA como robô: o mesmo esqueleto e as mesmas animações do astronauta (agente-ia.tsx), com
 * casco de titânio, detalhes na cor do agente e o rosto numa tela. A expressão do rosto mostra o que ele
 * está fazendo, de longe e sem texto: concentrado digitando quando atende, sonolento quando está livre,
 * pensando, contente quando responde ou encerra, preocupado (em âmbar) quando dá erro e decidido quando leva
 * a pasta de uma transferência. Fica de frente para +z.
 */

/** A expressão do rosto. A cena pode impor uma por alguns segundos (reação a um acontecimento). */
export type Humor = "livre" | "foco" | "pensando" | "feliz" | "alerta" | "levando";

const QUADRIL_SENTADO = 0.55;
const QUADRIL_EM_PE = 0.92;
const COXA = 0.4;
const CANELA = 0.4;
const OMBRO_X = 0.22;
const BRACO = 0.27;
const ANTEBRACO = 0.25;
const FRENTE = 0.1;
const ALERTA = "#f59e0b";
const lerp = THREE.MathUtils.lerp;

// A tela do rosto: 256 × 160 px, desenhada a até 12 quadros por segundo e só quando muda.
const TELA_L = 256;
const TELA_A = 160;
const OLHOS: [number, number][] = [
  [86, 74],
  [170, 74],
];

function desenharRosto(ctx: CanvasRenderingContext2D, humor: Humor, t: number, cor: string) {
  ctx.clearRect(0, 0, TELA_L, TELA_A);
  ctx.fillStyle = "#04070c";
  ctx.fillRect(0, 0, TELA_L, TELA_A);
  const tinta = humor === "alerta" ? ALERTA : cor;
  ctx.fillStyle = tinta;
  ctx.strokeStyle = tinta;
  ctx.shadowColor = tinta;
  ctx.shadowBlur = 18;
  ctx.lineCap = "round";
  ctx.lineWidth = 11;
  // Piscada a cada ~4 s (cada robô no seu tempo, pela fase em t).
  const piscando = t % 4.2 < 0.14;

  const olhoRedondo = (x: number, y: number, r: number) => {
    if (piscando) {
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  switch (humor) {
    case "livre": {
      // Sonolento: olhos de meia-lua, olhando devagar de um lado para o outro.
      const dx = Math.sin(t * 0.5) * 7;
      for (const [x, y] of OLHOS) {
        ctx.beginPath();
        ctx.arc(x + dx, y - 4, 18, 0.12 * Math.PI, 0.88 * Math.PI);
        ctx.fill();
      }
      break;
    }
    case "foco": {
      // Concentrado: olhos estreitos e os três pontos digitando embaixo.
      for (const [x, y] of OLHOS) {
        const h = piscando ? 4 : 15;
        ctx.beginPath();
        ctx.roundRect(x - 22, y - h / 2 - 2, 44, h, 7);
        ctx.fill();
      }
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(t * 6 - i * 0.9));
        ctx.beginPath();
        ctx.arc(108 + i * 20, 124, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "pensando": {
      // Olhando para cima e para o lado, com os pontos subindo.
      for (const [x, y] of OLHOS) olhoRedondo(x + 9, y - 10, 15);
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 4 - i * 1.1));
        ctx.beginPath();
        ctx.arc(206 + i * 13, 34 - i * 9, 4 + i * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "feliz": {
      // ^ ^ e um sorriso.
      for (const [x, y] of OLHOS) {
        ctx.beginPath();
        ctx.arc(x, y + 8, 18, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(128, 104, 20, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    }
    case "alerta": {
      // Preocupado: olhos redondos e sobrancelhas caídas para fora, em âmbar.
      for (const [x, y] of OLHOS) olhoRedondo(x, y + 4, 15);
      ctx.lineWidth = 8;
      for (const [x, y] of OLHOS) {
        const fora = x < 128 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(x - fora * 6, y - 30);
        ctx.lineTo(x + fora * 20, y - 22);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(110, 124);
      ctx.quadraticCurveTo(128, 114, 146, 124);
      ctx.stroke();
      break;
    }
    case "levando": {
      // Decidido: olhos de meia-lua com o topo reto, olhando para a frente.
      for (const [x, y] of OLHOS) {
        ctx.beginPath();
        ctx.arc(x, y - 6, 18, 0, Math.PI);
        ctx.fill();
      }
      break;
    }
  }
  ctx.shadowBlur = 0;
  // Linhas de varredura bem leves, como numa tela.
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (let y = 0; y < TELA_A; y += 4) ctx.fillRect(0, y, TELA_L, 1);
}

function Membro({ comprimento, raio, material, junta }: { comprimento: number; raio: [number, number]; material: THREE.Material; junta: THREE.Material }) {
  // Segmento do casco pendurado da articulação para baixo (-y), com a junta escura na ponta.
  return (
    <group>
      <mesh position={[0, -comprimento / 2, 0]} material={material} castShadow>
        <cylinderGeometry args={[raio[0], raio[1], comprimento * 0.86, 18]} />
      </mesh>
      <mesh position={[0, -comprimento, 0]} material={junta} castShadow>
        <sphereGeometry args={[raio[1] * 0.95, 16, 12]} />
      </mesh>
    </group>
  );
}

export function RoboAgente({
  cor,
  ocupado,
  destacado,
  aoClicar,
  postura,
  reacao,
}: {
  cor: string;
  /** Tem conversa ativa: digita. */
  ocupado: boolean;
  destacado: boolean;
  aoClicar: () => void;
  postura?: MutableRefObject<PosturaAgente>;
  /** Expressão imposta pela cena até um instante (performance.now(), em ms). */
  reacao?: MutableRefObject<{ humor: Humor; ate: number } | null>;
}) {
  const logo = useTexture("/painel/espaco/gestorgov-cor.png");
  logo.colorSpace = THREE.SRGBColorSpace;

  const tela = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = TELA_L;
    canvas.height = TELA_A;
    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = 4;
    return { ctx: canvas.getContext("2d")!, textura };
  }, []);
  useEffect(() => () => tela.textura.dispose(), [tela]);

  const m = useMemo(
    () => ({
      casco: new THREE.MeshPhysicalMaterial({ color: "#d5dce6", roughness: 0.32, metalness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      escuro: new THREE.MeshStandardMaterial({ color: "#232a36", roughness: 0.4, metalness: 0.6 }),
      destaque: new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.35, metalness: 0.3, clearcoat: 0.6 }),
      luz: new THREE.MeshStandardMaterial({ color: cor, emissive: cor, emissiveIntensity: 2.2, toneMapped: false }),
      vidro: new THREE.MeshPhysicalMaterial({ color: "#05080d", roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
      rosto: new THREE.MeshBasicMaterial({ map: tela.textura, toneMapped: false }),
      logo: new THREE.MeshBasicMaterial({ map: logo, transparent: true, toneMapped: false }),
      pasta: new THREE.MeshStandardMaterial({ color: "#f7931e", roughness: 0.6 }),
      papel: new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.8 }),
    }),
    [cor, logo, tela],
  );

  const corpo = useRef<THREE.Group>(null);
  const tronco = useRef<THREE.Group>(null);
  const cabeca = useRef<THREE.Group>(null);
  const antena = useRef<THREE.MeshStandardMaterial>(null);
  const quadris = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const joelhos = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const ombros = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const cotovelos = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const pasta = useRef<THREE.Group>(null);
  const anel = useRef<THREE.MeshBasicMaterial>(null);
  const sobre = useRef(false);
  const aceno = useRef(0);
  const pe = useRef(0);
  const desenhado = useRef("");
  const fase = useMemo(() => Math.random() * 10, []);

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

    // Rosto: a reação imposta pela cena vale até o prazo; depois, o estado de agora.
    const imposta = reacao?.current && reacao.current.ate > performance.now() ? reacao.current.humor : null;
    const humor: Humor = levando ? "levando" : imposta ?? (buscando ? "pensando" : aceno.current > 0.5 ? "feliz" : ocupado ? "foco" : "livre");
    const quadro = `${humor}|${Math.floor((t + fase) * 12)}`;
    if (quadro !== desenhado.current) {
      desenhado.current = quadro;
      desenharRosto(tela.ctx, humor, t + fase, cor);
      tela.textura.needsUpdate = true;
    }
    if (antena.current) {
      antena.current.emissive.set(humor === "alerta" ? ALERTA : cor);
      antena.current.emissiveIntensity = humor === "alerta" ? 2 + Math.sin(t * 12) * 1.2 : 1.6 + Math.sin(t * 2 + fase) * 0.6;
    }

    if (corpo.current) corpo.current.position.z = lerp(FRENTE, 0, e);
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
      tronco.current.rotation.x = lerp(ocupado ? 0.1 : 0.03, buscando ? 0.16 : 0.03, e);
    }
    if (cabeca.current) {
      const olhar = buscando ? Math.sin(t * 1.4) * 0.25 : andando ? 0 : ocupado ? Math.sin(t * 0.7) * 0.08 : Math.sin(t * 0.35) * 0.3;
      cabeca.current.rotation.y = olhar;
      cabeca.current.rotation.x = buscando ? 0.22 : ocupado && e < 0.5 ? 0.12 : Math.sin(t * 0.5) * 0.04;
      // Inclina a cabeça de leve quando pensa ou fica contente.
      cabeca.current.rotation.z = humor === "pensando" ? 0.12 : humor === "feliz" ? Math.sin(t * 3) * 0.06 : 0;
    }
    if (pasta.current) pasta.current.visible = levando && e > 0.5;
    if (anel.current) anel.current.opacity = destacado ? 0.9 : ocupado ? 0.45 + Math.sin(t * 3) * 0.15 : 0.3;

    ombros.forEach((ombro, lado) => {
      const cotovelo = cotovelos[lado].current;
      if (!ombro.current || !cotovelo) return;
      const digitar = ocupado ? Math.sin(t * 13 + lado * Math.PI) * 0.07 : Math.sin(t * 1.2 + lado) * 0.02;
      let ombroX = -0.9;
      let ombroZ = lado === 0 ? -0.12 : 0.12;
      let cotoveloX = -0.7 + digitar;
      const emPeX = levando ? -0.75 : buscando ? -1.25 + Math.sin(t * 6 + lado * 2) * 0.12 : (lado === 0 ? -1 : 1) * passada * 0.5;
      const emPeCotovelo = levando ? -0.85 : buscando ? -0.45 : andando ? -0.35 : -0.15;
      ombroX = lerp(ombroX, emPeX, e);
      ombroZ = lerp(ombroZ, lado === 0 ? -0.1 : 0.1, e);
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
        <meshBasicMaterial ref={anel} color={cor} transparent opacity={0.3} />
      </mesh>

      <group ref={corpo} position={[0, 0, FRENTE]}>
        {/* Pernas: quadril → coxa → joelho → canela → pé */}
        {[-1, 1].map((lado, i) => (
          <group key={lado} ref={quadris[i]} position={[lado * 0.1, QUADRIL_SENTADO, 0]}>
            <Membro comprimento={COXA} raio={[0.08, 0.066]} material={m.casco} junta={m.escuro} />
            <group ref={joelhos[i]} position={[0, -COXA, 0]}>
              <Membro comprimento={CANELA} raio={[0.066, 0.06]} material={m.casco} junta={m.escuro} />
              <mesh position={[0, -CANELA * 0.45, 0.055]} material={m.luz}>
                <boxGeometry args={[0.03, 0.12, 0.01]} />
              </mesh>
              <RoundedBox args={[0.13, 0.09, 0.27]} radius={0.04} position={[0, -CANELA - 0.06, 0.05]} material={m.escuro} castShadow />
            </group>
          </group>
        ))}

        <group ref={tronco} position={[0, QUADRIL_SENTADO, 0]}>
          {/* Quadril e tronco: casco arredondado com a placa do peito */}
          <RoundedBox args={[0.32, 0.14, 0.24]} radius={0.06} position={[0, 0.03, -0.01]} material={m.escuro} castShadow />
          <RoundedBox args={[0.44, 0.42, 0.3]} radius={0.12} position={[0, 0.3, 0]} material={m.casco} castShadow />
          <RoundedBox args={[0.24, 0.17, 0.04]} radius={0.03} position={[0, 0.31, 0.142]} material={m.vidro} />
          <mesh position={[-0.05, 0.31, 0.164]} material={m.logo}>
            <planeGeometry args={[0.1, 0.1]} />
          </mesh>
          {[0, 1, 2].map((k) => (
            <mesh key={k} position={[0.045 + k * 0.03, 0.31, 0.164]} material={m.luz}>
              <circleGeometry args={[0.009, 10]} />
            </mesh>
          ))}
          {/* Faixa de luz na cintura e reator nas costas */}
          <mesh position={[0, 0.12, 0]} scale={[1, 1, 0.68]} material={m.luz}>
            <cylinderGeometry args={[0.205, 0.205, 0.018, 28]} />
          </mesh>
          <RoundedBox args={[0.3, 0.3, 0.1]} radius={0.04} position={[0, 0.32, -0.18]} material={m.escuro} castShadow />
          <mesh position={[0, 0.32, -0.232]} rotation={[0, Math.PI, 0]} material={m.luz}>
            <ringGeometry args={[0.05, 0.075, 24]} />
          </mesh>
          {/* A pasta da conversa, na frente do peito, quando leva uma transferência */}
          <group ref={pasta} position={[0, 0.22, 0.32]} rotation={[0.25, 0, 0]} visible={false}>
            <RoundedBox args={[0.34, 0.26, 0.04]} radius={0.01} material={m.pasta} castShadow />
            <mesh position={[0, 0.14, 0]} material={m.papel}>
              <boxGeometry args={[0.28, 0.04, 0.025]} />
            </mesh>
          </group>

          {/* Pescoço e cabeça: casco com a tela do rosto, orelhas de luz e antena */}
          <mesh position={[0, 0.535, 0]} material={m.escuro}>
            <cylinderGeometry args={[0.065, 0.085, 0.07, 20]} />
          </mesh>
          <group ref={cabeca} position={[0, 0.71, 0.01]}>
            <RoundedBox args={[0.42, 0.33, 0.33]} radius={0.12} smoothness={6} material={m.casco} castShadow />
            <RoundedBox args={[0.34, 0.23, 0.04]} radius={0.06} position={[0, -0.005, 0.15]} material={m.vidro} />
            <mesh position={[0, -0.005, 0.172]} material={m.rosto}>
              <planeGeometry args={[0.29, 0.18]} />
            </mesh>
            {[-1, 1].map((lado) => (
              <group key={lado} position={[lado * 0.215, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <mesh material={m.escuro}>
                  <cylinderGeometry args={[0.07, 0.07, 0.04, 24]} />
                </mesh>
                <mesh position={[0, lado * 0.022, 0]} rotation={[lado > 0 ? 0 : Math.PI, 0, 0]} material={m.luz}>
                  <torusGeometry args={[0.045, 0.01, 8, 24]} />
                </mesh>
              </group>
            ))}
            <mesh position={[0.08, 0.2, -0.02]} rotation={[0, 0, -0.2]} material={m.escuro}>
              <cylinderGeometry args={[0.008, 0.012, 0.12, 8]} />
            </mesh>
            <mesh position={[0.093, 0.265, -0.02]}>
              <sphereGeometry args={[0.025, 14, 10]} />
              <meshStandardMaterial ref={antena} color={cor} emissive={cor} emissiveIntensity={1.6} toneMapped={false} />
            </mesh>
          </group>

          {/* Braços: ombro → cotovelo → mão */}
          {[-1, 1].map((lado, i) => (
            <group key={lado} ref={ombros[i]} position={[lado * OMBRO_X, 0.44, 0]}>
              <mesh material={m.destaque} castShadow>
                <sphereGeometry args={[0.075, 18, 14]} />
              </mesh>
              <Membro comprimento={BRACO} raio={[0.055, 0.048]} material={m.casco} junta={m.escuro} />
              <group ref={cotovelos[i]} position={[0, -BRACO, 0]}>
                <Membro comprimento={ANTEBRACO} raio={[0.05, 0.046]} material={m.casco} junta={m.escuro} />
                <RoundedBox args={[0.09, 0.1, 0.06]} radius={0.025} position={[0, -ANTEBRACO - 0.06, 0]} material={m.escuro} castShadow />
              </group>
            </group>
          ))}
        </group>
      </group>
      <pointLight color={cor} intensity={1.2} distance={3} position={[0, 1.6, 0.4]} />
    </group>
  );
}
