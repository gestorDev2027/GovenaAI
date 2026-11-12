import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// O painel é servido pelo próprio servidor Python em /painel (app.py).
// Em desenvolvimento, o Vite repassa /painel/api para o servidor local.
export default defineConfig({
  base: "/painel/",
  plugins: [react(), tailwindcss()],
  // A versão deste build: descarta o cache guardado no navegador depois de cada deploy (lib/consultas.ts).
  define: { "import.meta.env.VITE_VERSAO": JSON.stringify(Date.now().toString(36)) },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5178,
    proxy: { "/painel/api": "http://localhost:7778" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
