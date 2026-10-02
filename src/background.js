// Service worker: abre o painel lateral, cria menus de contexto e repassa
// pedidos (seleção / página) para o painel via chrome.storage.session.

const MENU_ROOT = 'nexo';

const SELECTION_ACTIONS = {
  'ask-selection': { title: 'Perguntar sobre a seleção', prompt: '' },
  'summarize-selection': { title: 'Resumir seleção', prompt: 'Resuma o texto abaixo de forma clara e objetiva.' },
  'explain-selection': { title: 'Explicar seleção', prompt: 'Explique o texto abaixo de forma simples, com exemplos se ajudar.' },
  'translate-selection': { title: 'Traduzir seleção para português', prompt: 'Traduza o texto abaixo para português do Brasil, mantendo o sentido e o tom.' },
  'improve-selection': { title: 'Melhorar a escrita da seleção', prompt: 'Reescreva o texto abaixo melhorando clareza, gramática e fluidez. Mantenha o idioma original.' }
};

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ROOT, title: 'Nexo', contexts: ['selection', 'page'] });
    for (const [id, action] of Object.entries(SELECTION_ACTIONS)) {
      chrome.contextMenus.create({ id, parentId: MENU_ROOT, title: action.title, contexts: ['selection'] });
    }
    chrome.contextMenus.create({ id: 'summarize-page', parentId: MENU_ROOT, title: 'Resumir esta página', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'open-panel', parentId: MENU_ROOT, title: 'Abrir chat', contexts: ['page'] });
  });

  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// Garante o comportamento também após o service worker reiniciar.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // sidePanel.open precisa ser chamado dentro do gesto do usuário, antes de qualquer await.
  if (tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  }

  let pending = null;
  if (SELECTION_ACTIONS[info.menuItemId]) {
    pending = {
      type: 'selection',
      action: info.menuItemId,
      instruction: SELECTION_ACTIONS[info.menuItemId].prompt,
      text: info.selectionText || '',
      url: info.pageUrl || tab?.url || '',
      title: tab?.title || ''
    };
  } else if (info.menuItemId === 'summarize-page') {
    pending = {
      type: 'page',
      instruction: 'Resuma o conteúdo desta página em tópicos, destacando os pontos principais.',
      tabId: tab?.id
    };
  }

  if (pending) {
    pending.createdAt = Date.now();
    chrome.storage.session.set({ pendingPrompt: pending });
  }
});
