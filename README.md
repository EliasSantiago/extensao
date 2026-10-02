# Nexo — assistente de IA multi-modelo para o Google Chrome

Painel lateral de chat no estilo da extensão do Claude, para conversar com **vários provedores de LLM**
direto do navegador, escolhendo o modelo a cada mensagem e usando a página aberta como contexto.

| Nuvem | On-premise / local |
|-------|--------------------|
| OpenAI (GPT‑5, GPT‑4.1, o‑series…) | Ollama |
| Anthropic (Claude Opus, Sonnet, Haiku) | LM Studio |
| Google Gemini | Qualquer servidor compatível com a API da OpenAI: vLLM, LocalAI, llama.cpp server, TGI, LiteLLM, Open WebUI… (também serve para OpenRouter, Groq etc.) |

## Funcionalidades

- 🤖 **Modo agente (navegação)**: a IA controla a aba do Chrome — abre sites, pesquisa no Google, lê a página, clica, digita, escolhe opções, rola e troca de abas — até concluir a tarefa (ex.: “entre na Shein e busque camisas masculinas premium com material elogiado”). Com **capturas de tela (visão)**, o agente vê a página com marcadores amarelos numerados sobre os elementos clicáveis e pode clicar por número ou por coordenada. Cada ação aparece no chat e pode ser expandida (as capturas aparecem em miniatura); a aba controlada ganha um contorno branco. Pede confirmação antes de compras, pagamentos, envios e logins.
- 💬 Chat em **painel lateral** com respostas em tempo real (streaming), botão de parar e **regenerar**.
- 🔀 **Seletor de modelo** com busca e teclado, agrupado por provedor (nuvem/local); troque de modelo no meio da conversa.
- 🔎 **Buscar modelos** direto da API de cada provedor, ou digitar nomes manualmente.
- 📄 **Contexto da página**: atalhos (Resumir, Pontos-chave, Traduzir) ou perguntas que mencionem “esta página”, “neste site”, “nesta aba”… enviam título, URL e texto da aba atual.
- 🖱️ **Menu de contexto** (botão direito): resumir, explicar, traduzir, melhorar escrita ou perguntar sobre o texto selecionado; resumir a página.
- 🗂️ **Histórico** local com busca e exclusão.
- 🧾 Markdown com blocos de código, tabelas e botão **Copiar**.
- 🧊 Ícones [Heroicons](https://heroicons.com) (MIT) e visual monocromático (preto, cinza quase preto e branco) com as fontes **Inter** e **JetBrains Mono** (Google Fonts, empacotadas na extensão). Atalho: **Ctrl+Shift+E** (Mac: **⌘+Shift+E**).
- 🔐 Chaves salvas apenas no navegador (`chrome.storage.local`); não existe servidor intermediário.

O planejamento e a arquitetura estão em [`docs/PLANEJAMENTO.md`](docs/PLANEJAMENTO.md).

---

## 1. Instalar (modo desenvolvedor)

1. Baixe o código: `git clone https://github.com/EliasSantiago/extensao.git` (ou baixe o ZIP pelo GitHub e descompacte).
2. No Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta do projeto (a que contém o `manifest.json`).
5. Fixe a extensão na barra (ícone de quebra-cabeça → alfinete em **Nexo**).

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
- Escolha o modelo no seletor embaixo da caixa de mensagem (dá para digitar para filtrar e usar ↑/↓/Enter) e escreva (**Enter** envia, **Shift+Enter** quebra linha).
- Para o modelo ler a aba atual, use os atalhos da tela inicial ou mencione a página na pergunta (ex.: “resuma esta página”, “qual o preço neste site?”). Não funciona em páginas `chrome://` nem na Chrome Web Store.
- Peça tarefas na web em linguagem natural: “pesquise o preço do iPhone 16 em 3 lojas”, “entre no site X e encontre o telefone de contato”, “abra o primeiro resultado e resuma”. O agente trabalha na aba ativa da janela; clique em ■ para parar a qualquer momento.
- O modo agente funciona com modelos que suportam *tool calling*: GPT‑4o/4.1/5, Claude, Gemini 2.x e modelos locais como Qwen 2.5/3, Llama 3.1+ e Mistral (Ollama/LM Studio/vLLM). Modelos sem suporte respondem só com texto (o Nexo detecta e avisa). As capturas de tela exigem modelo com visão (GPT‑4o/4.1/5, Claude, Gemini, Qwen2.5‑VL/Llama 3.2 Vision locais); sem visão, o agente segue só com o texto da página. Dá para desligar o modo agente, as capturas e ajustar o limite de passos nas configurações.
- Selecione um texto em qualquer site → botão direito → **Nexo** → escolha a ação.
- **+** inicia nova conversa; o relógio abre o histórico.
- Passe o mouse sobre uma resposta para **Copiar** ou **Regenerar** (com o modelo selecionado no momento — útil para comparar modelos).

## 4. Publicar na Chrome Web Store

1. Atualize `version` em `manifest.json` (cada envio precisa de uma versão maior).
2. Gere o pacote: `npm run package` (ou `bash scripts/package.sh`) → `dist/nexo-<versão>.zip`.
3. Crie uma conta em [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (taxa única de US$ 5) e ative a verificação em duas etapas da conta Google.
4. **Novo item** → envie o `.zip`.
5. Preencha a ficha:
   - Descrição, categoria (*Produtividade*), idioma, ícone 128×128 (`icons/icon128.png`), ao menos **1 captura de tela 1280×800** (ou 640×400).
   - **Privacidade**: declare finalidade única ("chat com modelos de IA escolhidos pelo usuário") e justifique as permissões:
     - `sidePanel` – exibir o chat; `storage` e `unlimitedStorage` – salvar configurações e histórico localmente;
     - `contextMenus` – ações no texto selecionado; `scripting`, `activeTab`, `tabs` – ler a página e executar as ações de navegação (abrir, clicar, digitar) que o usuário pede ao agente;
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

As cores e fontes ficam em [`src/assets/theme.css`](src/assets/theme.css) (variáveis CSS compartilhadas pelo chat e pelas configurações).

Para adicionar um provedor que já usa um formato suportado (OpenAI, Anthropic, Gemini ou Ollama), basta incluir uma
entrada em `PROVIDERS` em [`src/lib/providers.js`](src/lib/providers.js) e o id em `PROVIDER_ORDER`.

## Privacidade e segurança

- Chaves e histórico ficam em `chrome.storage.local` deste perfil do Chrome (não sincronizam).
- No modo agente, o conteúdo das páginas que o agente abre é enviado ao provedor escolhido. O agente usa a sua sessão do navegador (sites em que você está logado), então acompanhe as ações e use **parar** se algo sair do esperado. Textos das páginas são tratados como dados não confiáveis, e ações sensíveis exigem sua confirmação.
- O conteúdo da página só é lido quando você usa um atalho de página, menciona a página na pergunta ou usa o menu de contexto.
- Chamar a API diretamente do navegador expõe a chave a quem tiver acesso ao perfil do Chrome. Em ambientes corporativos,
  prefira um gateway próprio (ex.: LiteLLM) configurado como provedor **OpenAI-compatível**, com chaves por usuário.
