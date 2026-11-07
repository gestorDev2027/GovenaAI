"""O que é próprio de cada agente de atendimento (o resto é do canal e vale para todos).

Cada agente do ecossistema (onboarding, comercial, ...) é um Perfil em `agente/perfis/`. O núcleo
(`agente/agente.py`) monta o Agent do Agno a partir dele; os canais (Unnichat, painel, terminal)
usam as mensagens fixas e as categorias de transferência do perfil do agente da conversa.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass(frozen=True)
class Perfil:
    id: str  # id do Agent no Agno (fica gravado em cada sessão: não mude depois de publicar)
    nome: str  # função do agente (nome do Agent no Agno)
    descricao: str
    instrucoes: Callable[[], str]  # lida a cada mensagem (inclui a base de conhecimento vigente)
    ferramentas: Callable[[], list]  # montadas ao criar o agente: só entram as fontes configuradas
    # A primeira mensagem, enviada pelo canal antes da primeira resposta: recebe o nome do contato e
    # devolve o texto vigente (o do onboarding vem da seção "## Boas-vindas" do roteiro, editável no painel).
    boas_vindas: Callable[[str], str]
    encerramento_inatividade: Callable[[], str]  # a despedida vigente (seção do roteiro)
    categorias_transferencia: dict[str, str]  # chave -> rótulo (painel e nota para o atendente)
    memoria_instrucoes: str
    arquivo_base: Path  # base de conhecimento padrão (o painel grava versões novas no banco)
    # Nome com que o agente aparece no painel (ex.: "Luna"); vazio usa `nome`.
    apelido: str = ""
    # Onde o agente trabalha, como numa equipe: a área (o time, ex.: "Compras", "Regulação")
    # agrupa os agentes no painel (seletor do chat, baias da Central, filtros); o cargo é a função
    # dele dentro da área (ex.: "Onboarding", "SDR").
    area: str = ""
    cargo: str = ""
    minutos_inatividade: int = 23 * 60  # dentro da janela de 24 h da Meta (ver mensagens.MINUTOS_INATIVIDADE)
    # O que a fábrica de agentes (agente/fabrica.py) mostra e deixa editar pelo painel:
    modelo_instrucoes: str = ""  # o texto das instruções com os marcadores (a "versão 0" no painel)
    contato: str = "contato"  # como as instruções chamam quem conversa (servidor, cidadão, contato)
    ferramentas_ids: tuple[str, ...] = ()  # as ferramentas previstas (entram só as configuradas)
    skills_ids: tuple[str, ...] = ()  # skills do painel (agente/fabrica_recursos.py)
    quando_transferir: str = ""  # quando usar a transferência (vai na descrição da ferramenta)
    cor: str = ""  # a cor do agente na Central
    modelo: str | None = None  # None: AGENTE_MODELO
    raciocinio: str | None = None  # None: AGENTE_RACIOCINIO
    publicado: bool = True  # ativo; inativo (ou rascunho) só aparece no chat de teste (?agente=<id>)
    origem: str = "codigo"  # "codigo" (agente/perfis/) ou "painel" (criado na fábrica)
    # Excluído na fábrica: some das listas e não atende mais; o perfil fica no registro só para as
    # conversas antigas continuarem mostrando quem atendeu (agente/fabrica.py, excluir).
    excluido: bool = False
