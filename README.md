# Chat IA — extensão multi-LLM para o Google Chrome

Painel lateral de chat no estilo da extensão do Claude, para conversar com **vários provedores de LLM**
direto do navegador, escolhendo o modelo a cada mensagem e usando a página aberta como contexto.

| Nuvem | On-premise / local |
|-------|--------------------|
| OpenAI (GPT‑5, GPT‑4.1, o‑series…) | Ollama |
| Anthropic (Claude Opus, Sonnet, Haiku) | LM Studio |
| Google Gemini | Qualquer servidor compatível com a API da OpenAI: vLLM, LocalAI, llama.cpp server, TGI, LiteLLM, Open WebUI… (também serve para OpenRouter, Groq etc.) |

## Funcionalidades

- 💬 Chat em **painel lateral** com respostas em tempo real (streaming), botão de parar e **regenerar**.
- 🔀 **Seletor de modelo** agrupado por provedor; troque de modelo no meio da conversa.
- 🔎 **Buscar modelos** direto da API de cada provedor, ou digitar nomes manualmente.
- 📄 **Usar página**: envia título, URL e texto da aba atual como contexto.
- 🖱️ **Menu de contexto** (botão direito): resumir, explicar, traduzir, melhorar escrita ou perguntar sobre o texto selecionado; resumir a página.
- 🗂️ **Histórico** local com busca e exclusão.
- 🧾 Markdown com blocos de código, tabelas e botão **Copiar**.
- 🌗 Tema claro/escuro automático. Atalho: **Ctrl+Shift+E** (Mac: **⌘+Shift+E**).
- 🔐 Chaves salvas apenas no navegador (`chrome.storage.local`); não existe servidor intermediário.

O planejamento e a arquitetura estão em [`docs/PLANEJAMENTO.md`](docs/PLANEJAMENTO.md).

---

## 1. Instalar (modo desenvolvedor)

1. Baixe o código: `git clone https://github.com/EliasSantiago/extensao.git` (ou baixe o ZIP pelo GitHub e descompacte).
2. No Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta do projeto (a que contém o `manifest.json`).
5. Fixe a extensão na barra (ícone de quebra-cabeça → alfinete em **Chat IA**).

A página de configurações abre automaticamente na primeira instalação.
Após alterar o código, clique em **↻ Recarregar** no card da extensão em `chrome://extensions`.

> Requer Chrome 116+ (também funciona em Edge, Brave e outros navegadores Chromium com suporte a side panel).

## 2. Configurar os provedores

Clique na engrenagem ⚙ do painel (ou botão direito no ícone → **Opções**):

| Provedor | O que preencher |
|----------|-----------------|
| **OpenAI** | Chave de [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic (Claude)** | Chave de [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **Gemini** | Chave do [Google AI Studio](https://aistudio.google.com/app/apikey) |
| **Ollama** | URL (padrão `http://localhost:11434`). Inicie liberando a origem da extensão: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve` (no Windows/macOS defina a variável de ambiente `OLLAMA_ORIGINS` e reinicie o app) |
| **LM Studio** | Aba *Developer* → *Start Server* com **Enable CORS** ligado; URL `http://localhost:1234/v1` |
| **OpenAI-compatível** | URL base terminando em `/v1` (ex.: `http://servidor-gpu:8000/v1` para vLLM), chave se o servidor exigir, e um nome para exibir |

Em cada card use **Buscar modelos** (preenche a lista a partir da API) e **Testar conexão**; depois clique em **Salvar**.
Marque/desmarque o checkbox do card para mostrar ou esconder o provedor no seletor.

Também é possível definir o prompt de sistema, temperatura, máximo de tokens e o limite de caracteres lidos da página.

**Servidores on-premise e CORS:** a extensão faz as requisições com origem `chrome-extension://<id>`. Se o servidor
recusar (erro de conexão ou 403), libere essa origem no CORS do servidor (ex.: vLLM `--allowed-origins '["*"]'`,
LocalAI `CORS=true`, llama.cpp server já libera por padrão) ou coloque um proxy reverso que adicione os cabeçalhos.

## 3. Usar

- Clique no ícone da extensão ou pressione **Ctrl+Shift+E** para abrir o painel.
- Escolha o modelo no seletor ao lado de **Usar página** e digite a mensagem (**Enter** envia, **Shift+Enter** quebra linha).
- Marque **Usar página** para que o modelo leia a aba atual (não funciona em páginas `chrome://` nem na Chrome Web Store).
- Selecione um texto em qualquer site → botão direito → **Chat IA** → escolha a ação.
- **+** inicia nova conversa; o relógio abre o histórico.
- Passe o mouse sobre uma resposta para **Copiar** ou **Regenerar** (com o modelo selecionado no momento — útil para comparar modelos).

## 4. Publicar na Chrome Web Store

1. Atualize `version` em `manifest.json` (cada envio precisa de uma versão maior).
2. Gere o pacote: `npm run package` (ou `bash scripts/package.sh`) → `dist/chat-ia-<versão>.zip`.
3. Crie uma conta em [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (taxa única de US$ 5) e ative a verificação em duas etapas da conta Google.
4. **Novo item** → envie o `.zip`.
5. Preencha a ficha:
   - Descrição, categoria (*Produtividade*), idioma, ícone 128×128 (`icons/icon128.png`), ao menos **1 captura de tela 1280×800** (ou 640×400).
   - **Privacidade**: declare finalidade única ("chat com modelos de IA escolhidos pelo usuário") e justifique as permissões:
     - `sidePanel` – exibir o chat; `storage` – salvar configurações e histórico localmente;
     - `contextMenus` – ações no texto selecionado; `scripting`, `activeTab`, `tabs` – ler a página atual quando o usuário pede;
     - `host_permissions <all_urls>` – ler a página ativa e chamar o endpoint de LLM que o usuário configurar (inclusive servidores locais/on-premise).
   - Informe que dados (texto da página/mensagens) são enviados **somente** ao provedor escolhido pelo usuário e que não há coleta pelo desenvolvedor. É exigida uma **URL de política de privacidade** (pode ser uma página no GitHub Pages ou um arquivo `PRIVACY.md` no repositório).
6. Escolha a visibilidade (**Público**, **Não listado** ou **Privado/apenas grupo de teste**) e envie para revisão. A análise costuma levar de alguns dias até ~2 semanas; `<all_urls>` pode prolongar a revisão.

**Distribuição interna (empresas):** publique como *Privado* para o domínio Google Workspace, ou force a instalação via política
`ExtensionInstallForcelist` (Google Admin / GPO no Windows). Para Microsoft Edge, o mesmo `.zip` pode ser enviado ao
[Partner Center](https://partner.microsoft.com/dashboard/microsoftedge).

## Desenvolvimento

```
npm test            # testes unitários dos adaptadores e do Markdown (Node 18+)
npm run test:e2e    # carrega a extensão no Chromium com um LLM simulado (requer Playwright)
npm run icons       # regenera os ícones
npm run package     # gera o zip para a Web Store
```

Para adicionar um provedor que já usa um formato suportado (OpenAI, Anthropic, Gemini ou Ollama), basta incluir uma
entrada em `PROVIDERS` em [`src/lib/providers.js`](src/lib/providers.js) e o id em `PROVIDER_ORDER`.

## Privacidade e segurança

- Chaves e histórico ficam em `chrome.storage.local` deste perfil do Chrome (não sincronizam).
- O conteúdo da página só é lido quando **Usar página** está marcado ou uma ação do menu de contexto é usada.
- Chamar a API diretamente do navegador expõe a chave a quem tiver acesso ao perfil do Chrome. Em ambientes corporativos,
  prefira um gateway próprio (ex.: LiteLLM) configurado como provedor **OpenAI-compatível**, com chaves por usuário.
