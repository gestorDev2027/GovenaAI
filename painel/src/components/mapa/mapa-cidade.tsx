import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPinOff } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

/*
 * O mapa da cidade (Mapbox): um pino por unidade de saúde, na cor do tipo, enquadrado no município. Clicar
 * num pino seleciona a unidade (a tela mostra a ficha). Sem token ou sem coordenadas, a tela usa só a lista
 * (o mapa nunca é obrigatório).
 */

export interface UnidadeNoMapa {
  id: string;
  nome: string;
  tipo: string;
  cor: string;
  latitude: number;
  longitude: number;
}


/** O que o Mapbox devolve de um pino (só o que usamos; os tipos do GeoJSON não vêm no pacote). */
type Pino = { geometry: { type: string; coordinates: [number, number] }; properties: Record<string, unknown> | null };

const ESTILOS = { light: "mapbox://styles/mapbox/light-v11", dark: "mapbox://styles/mapbox/dark-v11" };

export function MapaCidade({
  token,
  unidades,
  centro,
  selecionada,
  aoSelecionar,
  className,
  imersivo = false,
  luz = "day",
  satelite = false,
}: {
  token: string;
  unidades: UnidadeNoMapa[];
  centro?: [number, number] | null;
  selecionada?: string | null;
  aoSelecionar?: (id: string) => void;
  className?: string;
  /** Central de comando: estilo 3D do Mapbox (prédios em volume), inclinado, a rolagem livre e sem borda. */
  imersivo?: boolean;
  /** Luz do estilo 3D: dia, entardecer ou noite. */
  luz?: "day" | "dusk" | "night";
  /** Central de comando: satélite com ruas, visto de cima, com zoom livre (sem o 3D inclinado). */
  satelite?: boolean;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const mapa = useRef<mapboxgl.Map | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const { theme } = useTheme();
  const aoSelecionarRef = useRef(aoSelecionar);
  aoSelecionarRef.current = aoSelecionar;

  // O mapa: criado uma vez por token, tema e modo.
  useEffect(() => {
    if (!caixa.current) return;
    mapboxgl.accessToken = token;
    let m: mapboxgl.Map;
    try {
      m = new mapboxgl.Map({
        container: caixa.current,
        style: satelite ? "mapbox://styles/mapbox/satellite-streets-v12" : imersivo ? "mapbox://styles/mapbox/standard" : ESTILOS[theme],
        center: centro ? [centro[1], centro[0]] : [-47.9, -15.8],
        zoom: centro ? 12 : 3.5,
        pitch: imersivo ? 55 : 0,
        bearing: imersivo ? -18 : 0,
        attributionControl: true,
        cooperativeGestures: !imersivo && !satelite,
        maxZoom: 20,
        ...(imersivo ? { config: { basemap: { lightPreset: luz, showPointOfInterestLabels: false, showTransitLabels: false } } } : {}),
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "O mapa não pôde ser aberto neste navegador.");
      return;
    }
    m.addControl(new mapboxgl.NavigationControl({ showCompass: imersivo, visualizePitch: imersivo }), imersivo || satelite ? "bottom-right" : "top-right");
    if (satelite) m.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-right");
    m.on("error", (ev) => {
      const texto = (ev.error as Error | undefined)?.message ?? "";
      if (/token|401|403/i.test(texto)) setErro("O token do Mapbox foi recusado. Confira o MAPBOX_TOKEN e o domínio liberado na conta.");
    });
    // "style.load" e não "load": o "load" espera um quadro desenhado com tudo pronto e, em aba em segundo plano
    // ou painel escondido, pode demorar ou não vir; as camadas só precisam do estilo carregado.
    m.once("style.load", () => {
      m.addSource("unidades", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "unidades-halo",
        type: "circle",
        source: "unidades",
        filter: ["==", ["get", "selecionada"], true],
        paint: { "circle-radius": 16, "circle-color": ["get", "cor"], "circle-opacity": 0.3, "circle-pitch-alignment": "map" },
        ...(imersivo ? { slot: "top" } : {}),
      });
      m.addLayer({
        id: "unidades",
        type: "circle",
        source: "unidades",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 13, 7, 16, 10],
          "circle-color": ["get", "cor"],
          "circle-stroke-color": !satelite && (theme === "dark" || luz === "night") ? "#0A1530" : "#FFFFFF",
          "circle-stroke-width": 2,
          "circle-emissive-strength": 1,
        },
        ...(imersivo ? { slot: "top" } : {}),
      });
      m.addLayer({
        id: "unidades-nome",
        type: "symbol",
        source: "unidades",
        minzoom: 13.5,
        layout: { "text-field": ["get", "nome"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-max-width": 12 },
        paint: {
          "text-color": (theme === "dark" || luz === "night" || satelite) ? "#EEF3FB" : "#0D1B38",
          "text-halo-color": (theme === "dark" || luz === "night" || satelite) ? "#0A1530" : "#FFFFFF",
          "text-halo-width": 1.5,
          "text-emissive-strength": 1,
        },
        ...(imersivo ? { slot: "top" } : {}),
      });
      const dica = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      m.on("mouseenter", "unidades", (ev) => {
        m.getCanvas().style.cursor = "pointer";
        const f = ev.features?.[0] as unknown as Pino | undefined;
        if (f && f.geometry.type === "Point") {
          dica.setLngLat(f.geometry.coordinates).setText(String(f.properties?.nome ?? "")).addTo(m);
        }
      });
      m.on("mouseleave", "unidades", () => {
        m.getCanvas().style.cursor = "";
        dica.remove();
      });
      m.on("click", "unidades", (ev) => {
        const id = (ev.features?.[0] as unknown as Pino | undefined)?.properties?.id;
        if (id) aoSelecionarRef.current?.(String(id));
      });
      setPronto(true);
    });
    mapa.current = m;
    return () => {
      setPronto(false);
      enquadrado.current = false; // o mapa novo (outro tema ou modo) enquadra de novo
      m.remove();
      mapa.current = null;
    };
    // O centro inicial vale só na criação; depois o enquadramento vem das unidades.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, theme, imersivo, satelite]);

  // A luz do estilo 3D muda sem recriar o mapa.
  useEffect(() => {
    const m = mapa.current;
    if (m && pronto && imersivo) {
      try {
        m.setConfigProperty("basemap", "lightPreset", luz);
      } catch {
        /* estilo sem configuração de luz */
      }
    }
  }, [luz, pronto, imersivo]);

  // Os pinos (e o enquadramento) a cada mudança das unidades ou da seleção.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto) return;
    const fonte = m.getSource("unidades") as mapboxgl.GeoJSONSource | undefined;
    fonte?.setData({
      type: "FeatureCollection",
      features: unidades.map((u) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [u.longitude, u.latitude] },
        properties: { id: u.id, nome: u.nome, cor: u.cor, selecionada: u.id === selecionada },
      })),
    });
  }, [unidades, selecionada, pronto]);

  const enquadrado = useRef(false);
  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto || !unidades.length || enquadrado.current) return;
    const limites = new mapboxgl.LngLatBounds();
    unidades.forEach((u) => limites.extend([u.longitude, u.latitude]));
    m.fitBounds(limites, { padding: imersivo ? 120 : 48, maxZoom: 14, duration: 0, pitch: imersivo ? 55 : 0, bearing: imersivo ? -18 : 0 });
    enquadrado.current = true;
  }, [unidades, pronto]);

  // A unidade escolhida fora do mapa (na lista): o mapa vai até ela.
  useEffect(() => {
    const m = mapa.current;
    const alvo = unidades.find((u) => u.id === selecionada);
    if (m && pronto && alvo) m.flyTo({ center: [alvo.longitude, alvo.latitude], zoom: Math.max(m.getZoom(), imersivo ? 16 : 14), duration: 1200 });
  }, [selecionada, pronto, unidades]);

  if (erro) {
    return (
      <div className={`grid place-items-center rounded-xl border border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}>
        <span className="flex flex-col items-center gap-2">
          <MapPinOff className="size-5" />
          {erro}
        </span>
      </div>
    );
  }
  return (
    <div
      ref={caixa}
      className={`overflow-hidden ${imersivo ? "" : "rounded-xl border border-border"} ${className ?? ""}`}
      aria-label="Mapa das unidades de saúde"
      role="region"
    />
  );
}
