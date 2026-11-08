import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as Controles } from "three-stdlib";
import type { AgenteCentral, ConversaCentral, EventoCentral } from "@/lib/api";
import { cn } from "@/lib/utils";
import { porArea } from "@/lib/agentes";
import { tripulante } from "@/lib/tripulacao";
import { SETORES, setorDaFerramenta, type SetorId } from "@/lib/setores";
import type { PosturaAgente } from "./agente-ia";
import { RoboAgente, type Humor } from "./robo-agente";
import { AtendenteHumano } from "./atendente-humano";
import { ANDAR, CascaDoAndar, PE_DIREITO, Quarteirao, limitesDoQuarteirao } from "./exterior";
import { ICONE_SETOR } from "@/lib/setores-icones";
import {
  Arquivo,
  Balcao,
  BancadaExpedicao,
  Banner,
  CaixaDePastas,
  Cadeira,
  CarrinhoDeCarga,
  Cofre,
  Copa,
  DivisoriaVidro,
  Estacao,
  Estante,
  EstanteAco,
  Lousa,
  Luminaria,
  PainelMadeira,
  PALETAS,
  Palete,
  Planta,
  Rack,
  SalaReuniao,
  Sofa,
  TvAula,
  type Paleta,
} from "./moveis";

/*
 * A Central ao vivo como um escritório de verdade, em vista isométrica, com setores em volta da baia de
 * atendimento: recepção (onde chegam os pedidos), cadastro da secretaria, fontes públicas, base de
 * conhecimento, implantação, catálogo de atividades, equipe humana e a copa. Cada agente é um robô na sua mesa, com o rosto numa
 * tela que mostra o que ele está fazendo. Quando ele usa uma ferramenta (aviso "ferramenta" do /central/eventos), levanta, anda pelos corredores até o setor
 * dela, busca e volta; na transferência, leva a pasta até a equipe humana. Mensagem que chega e resposta
 * que sai voam como envelopes entre a recepção e a mesa. As conversas ativas são balões sobre a mesa do
 * agente. Clicar num setor abre o painel dele; num agente ou num balão, o painel do agente ou da conversa.
 *
 * O escritório é o segundo andar do prédio da Secretaria de Saúde, numa maquete de quarteirão (exterior.tsx). A tela começa
 * com o prédio fechado, visto de fora; ele abre pelo botão da barra, por um clique nele ou ao selecionar algo
 * de dentro, e a cobertura sobe mostrando o escritório.
 */

export type EstadoMesa = "conversando" | "aguardando";
/** O que está selecionado: uma conversa (balão), um agente ou um setor. */
export type Selecao = { tipo: "conversa"; id: string } | { tipo: "agente"; id: string } | { tipo: "setor"; id: SetorId } | null;

/** Comandos de câmera para os botões da tela (aproximar, afastar, ver o escritório inteiro). */
export interface ApiCamera {
  aproximar: (fator: number) => void;
  centralizar: () => void;
}

export const SEGUNDOS_CONVERSANDO = 120;
// Na mesa só fica quem teve mensagem nos últimos 15 min; as paradas há mais tempo saem da planta (seguem na lista).
export const SEGUNDOS_NA_MESA = 15 * 60;
const AZUL = "#3b82f6";
const AMARELO = "#F4B800";
const VERDE = "#22c55e";
const AMBAR = "#52A2FF"; // esperando o servidor

/* ───────── Planta ───────── */

// Cada baia tem 2 blocos de 6 mesas encostadas, um atrás do outro (fileira do fundo de frente para a
// câmera, a da frente de costas). Mesas de 2,4 × 1,1; entre os blocos, 4,8 de centro a centro.
const LARGURA_BAIA = 9;
const ENTRE_BAIAS = 2.5;
const MESAS_POR_BLOCO = 6;
const BLOCOS = 2;
const ENTRE_BLOCOS = 4.8;
const POR_BAIA = MESAS_POR_BLOCO * BLOCOS;
const PROFUNDIDADE = 9 + (BLOCOS - 1) * ENTRE_BLOCOS;
const Z_BLOCOS = Array.from({ length: BLOCOS }, (_, b) => (b - (BLOCOS - 1) / 2) * ENTRE_BLOCOS);
const LUGARES = Array.from({ length: POR_BAIA }, (_, i) => {
  const z = Z_BLOCOS[Math.floor(i / MESAS_POR_BLOCO)];
  const fundo = i % MESAS_POR_BLOCO < 3;
  const x = ((i % 3) - 1) * 2.4;
  return { x, mesaZ: z + (fundo ? -0.57 : 0.57), cadeiraZ: z + (fundo ? -1.52 : 1.52), giro: fundo ? 0 : Math.PI };
});
// Sala da equipe humana: uma baia de 6 (um bloco igual ao dos agentes) e a mesa das pastas transferidas
// logo depois da porta, fora do caminho da baia.
const LUGARES_EQUIPE = LUGARES.slice(0, MESAS_POR_BLOCO).map((l) => ({ ...l, mesaZ: l.mesaZ - Z_BLOCOS[0], cadeiraZ: l.cadeiraZ - Z_BLOCOS[0] }));
const EQUIPE_BAIA_X = 4.4;
const EQUIPE_PASTAS_X = 1.3;
const EQUIPE_PASTAS_Z = 1.75;
// Corredor em volta da baia; salas do fundo (entre as colunas) e colunas de salas dos dois lados.
const CORREDOR = 2.4;
const COLUNA = 7.5;
const FUNDO_SALAS = 5.5;
const PORTA = 1.6;
// Balões empilhados sobre a mesa do agente; passando de 4, o resto aparece como "+N" no nome.
const MAX_BALOES = 4;
const BALAO_Y = 1.85;
const BALAO_PASSO = 0.55;
const alturaDoNome = (baloes: number) => BALAO_Y + Math.min(baloes, MAX_BALOES) * BALAO_PASSO + (baloes ? 0.05 : 0.1);
const VELOCIDADE = 2.6;
const ESPESSURA_PISO = 0.12;

export interface Retangulo {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Uma sala: o retângulo, a porta (no meio da parede que dá para o corredor), o ponto do corredor diante
 * dela e onde o agente fica para buscar (olhando para os móveis). */
interface Sala {
  id: SetorId | "copa";
  ret: Retangulo;
  lado: "fundo" | "esquerda" | "direita";
  porta: THREE.Vector3;
  corredor: THREE.Vector3;
  busca: THREE.Vector3;
  olhar: number;
}

function montarPlanta(baias: number) {
  const larguraBaias = baias * LARGURA_BAIA + (baias - 1) * ENTRE_BAIAS;
  const bx0 = -larguraBaias / 2;
  const bx1 = larguraBaias / 2;
  const bz0 = -PROFUNDIDADE / 2;
  const bz1 = PROFUNDIDADE / 2;
  const xEsq1 = bx0 - CORREDOR;
  const xEsq0 = xEsq1 - COLUNA;
  const xDir0 = bx1 + CORREDOR;
  const xDir1 = xDir0 + COLUNA;
  const zFundo1 = bz0 - CORREDOR;
  const zFundo0 = zFundo1 - FUNDO_SALAS;
  const zFrente = bz1 + CORREDOR;
  const corredor = { esq: bx0 - CORREDOR / 2, dir: bx1 + CORREDOR / 2, fundo: bz0 - CORREDOR / 2, frente: bz1 + CORREDOR / 2 };

  const salas: Sala[] = [];
  // Fundo: 3 salas entre as colunas, porta para o corredor do fundo; móveis na parede do fundo.
  const larguraFundo = (xDir0 - xEsq1) / 3;
  (["secretaria", "fontes", "base"] as const).forEach((id, i) => {
    const x0 = xEsq1 + i * larguraFundo;
    const cx = x0 + larguraFundo / 2;
    salas.push({
      id,
      lado: "fundo",
      ret: { x0, x1: x0 + larguraFundo, z0: zFundo0, z1: zFundo1 },
      porta: new THREE.Vector3(cx, 0, zFundo1),
      corredor: new THREE.Vector3(cx, 0, corredor.fundo),
      busca: new THREE.Vector3(cx, 0, zFundo0 + 1.6),
      olhar: Math.PI,
    });
  });
  // Colunas: salas dos dois lados, porta para o corredor lateral; móveis na parede de fora. À esquerda, a
  // implantação ocupa o canto do fundo (a porta dá para o trecho do corredor ao lado da baia) e a copa fica
  // entre ela e a recepção. Cada trecho: sala, início e fim no eixo z e onde fica a porta.
  const zCopa = zFundo1 + 3.3;
  const colunas: [Sala["lado"], [SetorId | "copa", number, number, number][], number, number, number][] = [
    ["esquerda", [["implantacao", zFundo0, zCopa, (zFundo1 + zCopa) / 2], ["copa", zCopa, 0, zCopa / 2], ["recepcao", 0, zFrente, bz1 / 2]], xEsq0, xEsq1, corredor.esq],
    ["direita", [["catalogo", zFundo0, 0, zFundo1 / 2], ["equipe", 0, zFrente, bz1 / 2]], xDir0, xDir1, corredor.dir],
  ];
  for (const [lado, trechos, x0, x1, xCorredor] of colunas) {
    trechos.forEach(([id, z0, z1, zPorta]) => {
      const esquerda = lado === "esquerda";
      salas.push({
        id,
        lado,
        ret: { x0, x1, z0, z1 },
        porta: new THREE.Vector3(esquerda ? x1 : x0, 0, zPorta),
        corredor: new THREE.Vector3(xCorredor, 0, zPorta),
        busca: new THREE.Vector3(esquerda ? x0 + 1.9 : x1 - 1.9, 0, zPorta),
        olhar: esquerda ? -Math.PI / 2 : Math.PI / 2,
        // Equipe humana: a baia ocupa o meio da sala; a mesa das pastas fica logo depois da porta.
        ...(id === "equipe" && {
          busca: new THREE.Vector3(x0 + EQUIPE_PASTAS_X, 0, zPorta - EQUIPE_PASTAS_Z + 0.9),
          olhar: Math.PI,
        }),
      });
    });
  }
  return { bx0, bx1, bz0, bz1, xEsq0, xEsq1, xDir0, xDir1, zFundo0, zFundo1, zFrente, corredor, salas, larguraBaias };
}
type Planta = ReturnType<typeof montarPlanta>;

/** Caminho da cadeira até o ponto de busca da sala, só por corredores (sai pelo corredor da fileira). */
function rota(planta: Planta, cadeira: THREE.Vector3, sala: Sala): THREE.Vector3[] {
  const { corredor } = planta;
  const meio = (planta.bx0 + planta.bx1) / 2;
  const xLado = sala.lado === "esquerda" ? corredor.esq : sala.lado === "direita" ? corredor.dir : sala.porta.x < meio ? corredor.esq : corredor.dir;
  const pontos = [cadeira.clone(), new THREE.Vector3(xLado, 0, cadeira.z)];
  if (sala.lado === "fundo") {
    pontos.push(new THREE.Vector3(xLado, 0, corredor.fundo), sala.corredor.clone());
  } else {
    pontos.push(new THREE.Vector3(xLado, 0, sala.corredor.z));
  }
  const dentro = sala.porta.clone().add(
    sala.lado === "fundo" ? new THREE.Vector3(0, 0, -0.9) : new THREE.Vector3(sala.lado === "esquerda" ? -0.9 : 0.9, 0, 0),
  );
  pontos.push(dentro, sala.busca.clone());
  // Tira pontos repetidos (quando a cadeira já está no corredor certo).
  return pontos.filter((p, i) => i === 0 || p.distanceTo(pontos[i - 1]) > 0.01);
}

/* ───────── Utilidades ───────── */

function hash(texto: string) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function naMesa(c: ConversaCentral) {
  return c.status === "em_atendimento" && c.parada_ha_s != null && c.parada_ha_s <= SEGUNDOS_NA_MESA;
}

export function estadoMesa(c: ConversaCentral): EstadoMesa {
  return c.parada_ha_s != null && c.parada_ha_s <= SEGUNDOS_CONVERSANDO ? "conversando" : "aguardando";
}

/** Os balões de um agente, de baixo para cima; a ordem vem do id (não muda a cada atualização). */
function empilhar(conversas: ConversaCentral[]) {
  const ordenadas = conversas.filter(naMesa).sort((a, b) => a.id.localeCompare(b.id));
  return { baloes: ordenadas.slice(0, MAX_BALOES), fila: Math.max(0, ordenadas.length - MAX_BALOES) };
}

/** Os agentes juntos, lado a lado por área, de 12 em 12: cada grupo é uma baia (sempre pelo menos uma). */
function montarBaias(agentes: AgenteCentral[]): AgenteCentral[][] {
  const emOrdem = porArea(agentes).flatMap((g) => g.itens);
  const baias = Array.from({ length: Math.ceil(emOrdem.length / POR_BAIA) }, (_, k) => emOrdem.slice(k * POR_BAIA, (k + 1) * POR_BAIA));
  return baias.length ? baias : [[]];
}

export function useEscuro() {
  const [escuro, setEscuro] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observador = new MutationObserver(() => setEscuro(document.documentElement.classList.contains("dark")));
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observador.disconnect();
  }, []);
  return escuro;
}

function cursor(valor: string) {
  document.body.style.cursor = valor;
}

/* ───────── Rótulos em HTML ───────── */

function CartaoPessoa({ c }: { c: ConversaCentral }) {
  const conversando = estadoMesa(c) === "conversando";
  return (
    <div className="w-60 -translate-y-2 rounded-xl border border-border bg-card/95 px-3 py-2 text-left shadow-xl backdrop-blur">
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: conversando ? VERDE : AMBAR }} />
        <span className="truncate text-xs font-semibold text-foreground">{c.nome || "Servidor sem nome"}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{c.origem}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{c.ultima_mensagem || "—"}</p>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        {conversando ? "conversando agora" : "esperando o servidor"} · clique para abrir
      </p>
    </div>
  );
}

/** Etiqueta que acompanha o agente: o nome com o ponto na cor dele; em foco, também o cargo. */
function EtiquetaIA({ nome, cargo, cor, fila, ativo, aoClicar }: { nome: string; cargo?: string; cor: string; fila: number; ativo: boolean; aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      title={cargo ? `${nome} · ${cargo}` : nome}
      className={cn(
        "flex items-center gap-1.5 rounded-full border bg-card/90 py-0.5 pr-2.5 pl-1 text-[11px] whitespace-nowrap text-foreground shadow-md backdrop-blur transition-all hover:scale-105",
        ativo && "py-1 pr-3 shadow-lg",
      )}
      style={{ borderColor: ativo ? cor : `${cor}66`, boxShadow: ativo ? `0 0 0 3px ${cor}33` : undefined }}
    >
      <span className="grid size-4 place-items-center rounded-full ring-2 ring-white/70" style={{ background: cor }}>
        <span className="size-1.5 rounded-full bg-white" />
      </span>
      <span className="font-semibold">{nome}</span>
      {ativo && cargo && <span className="text-[10px] text-muted-foreground">{cargo}</span>}
      {fila > 0 && <span className="rounded-full bg-muted px-1 font-mono text-[9px] text-muted-foreground">+{fila}</span>}
    </button>
  );
}

/** Placa do setor, no piso da sala: ícone na cor do setor e o nome. Clicar abre o painel dele. */
function PlacaSetor({ id, ativo, aoClicar }: { id: SetorId; ativo: boolean; aoClicar: () => void }) {
  const { nome, cor } = SETORES[id];
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={cn(
        "flex items-center gap-1.5 rounded-xl border bg-card/80 py-1 pr-2.5 pl-1 text-[11px] font-semibold whitespace-nowrap text-foreground shadow-md backdrop-blur-md transition-all hover:scale-105 hover:bg-card",
        ativo && "bg-card",
      )}
      style={{ borderColor: ativo ? cor : "transparent", boxShadow: ativo ? `0 0 0 3px ${cor}33, 0 8px 20px -6px ${cor}88` : undefined }}
    >
      <span className="grid size-5 place-items-center rounded-lg text-white [&_svg]:size-3" style={{ background: cor }}>
        {ICONE_SETOR[id]}
      </span>
      {nome}
    </button>
  );
}

/* ───────── Pisos clicáveis ───────── */

/** Piso de uma área (retângulo), realçado quando selecionado e ao passar o mouse. */
export function PisoClicavel({ ret, cor, ativo, aoClicar, opacidade = 0.12 }: { ret: Retangulo; cor: string; ativo: boolean; aoClicar?: () => void; opacidade?: number }) {
  const [sobre, setSobre] = useState(false);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    if (material.current) material.current.opacity = THREE.MathUtils.damp(material.current.opacity, ativo ? 0.32 : sobre ? 0.22 : opacidade, 8, dt);
  });
  const eventos = aoClicar && {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      aoClicar();
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setSobre(true);
      cursor("pointer");
    },
    onPointerOut: () => {
      setSobre(false);
      cursor("");
    },
  };
  return (
    <mesh position={[(ret.x0 + ret.x1) / 2, 0.012, (ret.z0 + ret.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow {...eventos}>
      <planeGeometry args={[ret.x1 - ret.x0 - 0.2, ret.z1 - ret.z0 - 0.2]} />
      <meshStandardMaterial ref={material} color={cor} transparent opacity={opacidade} />
    </mesh>
  );
}

/* ───────── Salas ───────── */

/** Vidro ao longo de uma reta, com uma abertura de porta opcional no meio (em `porta`, na mesma reta). */
function ParedeVidro({ p, de, ate, porta, cor }: { p: Paleta; de: [number, number]; ate: [number, number]; porta?: number; cor?: string }) {
  const [ax, az] = de;
  const [bx, bz] = ate;
  const comprimento = Math.hypot(bx - ax, bz - az);
  const angulo = -Math.atan2(bz - az, bx - ax);
  const trechos: [number, number][] = porta == null ? [[0, comprimento]] : [[0, porta - PORTA / 2], [porta + PORTA / 2, comprimento]];
  return (
    <group position={[ax, 0, az]} rotation={[0, angulo, 0]}>
      {trechos
        .filter(([i, f]) => f - i > 0.1)
        .map(([i, f]) => (
          <group key={i} position={[(i + f) / 2, 0, 0]}>
            <DivisoriaVidro p={p} comprimento={f - i} altura={2.6} />
            {cor && (
              <mesh position={[0, 0.012, 0]}>
                <boxGeometry args={[f - i, 0.024, 0.09]} />
                <meshStandardMaterial color={cor} emissive={cor} emissiveIntensity={1.6} toneMapped={false} />
              </mesh>
            )}
          </group>
        ))}
    </group>
  );
}

/** Os móveis de cada setor, encostados na parede de fora, de frente para o ponto de busca. */
function MoveisDaSala({ sala, p, transferidasAguardando }: { sala: Sala; p: Paleta; transferidasAguardando: number }) {
  const { ret } = sala;
  const cx = (ret.x0 + ret.x1) / 2;
  const cz = (ret.z0 + ret.z1) / 2;
  // Encostado na parede de fora, de frente para dentro da sala.
  const naParede = (deslocamento: number, afastar = 0.45): { posicao: [number, number, number]; giro: number } =>
    sala.lado === "fundo"
      ? { posicao: [cx + deslocamento, 0, ret.z0 + afastar], giro: 0 }
      : sala.lado === "esquerda"
        ? { posicao: [ret.x0 + afastar, 0, sala.porta.z + deslocamento], giro: Math.PI / 2 }
        : { posicao: [ret.x1 - afastar, 0, sala.porta.z + deslocamento], giro: -Math.PI / 2 };
  const colocar = (deslocamento: number, filho: ReactNode, afastar?: number, chave?: string | number) => {
    const { posicao, giro } = naParede(deslocamento, afastar);
    return (
      <group key={chave ?? deslocamento} position={posicao} rotation={[0, giro, 0]}>
        {filho}
      </group>
    );
  };
  switch (sala.id) {
    case "secretaria":
      return (
        <group>
          {[-1.4, -0.7, 0].map((d) => colocar(d, <Arquivo />, 0.4))}
          {colocar(1.3, <Rack />, 0.45)}
        </group>
      );
    case "fontes":
      return (
        <group>
          {colocar(-1.1, <Estante p={p} largura={1.9} />, 0.3)}
          {colocar(1.15, <group position={[0, 1.55, 0]} scale={0.85}><TvAula /></group>, 0.1)}
        </group>
      );
    case "base":
      return (
        <group>
          {colocar(-0.5, <group position={[0, 1.55, 0]}><Lousa /></group>, 0.12)}
          {colocar(1.55, <Estante p={p} largura={1.1} />, 0.3)}
          <Planta p={p} posicao={[ret.x0 + 0.7, 0, ret.z1 - 0.8]} escala={0.8} />
        </group>
      );
    case "catalogo":
      return (
        <group>
          {colocar(0, <Cofre />, 0.55)}
          {[-2.6, -5.4].map((d, i) => (
            <group key={d} position={[cx, 0, sala.porta.z + d]} rotation={[0, Math.PI / 2, 0]}>
              <Estacao p={p} ocupada cor="#10b981" detalhe={i + 1} />
              <group position={[0, 0, -0.95]}>
                <Cadeira p={p} />
              </group>
            </group>
          ))}
        </group>
      );
    case "equipe": {
      // Baia de 6 (3 de frente para 3, como as dos agentes), girada para correr ao longo da sala. Atendem
      // (digitam) tantos quantas são as transferências esperando a equipe, até 6.
      const atendendo = Math.min(transferidasAguardando, LUGARES_EQUIPE.length);
      return (
        <group>
          <group position={[ret.x0 + EQUIPE_PASTAS_X, 0, sala.porta.z - EQUIPE_PASTAS_Z]}>
            <CaixaDePastas quantidade={transferidasAguardando} />
          </group>
          <group position={[ret.x0 + EQUIPE_BAIA_X, 0, cz - 0.4]} rotation={[0, Math.PI / 2, 0]}>
            {LUGARES_EQUIPE.map((lugar, i) => (
              <group key={i}>
                <group position={[lugar.x, 0, lugar.mesaZ]} rotation={[0, lugar.giro, 0]}>
                  <Estacao p={p} ocupada cor={AMARELO} detalhe={i} />
                </group>
                <group position={[lugar.x, 0, lugar.cadeiraZ]} rotation={[0, lugar.giro, 0]}>
                  <Cadeira p={p} />
                  <AtendenteHumano visual={i} atendendo={i < atendendo} />
                </group>
              </group>
            ))}
          </group>
        </group>
      );
    }
    case "recepcao":
      return (
        <group>
          {colocar(0, <Balcao />, 1.6)}
          {colocar(2.6, <Sofa cor="#334155" />, 0.6)}
          <Planta p={p} posicao={[ret.x0 + 0.8, 0, ret.z1 - 0.8]} escala={1} />
        </group>
      );
    case "implantacao":
      // Bancada de embalagem de frente para a porta (onde o agente consulta), estantes de aço na parede de
      // fora e na do fundo, o palete pronto para a postagem e o carrinho.
      return (
        <group>
          {colocar(0, <BancadaExpedicao p={p} />, 0.55)}
          {colocar(-3.6, <EstanteAco cor={SETORES.implantacao.cor} />, 0.35)}
          {[-1, 1.6].map((d) => (
            <group key={d} position={[cx + d, 0, ret.z0 + 0.35]}>
              <EstanteAco cor={SETORES.implantacao.cor} />
            </group>
          ))}
          <group position={[cx + 1.3, 0, ret.z0 + 3.3]} rotation={[0, 0.12, 0]}>
            <Palete />
          </group>
          <group position={[cx + 2.6, 0, ret.z0 + 2.4]} rotation={[0, -0.6, 0]}>
            <CarrinhoDeCarga />
          </group>
        </group>
      );
    case "copa":
      return (
        <group>
          {colocar(0.4, <Copa />, 0.4)}
          <group position={[cx + 0.6, 0, cz]} scale={0.9}>
            <SalaReuniao p={p} />
          </group>
        </group>
      );
  }
}

/** Uma sala: piso clicável, vidro com a porta para o corredor e os móveis. */
function SalaDoSetor({
  sala,
  p,
  ativa,
  aoSelecionar,
  transferidasAguardando,
}: {
  sala: Sala;
  p: Paleta;
  ativa: boolean;
  aoSelecionar: (s: Selecao) => void;
  transferidasAguardando: number;
}) {
  const { ret } = sala;
  const cor = sala.id === "copa" ? "#94a3b8" : SETORES[sala.id].cor;
  const aoClicar = sala.id === "copa" ? undefined : () => aoSelecionar({ tipo: "setor", id: sala.id as SetorId });
  // A parede com a porta (para o corredor) e as paredes que separam das salas vizinhas.
  const paredes: ReactNode[] = [];
  if (sala.lado === "fundo") {
    paredes.push(<ParedeVidro key="porta" p={p} cor={cor} de={[ret.x0, ret.z1]} ate={[ret.x1, ret.z1]} porta={sala.porta.x - ret.x0} />);
    paredes.push(<ParedeVidro key="lado" p={p} cor={cor} de={[ret.x1, ret.z0]} ate={[ret.x1, ret.z1]} />);
  } else {
    const xPorta = sala.lado === "esquerda" ? ret.x1 : ret.x0;
    paredes.push(<ParedeVidro key="porta" p={p} cor={cor} de={[xPorta, ret.z0]} ate={[xPorta, ret.z1]} porta={sala.porta.z - ret.z0} />);
    if (ret.z0 < 0 && ret.z1 <= 0.01) paredes.push(<ParedeVidro key="meio" p={p} cor={cor} de={[ret.x0, ret.z1]} ate={[ret.x1, ret.z1]} />);
  }
  return (
    <group>
      <PisoClicavel ret={ret} cor={cor} ativo={ativa} aoClicar={aoClicar} opacidade={0.1} />
      {paredes}
      <Suspense fallback={null}>
        <MoveisDaSala sala={sala} p={p} transferidasAguardando={transferidasAguardando} />
      </Suspense>
    </group>
  );
}

/* ───────── Baia de atendimento ───────── */

/** Mesa de uma baia: estação e cadeira, no lugar e na direção certos (o agente anda por conta própria). */
function MesaDaBaia({ p, lugar, ocupada, cor, detalhe }: { p: Paleta; lugar: (typeof LUGARES)[number]; ocupada: boolean; cor: string; detalhe: number }) {
  return (
    <>
      <group position={[lugar.x, 0, lugar.mesaZ]} rotation={[0, lugar.giro, 0]}>
        <Estacao p={p} ocupada={ocupada} cor={cor} detalhe={detalhe} />
      </group>
      <group position={[lugar.x, 0, lugar.cadeiraZ]} rotation={[0, lugar.giro, 0]}>
        <Cadeira p={p} />
      </group>
    </>
  );
}

/** A baia: 12 mesas em 2 blocos e os balões das conversas sobre a mesa de cada agente. */
function BaiaAgentes({
  agentes,
  corDe,
  p,
  selecao,
  aoSelecionar,
  emFoco,
  aoPassar,
}: {
  agentes: AgenteCentral[];
  corDe: (id: string) => string;
  p: Paleta;
  selecao: Selecao;
  aoSelecionar: (s: Selecao) => void;
  emFoco: string | null;
  aoPassar: (id: string | null) => void;
}) {
  return (
    <group>
      {LUGARES.map((lugar, s) => {
        const agente = agentes[s];
        if (!agente) return <MesaDaBaia key={s} p={p} lugar={lugar} ocupada={false} cor={AZUL} detalhe={s} />;
        const { baloes } = empilhar(agente.conversas);
        return (
          <group key={agente.id}>
            <MesaDaBaia p={p} lugar={lugar} ocupada cor={corDe(agente.id)} detalhe={s} />
            {baloes.map((c, k) => (
              <Balao
                key={c.id}
                c={c}
                posicao={[lugar.x, BALAO_Y + k * BALAO_PASSO, lugar.cadeiraZ]}
                destacado={(selecao?.tipo === "conversa" && selecao.id === c.id) || emFoco === c.id}
                aoClicar={() => aoSelecionar({ tipo: "conversa", id: c.id })}
                aoPassar={(dentro) => aoPassar(dentro ? c.id : null)}
              />
            ))}
          </group>
        );
      })}
      {Z_BLOCOS.map((z) => (
        <group key={z} position={[0, 0, z]}>
          <Luminaria p={p} comprimento={8} />
        </group>
      ))}
    </group>
  );
}

/** Uma conversa ativa: balão virado para a câmera, flutuando sobre a mesa do agente que a atende. */
function Balao({
  c,
  posicao,
  destacado,
  aoClicar,
  aoPassar,
}: {
  c: ConversaCentral;
  posicao: [number, number, number];
  destacado: boolean;
  aoClicar: () => void;
  aoPassar: (dentro: boolean) => void;
}) {
  const grupo = useRef<THREE.Group>(null);
  const pontos = useRef<THREE.Group>(null);
  const escala = useRef(0.01);
  const fase = (hash(c.id) % 100) / 15;
  const conversando = estadoMesa(c) === "conversando";
  const corEstado = conversando ? VERDE : AMBAR;
  useFrame(({ clock }, dt) => {
    if (!grupo.current) return;
    const t = clock.elapsedTime + fase;
    escala.current = THREE.MathUtils.damp(escala.current, destacado ? 1.25 : 1, 6, dt);
    grupo.current.scale.setScalar(escala.current);
    grupo.current.position.y = posicao[1] + Math.sin(t * 1.4) * 0.04;
    pontos.current?.children.forEach((ponto, i) => {
      ponto.position.y = conversando ? Math.max(0, Math.sin(t * 6 - i * 0.7)) * 0.06 : 0;
    });
  });
  return (
    <group
      ref={grupo}
      position={posicao}
      rotation={[0, Math.PI / 4, 0]}
      onClick={(e) => {
        e.stopPropagation();
        aoClicar();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        cursor("pointer");
        aoPassar(true);
      }}
      onPointerOut={() => {
        cursor("");
        aoPassar(false);
      }}
    >
      <RoundedBox args={[0.72, 0.46, 0.04]} radius={0.12} position={[0, 0, -0.025]}>
        <meshStandardMaterial color={corEstado} emissive={corEstado} emissiveIntensity={destacado ? 1 : 0.55} />
      </RoundedBox>
      <RoundedBox args={[0.65, 0.39, 0.06]} radius={0.1}>
        <meshStandardMaterial color="#f8fafc" roughness={0.4} />
      </RoundedBox>
      <mesh position={[-0.17, -0.25, 0]} rotation={[0, 0, Math.PI * 0.8]}>
        <coneGeometry args={[0.07, 0.13, 3]} />
        <meshStandardMaterial color={corEstado} emissive={corEstado} emissiveIntensity={0.55} />
      </mesh>
      <group ref={pontos} position={[0, 0, 0.04]}>
        {[-0.14, 0, 0.14].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <sphereGeometry args={[0.042, 12, 10]} />
            <meshStandardMaterial color={conversando ? corEstado : "#94a3b8"} emissive={conversando ? corEstado : "#000000"} emissiveIntensity={0.5} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ───────── O agente que anda ───────── */

interface Tarefa {
  setor: SetorId;
  levando: boolean;
}

interface ControleAgente {
  enfileirar: (t: Tarefa) => void;
  /** Muda a expressão do rosto por alguns segundos. */
  reagir: (humor: Humor, segundos: number) => void;
}

/** O agente: sentado na mesa e, quando recebe uma tarefa, a ida ao setor, a busca e a volta. */
function AgenteMovel({
  agente,
  cor,
  cadeira,
  giro,
  planta,
  ocupado,
  destacado,
  aoClicar,
  controles,
  posicoes,
  alturaNaMesa,
}: {
  agente: AgenteCentral;
  cor: string;
  cadeira: THREE.Vector3;
  giro: number;
  planta: Planta;
  ocupado: boolean;
  destacado: boolean;
  aoClicar: () => void;
  controles: MutableRefObject<Record<string, ControleAgente>>;
  posicoes: MutableRefObject<Record<string, THREE.Vector3>>;
  alturaNaMesa: number;
}) {
  const grupo = useRef<THREE.Group>(null);
  const postura = useRef<PosturaAgente>({ emPe: 0, andando: false, buscando: false, levando: false, passo: 0 });
  const fila = useRef<Tarefa[]>([]);
  const reacao = useRef<{ humor: Humor; ate: number } | null>(null);
  const atual = useRef<{ caminho: THREE.Vector3[]; i: number; fase: "levantar" | "ida" | "busca" | "volta" | "sentar"; espera: number; tarefa: Tarefa; olhar: number } | null>(null);
  const rotulo = useMemo(() => cadeira.clone().setY(alturaNaMesa), [cadeira, alturaNaMesa]);
  posicoes.current[agente.id] = rotulo;

  // A posição é só do useFrame: como propriedade do grupo, cada render (a Central atualiza a cada poucos
  // segundos) a reaplicava e devolvia à mesa quem estava a caminho. Aqui, só a posição inicial e a troca de
  // mesa com o agente sentado.
  useLayoutEffect(() => {
    const g = grupo.current;
    if (!g || atual.current) return;
    g.position.copy(cadeira);
    g.rotation.y = giro;
  }, [cadeira, giro]);

  useEffect(() => {
    controles.current[agente.id] = {
      enfileirar: (t) => {
        // No máximo 3 idas na fila, sem repetir a mesma em seguida.
        const ultima = fila.current.at(-1) ?? atual.current?.tarefa;
        if (fila.current.length >= 3 || (ultima && ultima.setor === t.setor && ultima.levando === t.levando)) return;
        fila.current.push(t);
      },
      reagir: (humor, segundos) => {
        reacao.current = { humor, ate: performance.now() + segundos * 1000 };
      },
    };
    return () => {
      delete controles.current[agente.id];
    };
  }, [agente.id, controles]);

  useFrame((_, dt) => {
    const g = grupo.current;
    if (!g) return;
    const p = postura.current;
    let a = atual.current;
    if (!a && fila.current.length) {
      const tarefa = fila.current.shift()!;
      const sala = planta.salas.find((s) => s.id === tarefa.setor);
      if (sala) {
        a = atual.current = { caminho: rota(planta, cadeira, sala), i: 1, fase: "levantar", espera: 0.35, tarefa, olhar: sala.olhar };
        p.levando = tarefa.levando;
      }
    }
    if (!a) {
      // Na mesa: sentado, de frente para ela.
      g.position.copy(cadeira);
      g.rotation.y = giro;
      p.emPe = 0;
      p.andando = p.buscando = false;
      rotulo.set(cadeira.x, alturaNaMesa, cadeira.z);
      return;
    }
    const andar = () => {
      const alvo = a!.caminho[a!.i];
      const falta = alvo.clone().sub(g.position);
      const distancia = falta.length();
      const passo = VELOCIDADE * dt;
      if (distancia <= passo) {
        g.position.copy(alvo);
        a!.i += 1;
        return a!.i >= a!.caminho.length;
      }
      g.position.addScaledVector(falta.normalize(), passo);
      p.passo += passo * 4.2;
      const angulo = Math.atan2(falta.x, falta.z);
      let delta = angulo - g.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      g.rotation.y += delta * Math.min(1, dt * 10);
      return false;
    };
    switch (a.fase) {
      case "levantar":
        p.emPe = 1;
        a.espera -= dt;
        if (a.espera <= 0) a.fase = "ida";
        break;
      case "ida":
        p.andando = true;
        if (andar()) {
          a.fase = "busca";
          a.espera = a.tarefa.levando ? 1.4 : 2.6;
          p.andando = false;
          p.buscando = !a.tarefa.levando;
        }
        break;
      case "busca": {
        let delta = a.olhar - g.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        g.rotation.y += delta * Math.min(1, dt * 6);
        a.espera -= dt;
        if (a.espera < 0.6) p.levando = false; // entregou a pasta
        if (a.espera <= 0) {
          a.fase = "volta";
          a.caminho = [...a.caminho].reverse();
          a.i = 1;
          p.buscando = false;
        }
        break;
      }
      case "volta":
        p.andando = true;
        if (andar()) {
          a.fase = "sentar";
          a.espera = 0.4;
          p.andando = false;
        }
        break;
      case "sentar": {
        let delta = giro - g.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        g.rotation.y += delta * Math.min(1, dt * 8);
        p.emPe = 0;
        a.espera -= dt;
        if (a.espera <= 0) atual.current = null;
        break;
      }
    }
    rotulo.set(g.position.x, a ? 2.35 : alturaNaMesa, g.position.z);
  });

  return (
    <group ref={grupo}>
      <RoboAgente cor={cor} ocupado={ocupado} destacado={destacado} aoClicar={aoClicar} postura={postura} reacao={reacao} />
    </group>
  );
}

/** A expressão do robô diante de cada acontecimento ao vivo, e por quantos segundos. */
const REACOES: Partial<Record<EventoCentral["tipo"], [Humor, number]>> = {
  pensando: ["pensando", 6],
  respondeu: ["feliz", 2],
  encerrou: ["feliz", 6],
  erro: ["alerta", 8],
  guardrail: ["alerta", 8],
};

/* ───────── Envelopes entre a recepção e a mesa ───────── */

interface Voo {
  id: number;
  de: THREE.Vector3;
  para: THREE.Vector3;
  cor: string;
}

function Envelope({ voo, aoChegar }: { voo: Voo; aoChegar: () => void }) {
  const grupo = useRef<THREE.Group>(null);
  const t = useRef(0);
  const meio = useMemo(() => voo.de.clone().lerp(voo.para, 0.5).setY(Math.max(voo.de.y, voo.para.y) + 2.2), [voo]);
  useFrame((_, dt) => {
    t.current += dt / 1.5;
    const g = grupo.current;
    if (!g) return;
    if (t.current >= 1) {
      aoChegar();
      return;
    }
    const u = t.current;
    // Curva de Bézier quadrática, subindo no meio do caminho.
    g.position.set(0, 0, 0).addScaledVector(voo.de, (1 - u) * (1 - u)).addScaledVector(meio, 2 * (1 - u) * u).addScaledVector(voo.para, u * u);
    g.rotation.y = Math.PI / 4;
    g.scale.setScalar(Math.sin(u * Math.PI) * 0.4 + 0.75);
  });
  return (
    <group ref={grupo} position={voo.de}>
      <mesh>
        <boxGeometry args={[0.42, 0.28, 0.03]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0, 0.03, 0.02]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.21, 0.21, 0.005]} />
        <meshStandardMaterial color={voo.cor} emissive={voo.cor} emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

/* ───────── Câmera ───────── */

export type Alvo = { centro: THREE.Vector3; largura: number; profundidade: number; altura: number };

// Câmera isométrica: direção fixa; "direita da tela" no mundo, para deslocar o enquadramento.
const DIRECAO = new THREE.Vector3(1, 0.92, 1).normalize();
const DIREITA_TELA = new THREE.Vector3(1, 0, -1).normalize();
const DISTANCIA = 60;
const ELEVACAO = Math.asin(DIRECAO.y);

export function ControleCamera({ geral, foco, margemDireita, api }: { geral: Alvo; foco: Alvo | null; margemDireita: number; api: MutableRefObject<ApiCamera | null> }) {
  const controles = useRef<Controles>(null);
  const { camera, size } = useThree();
  const voo = useRef<{ alvo: THREE.Vector3; zoom: number } | null>(null);

  /** Zoom e ponto de mira que enquadram a área na parte livre da tela (fora do painel da direita). */
  const enquadrar = (a: Alvo, aproximacao = 1) => {
    const largura = Math.max(200, size.width - margemDireita - 96);
    const altura = Math.max(200, size.height - 200);
    const diagonal = (a.largura + a.profundidade) * Math.SQRT1_2;
    const zoom = THREE.MathUtils.clamp(
      Math.min(largura / diagonal, altura / (diagonal * Math.sin(ELEVACAO) + a.altura * Math.cos(ELEVACAO))) * aproximacao,
      6,
      140,
    );
    const alvo = a.centro.clone().addScaledVector(DIREITA_TELA, margemDireita / 2 / zoom);
    alvo.y += 30 / zoom;
    return { alvo, zoom };
  };

  const posicionar = (alvo: THREE.Vector3, zoom: number) => {
    camera.position.copy(alvo).addScaledVector(DIRECAO, DISTANCIA);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    controles.current?.target.copy(alvo);
    controles.current?.update();
  };

  useEffect(() => {
    const { alvo, zoom } = enquadrar(geral);
    posicionar(alvo, zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, margemDireita]);

  // Trocar a vista geral (prédio fechado ↔ escritório aberto) voa até ela em vez de pular.
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    voo.current = foco ? enquadrar(foco, 0.92) : enquadrar(geral);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geral.largura, geral.profundidade, geral.centro.y]);

  useEffect(() => {
    voo.current = foco ? enquadrar(foco, 0.92) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco?.centro.x, foco?.centro.z, foco?.largura]);

  useFrame((_, dt) => {
    const c = controles.current;
    if (!voo.current || !c) return;
    const { alvo, zoom } = voo.current;
    const deslocamento = camera.position.clone().sub(c.target);
    c.target.x = THREE.MathUtils.damp(c.target.x, alvo.x, 4, dt);
    c.target.y = THREE.MathUtils.damp(c.target.y, alvo.y, 4, dt);
    c.target.z = THREE.MathUtils.damp(c.target.z, alvo.z, 4, dt);
    camera.position.copy(c.target).add(deslocamento);
    camera.zoom = THREE.MathUtils.damp(camera.zoom, zoom, 4, dt);
    camera.updateProjectionMatrix();
    c.update();
    if (c.target.distanceTo(alvo) < 0.02 && Math.abs(camera.zoom - zoom) < 0.2) voo.current = null;
  });

  useEffect(() => {
    api.current = {
      aproximar: (fator) => {
        voo.current = null;
        camera.zoom = THREE.MathUtils.clamp(camera.zoom * fator, 6, 140);
        camera.updateProjectionMatrix();
      },
      centralizar: () => {
        voo.current = enquadrar(geral);
      },
    };
  });

  return (
    <OrbitControls
      ref={controles}
      makeDefault
      enableDamping
      minZoom={6}
      maxZoom={140}
      minPolarAngle={0.55}
      maxPolarAngle={1.15}
      minAzimuthAngle={Math.PI / 4 - 0.7}
      maxAzimuthAngle={Math.PI / 4 + 0.7}
      screenSpacePanning
      zoomToCursor
      // Arrastar com o botão esquerdo (ou um dedo) move o escritório; o direito gira a vista.
      mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      onStart={() => {
        voo.current = null; // quem mexe na câmera assume o controle
      }}
    />
  );
}

/* ───────── Cena ───────── */

export default function Escritorio({
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
  agentes: AgenteCentral[];
  /** Os acontecimentos ao vivo (feed + conexão aberta). */
  eventos: EventoCentral[];
  /** Último id que já existia ao abrir a tela: só o que vem depois vira animação. */
  inicio: number | null;
  selecao: Selecao;
  aoSelecionar: (s: Selecao) => void;
  /** Largura (px) coberta pelo painel da direita: o enquadramento desconta essa faixa. */
  margemDireita: number;
  api: MutableRefObject<ApiCamera | null>;
  /** O prédio aberto mostra o escritório; fechado, é a vista de fora. Quem usa decide (barra de botões). */
  aberto: boolean;
  aoAbrir: () => void;
}) {
  const escuro = useEscuro();
  const p = escuro ? PALETAS.escuro : PALETAS.claro;

  const grupos = useMemo(() => montarBaias(agentes), [agentes]);
  // As mesas só mudam quando entra ou sai um agente, quando a ordem muda ou quando a cor de algum muda (na
  // fábrica). Os dados da Central chegam de novo a cada poucos segundos: recriar as cadeiras a cada vez
  // devolvia à mesa quem estava a caminho de um setor.
  const coresDosAgentes = agentes.map((a) => `${a.id}:${a.cor ?? ""}`).join();
  const ordemDasMesas = grupos.map((b) => b.map((a) => a.id).join(",")).join("|");
  const baias = grupos.length;
  const planta = useMemo(() => montarPlanta(baias), [baias]);
  const x = (i: number) => planta.bx0 + LARGURA_BAIA / 2 + i * (LARGURA_BAIA + ENTRE_BAIAS);
  const lugarDe = useMemo(() => {
    const mapa = new Map<string, { cadeira: THREE.Vector3; giro: number; cor: string }>();
    grupos.forEach((b, baia) =>
      b.forEach((a, mesa) => {
        const l = LUGARES[mesa];
        mapa.set(a.id, { cadeira: new THREE.Vector3(x(baia) + l.x, 0, l.cadeiraZ), giro: l.giro, cor: tripulante(a.id, agentes).cor });
      }),
    );
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordemDasMesas, coresDosAgentes, planta]);
  const transferidasAguardando = useMemo(
    () => agentes.reduce((n, a) => n + a.conversas.filter((c) => c.status === "transferido" && (c.parada_ha_s ?? 0) >= 15 * 60).length, 0),
    [agentes],
  );

  const largura = planta.xDir1 - planta.xEsq0;
  const profundidade = planta.zFrente + 1 - planta.zFundo0;
  const centro = new THREE.Vector3((planta.xEsq0 + planta.xDir1) / 2, 0, (planta.zFundo0 + planta.zFrente + 1) / 2);
  const predio = useMemo(
    () => ({ x0: centro.x - (largura + 1) / 2, x1: centro.x + (largura + 1) / 2, z0: centro.z - profundidade / 2, z1: centro.z + profundidade / 2 }),
    [largura, profundidade], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Aberto, a vista geral enquadra o escritório; fechado, o prédio inteiro com a rua em volta.
  const geral = useMemo<Alvo>(() => {
    if (aberto) return { centro: centro.clone().add(new THREE.Vector3(1, 0, 1)), largura: largura + 3, profundidade: profundidade + 3, altura: 2.4 };
    const q = limitesDoQuarteirao(predio);
    return {
      centro: new THREE.Vector3((q.x0 + q.x1) / 2 + 2, -ANDAR / 2, (q.z0 + q.z1) / 2 + 2),
      largura: q.x1 - q.x0 - 20,
      profundidade: q.z1 - q.z0 - 20,
      altura: ANDAR + PE_DIREITO + 2,
    };
  }, [largura, profundidade, aberto, predio]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Tarefas e envelopes a partir dos acontecimentos ao vivo */
  const controles = useRef<Record<string, ControleAgente>>({});
  const posicoes = useRef<Record<string, THREE.Vector3>>({});
  const visto = useRef(0);
  const [voos, setVoos] = useState<Voo[]>([]);
  const recepcao = planta.salas.find((s) => s.id === "recepcao")!;
  const balcao = useMemo(() => recepcao.busca.clone().setY(1.3), [recepcao]);
  useEffect(() => {
    if (inicio == null) return;
    const novos = eventos.filter((e) => e.id > Math.max(visto.current, inicio));
    if (!novos.length) return;
    visto.current = Math.max(visto.current, ...novos.map((e) => e.id));
    const envelopes: Voo[] = [];
    for (const e of novos) {
      const lugar = lugarDe.get(e.agente);
      const reacao = REACOES[e.tipo];
      if (reacao) controles.current[e.agente]?.reagir(...reacao);
      if (e.tipo === "ferramenta" && e.ferramenta) {
        const setor = setorDaFerramenta(e.ferramenta, e.agente);
        if (setor) controles.current[e.agente]?.enfileirar({ setor, levando: setor === "equipe" });
      } else if (lugar && (e.tipo === "mensagem" || e.tipo === "respondeu")) {
        const mesa = lugar.cadeira.clone().setY(1.6);
        envelopes.push({ id: e.id, de: e.tipo === "mensagem" ? balcao : mesa, para: e.tipo === "mensagem" ? mesa : balcao, cor: e.tipo === "mensagem" ? VERDE : lugar.cor });
      }
    }
    if (envelopes.length) setVoos((v) => [...v, ...envelopes].slice(-12));
  }, [eventos, inicio, lugarDe, balcao]);

  /* Balões, foco e rótulos */
  const atendentes = useMemo(() => {
    const mapa = new Map<string, { posicao: THREE.Vector3; conversa: ConversaCentral }>();
    agentes.forEach((agente) => {
      const lugar = lugarDe.get(agente.id);
      if (!lugar) return;
      empilhar(agente.conversas).baloes.forEach((c, k) => {
        mapa.set(c.id, { posicao: new THREE.Vector3(lugar.cadeira.x, BALAO_Y + k * BALAO_PASSO, lugar.cadeira.z), conversa: c });
      });
    });
    return mapa;
  }, [agentes, lugarDe]);

  const [emFoco, setEmFoco] = useState<string | null>(null);

  const foco = useMemo<Alvo | null>(() => {
    if (!selecao) return null;
    if (selecao.tipo === "setor") {
      if (selecao.id === "atendimento")
        return { centro: new THREE.Vector3(0, 0, 0), largura: planta.larguraBaias + 1, profundidade: PROFUNDIDADE, altura: 2.4 };
      const sala = planta.salas.find((s) => s.id === selecao.id);
      if (!sala) return null;
      const { ret } = sala;
      return { centro: new THREE.Vector3((ret.x0 + ret.x1) / 2, 0, (ret.z0 + ret.z1) / 2), largura: ret.x1 - ret.x0 + 1, profundidade: ret.z1 - ret.z0 + 1, altura: 2.6 };
    }
    if (selecao.tipo === "agente") {
      const lugar = lugarDe.get(selecao.id);
      return lugar ? { centro: lugar.cadeira.clone().setY(1.4), largura: 5, profundidade: 4, altura: 3 } : null;
    }
    const atendente = atendentes.get(selecao.id);
    return atendente ? { centro: atendente.posicao.clone().setY(1.6), largura: 5, profundidade: 4, altura: 3 } : null;
  }, [selecao, atendentes, lugarDe, planta]);

  const rotulos: Rotulo[] = [];
  if (aberto) agentes.forEach((agente) => {
    const { fila } = empilhar(agente.conversas);
    const posicao = posicoes.current[agente.id];
    if (!posicao) return;
    rotulos.push({
      id: `ia-${agente.id}`,
      posicao,
      conteudo: (
        <EtiquetaIA
          nome={agente.nome}
          cargo={agente.cargo}
          cor={lugarDe.get(agente.id)?.cor ?? AZUL}
          fila={fila}
          ativo={selecao?.tipo === "agente" && selecao.id === agente.id}
          aoClicar={() => aoSelecionar({ tipo: "agente", id: agente.id })}
        />
      ),
    });
  });
  for (const sala of aberto ? planta.salas : []) {
    if (sala.id === "copa") continue;
    const id = sala.id;
    rotulos.push({
      id: `setor-${id}`,
      posicao: new THREE.Vector3((sala.ret.x0 + sala.ret.x1) / 2, 0.1, (sala.ret.z0 + sala.ret.z1) / 2),
      conteudo: <PlacaSetor id={id} ativo={selecao?.tipo === "setor" && selecao.id === id} aoClicar={() => aoSelecionar({ tipo: "setor", id })} />,
    });
  }
  if (aberto) rotulos.push({
    id: "setor-atendimento",
    posicao: new THREE.Vector3(0, 0.2, planta.bz1 + 0.9),
    conteudo: (
      <PlacaSetor id="atendimento" ativo={selecao?.tipo === "setor" && selecao.id === "atendimento"} aoClicar={() => aoSelecionar({ tipo: "setor", id: "atendimento" })} />
    ),
  });
  const sobMouse = emFoco ? atendentes.get(emFoco) : undefined;
  if (sobMouse && !(selecao?.tipo === "conversa" && selecao.id === emFoco)) {
    rotulos.push({ id: "cartao", posicao: sobMouse.posicao.clone().setY(sobMouse.posicao.y + 0.75), conteudo: <CartaoPessoa c={sobMouse.conversa} />, passivo: true });
  }
  const elementos = useRef<Record<string, HTMLDivElement | null>>({});
  // Os rótulos dos agentes dependem das posições registradas no primeiro desenho: um segundo desenho os mostra.
  const [, setPronto] = useState(false);
  useEffect(() => setPronto(true), []);

  const larguraPiso = largura + 1;
  return (
    <div className="relative h-full w-full">
      <Canvas
        orthographic
        shadows
        flat
        dpr={[1, 2]}
        camera={{ position: DIRECAO.clone().multiplyScalar(DISTANCIA).toArray(), zoom: 20, near: -200, far: 400 }}
        onPointerMissed={() => aoSelecionar(null)}
      >
        <ambientLight intensity={p.luzAmbiente} />
        <hemisphereLight args={[p.ceu, p.chao, 0.6]} />
        <directionalLight castShadow position={[20, 34, 18]} intensity={p.luzSol} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}>
          <orthographicCamera attach="shadow-camera" args={[-larguraPiso / 2 - 6, larguraPiso / 2 + 6, 24, -24, 0.5, 120]} />
        </directionalLight>

        {/* O quarteirão e o térreo embaixo; o escritório é o segundo andar, dentro da casca */}
        <Suspense fallback={null}>
          <group position={[0, -ANDAR, 0]}>
            <Quarteirao p={p} predio={predio} escuro={escuro} entradaX={0} />
          </group>
          <CascaDoAndar predio={predio} escuro={escuro} aberto={aberto} aoAbrir={aoAbrir} />
        </Suspense>
        <mesh position={[centro.x, -ESPESSURA_PISO / 2, centro.z]} receiveShadow>
          <boxGeometry args={[larguraPiso, ESPESSURA_PISO, profundidade]} />
          <meshStandardMaterial color={p.piso} roughness={0.55} metalness={0.15} />
        </mesh>
        <gridHelper
          args={[Math.ceil(larguraPiso), Math.ceil(larguraPiso / 2), p.juntas, p.juntas]}
          position={[centro.x, 0.004, centro.z]}
          scale={[1, 1, profundidade / Math.ceil(larguraPiso)]}
        />

        {/* Paredes de fora: fundo (com o quadro do GestorGov) e a lateral ripada azul-marinho */}
        <mesh position={[centro.x, 1.45, planta.zFundo0 - 0.12]} castShadow receiveShadow>
          <boxGeometry args={[larguraPiso, 2.9, 0.24]} />
          <meshStandardMaterial color={p.parede} roughness={0.9} />
        </mesh>
        <Suspense fallback={null}>
          <group position={[(planta.salas[1].ret.x0 + planta.salas[1].ret.x1) / 2, 1.9, planta.zFundo0 + 0.02]}>
            <Banner cor={AMARELO} />
          </group>
        </Suspense>
        <group position={[planta.xEsq0 + 0.03, 0, centro.z]}>
          <PainelMadeira p={p} profundidade={profundidade} />
        </group>

        {/* Salas dos setores */}
        {planta.salas.map((sala) => (
          <SalaDoSetor
            key={sala.id}
            sala={sala}
            p={p}
            ativa={selecao?.tipo === "setor" && selecao.id === sala.id}
            aoSelecionar={aoSelecionar}
            transferidasAguardando={transferidasAguardando}
          />
        ))}

        {/* Atendimento: a baia, com o piso clicável */}
        <PisoClicavel
          ret={{ x0: planta.bx0, x1: planta.bx1, z0: planta.bz0, z1: planta.bz1 }}
          cor={AZUL}
          ativo={selecao?.tipo === "setor" && selecao.id === "atendimento"}
          aoClicar={() => aoSelecionar({ tipo: "setor", id: "atendimento" })}
        />
        {grupos.map((b, i) => (
          <group key={i} position={[x(i), 0, 0]}>
            <Suspense fallback={null}>
              <BaiaAgentes
                agentes={b}
                corDe={(id) => lugarDe.get(id)?.cor ?? AZUL}
                p={p}
                selecao={selecao}
                aoSelecionar={aoSelecionar}
                emFoco={emFoco}
                aoPassar={setEmFoco}
              />
            </Suspense>
          </group>
        ))}

        {/* Os agentes, que saem da mesa para buscar nos setores */}
        <Suspense fallback={null}>
          {agentes.map((agente) => {
            const lugar = lugarDe.get(agente.id);
            if (!lugar) return null;
            const { baloes } = empilhar(agente.conversas);
            return (
              <AgenteMovel
                key={agente.id}
                agente={agente}
                cor={lugar.cor}
                cadeira={lugar.cadeira}
                giro={lugar.giro}
                planta={planta}
                ocupado={baloes.length > 0}
                destacado={selecao?.tipo === "agente" && selecao.id === agente.id}
                aoClicar={() => aoSelecionar({ tipo: "agente", id: agente.id })}
                controles={controles}
                posicoes={posicoes}
                alturaNaMesa={alturaDoNome(baloes.length)}
              />
            );
          })}
        </Suspense>

        {aberto && voos.map((v) => (
          <Envelope key={v.id} voo={v} aoChegar={() => setVoos((lista) => lista.filter((o) => o.id !== v.id))} />
        ))}

        <Planta p={p} posicao={[planta.xDir1 - 0.8, 0, planta.zFrente + 0.2]} escala={1} />
        <Planta p={p} posicao={[planta.bx1 + 0.9, 0, planta.bz1 + 1.2]} escala={0.8} />

        <ControleCamera geral={geral} foco={foco} margemDireita={margemDireita} api={api} />
        <Projetor rotulos={rotulos} elementos={elementos} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {rotulos.map((r) => (
          <div
            key={r.id}
            ref={(el) => {
              elementos.current[r.id] = el;
            }}
            className={cn("absolute top-0 left-0 will-change-transform", !r.passivo && "pointer-events-auto")}
            style={{ visibility: "hidden" }}
          >
            {r.conteudo}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── Rótulos em HTML presos à cena ───────── */

export interface Rotulo {
  id: string;
  /** Ponto no mundo; pode ser um vetor que muda a cada quadro (ex.: a etiqueta do agente que anda). */
  posicao: THREE.Vector3;
  conteudo: ReactNode;
  /** Não recebe o mouse (ex.: o cartão que segue o balão). */
  passivo?: boolean;
}

/** A cada quadro, projeta o ponto de cada rótulo na tela e move o elemento HTML correspondente.
 * (O Html do drei recria a própria raiz React quando o Canvas liga os eventos e perdia o conteúdo.) */
export function Projetor({ rotulos, elementos }: { rotulos: Rotulo[]; elementos: MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const ponto = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const r of rotulos) {
      const el = elementos.current[r.id];
      if (!el) continue;
      ponto.copy(r.posicao).project(camera);
      const x = (ponto.x * 0.5 + 0.5) * size.width;
      const y = (-ponto.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      el.style.visibility = r.posicao.y < -50 ? "hidden" : "visible";
    }
  });
  return null;
}
