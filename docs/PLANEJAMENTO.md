# Planejamento — Extensão "Nexo" para Google Chrome

## Objetivo

Uma extensão para o Chrome no estilo da extensão do Claude: um **painel lateral (side panel)**
com chat, onde o usuário escolhe o **provedor** e o **modelo** de LLM e conversa com ele
sem sair da página, podendo usar o **conteúdo da página** ou o **texto selecionado** como contexto.

## Requisitos

| # | Requisito | Como foi atendido |
|---|-----------|-------------------|
| 1 | Chat no navegador | Side panel (`chrome.sidePanel`) aberto pelo ícone da extensão ou `Ctrl+Shift+E` |
| 2 | Escolher o modelo | Seletor agrupado por provedor no topo do painel; modelos listados automaticamente via API ou digitados manualmente |
| 3 | Provedores em nuvem | OpenAI, Anthropic (Claude), Google Gemini |
| 4 | Provedores on-premise | Ollama, LM Studio, e qualquer servidor compatível com a API da OpenAI (vLLM, LocalAI, llama.cpp server, TGI, Open WebUI, LiteLLM…) |
| 5 | Usar a página como contexto | Atalhos de página e perguntas que mencionam "esta página/site/aba" leem título, URL e texto da aba ativa (`chrome.scripting`) |
| 6 | Menu de contexto | Botão direito → Resumir / Explicar / Traduzir / Perguntar sobre a seleção; Resumir a página |
| 7 | Histórico | Conversas salvas localmente (`chrome.storage.local`), com lista, reabrir e excluir |
| 8 | Respostas em tempo real | Streaming (SSE / NDJSON) com botão de parar |
| 10 | Navegar e agir nos sites (agente) | *Tool calling* nos 4 formatos de API + ferramentas de navegador (`src/lib/tools.js`): navigate, search_web, read_page, find, screenshot (com marcadores numerados), click, click_at, type, select_option, press_key, scroll, wait, list_tabs, switch_tab, new_tab; laço do agente com passos visíveis, limite de passos e confirmação para ações sensíveis |
| 9 | Segurança das chaves | Chaves ficam apenas em `chrome.storage.local` do navegador; não há servidor intermediário |

## Arquitetura

```
manifest.json                 Manifest V3
src/background.js             Service worker: comportamento do side panel, menus de contexto, atalho
src/lib/providers.js          Catálogo de provedores + adaptadores (stream e listagem de modelos)
src/lib/storage.js            Configurações e histórico (chrome.storage)
src/lib/markdown.js           Renderizador Markdown seguro e sem dependências (CSP do MV3)
src/sidepanel/                UI do chat (HTML/CSS/JS)
src/options/                  Página de configurações (chaves, URLs, modelos, parâmetros)
icons/                        Ícones 16/32/48/128
scripts/package.sh            Gera o .zip para publicar na Chrome Web Store
```

### Adaptadores de provedor

Todos os provedores são reduzidos a 4 "tipos" de API:

| Tipo | Endpoint de chat | Streaming | Provedores |
|------|------------------|-----------|------------|
| `openai` | `POST {baseUrl}/chat/completions` | SSE `choices[0].delta.content` | OpenAI, LM Studio, OpenAI-compatível |
| `anthropic` | `POST {baseUrl}/messages` | SSE `content_block_delta` | Claude |
| `gemini` | `POST {baseUrl}/models/{m}:streamGenerateContent?alt=sse` | SSE `candidates[0].content.parts` | Gemini |
| `ollama` | `POST {baseUrl}/api/chat` | NDJSON `message.content` | Ollama |

Adicionar um novo provedor = adicionar uma entrada em `PROVIDERS` (se usar uma API já suportada)
ou escrever um novo adaptador com `stream()` e `listModels()`.

## Fases

1. **Base** — manifest, service worker, side panel abrindo pelo ícone. ✅
2. **Provedores** — adaptadores com streaming, listagem de modelos e tratamento de erros. ✅
3. **Chat** — UI, Markdown, copiar código, parar geração, regenerar, histórico. ✅
4. **Contexto do navegador** — conteúdo da página, seleção, menu de contexto. ✅
5. **Configurações** — página de opções, testar conexão, buscar modelos. ✅
6. **Empacotamento** — script de zip e instruções de publicação. ✅

## Evoluções futuras

- Envio de imagens/prints da aba (modelos multimodais).
- Eventos de teclado/mouse “reais” via `chrome.debugger` para sites que ignoram eventos sintéticos.
- Sincronizar histórico entre dispositivos (opcional e criptografado).
- Prompts salvos ("atalhos") e internacionalização (`_locales`).
