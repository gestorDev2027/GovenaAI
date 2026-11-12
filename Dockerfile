# GestorGov: o painel (React) é construído numa etapa com Node e servido pelo servidor Python (app.py em /painel).

# ── 1. Painel ──
FROM node:22-slim AS painel
WORKDIR /painel
COPY painel/package.json painel/package-lock.json ./
RUN npm ci
COPY painel/ ./
RUN npm run build

# ── 2. Servidor ──
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
# MCP Toolbox for Databases (Central de integrações, agente/toolbox.py): o binário oficial, ~290 MB. Só roda com
# GESTORGOV_TOOLBOX=sim. Para uma imagem sem ele: --build-arg COM_TOOLBOX=nao.
ARG COM_TOOLBOX=sim
ARG TOOLBOX_VERSAO=1.15.0
RUN if [ "$COM_TOOLBOX" = "sim" ]; then \
      python -c "import urllib.request; urllib.request.urlretrieve('https://storage.googleapis.com/mcp-toolbox-for-databases/v${TOOLBOX_VERSAO}/linux/amd64/toolbox', '/usr/local/bin/toolbox')" \
      && chmod +x /usr/local/bin/toolbox; \
    fi
COPY . .
COPY --from=painel /painel/dist ./painel/dist
# O Render define PORT; localmente, 8080.
# servidor.py abre a porta na hora e carrega o app.py em segundo plano (o plano Free do Render desiste de
# esperar um servidor que leva minutos para abrir a porta). GET /saude diz se está carregando, pronto ou com erro.
CMD ["sh", "-c", "uvicorn servidor:app --host 0.0.0.0 --port ${PORT:-8080}"]
