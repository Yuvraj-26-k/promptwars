import { get, makeElement, setText, showDialog } from './dom.js';
import { localReply } from './plan.js';

export function createChat({ api, profile, resolveChatPlace, profileForChatPlace, localClock }) {
  const chatDialog = get('chat-dialog');
  const chatQuestion = get('chat-question');
  const chatMessages = get('chat-messages');
  const chatMode = get('chat-mode');
  const chatForm = get('chat-form');
  const chatGreeting = chatMessages?.firstElementChild;

  let chatRequest;
  let chatPlace;
  let chatForecastContext;
  let chatStatus;
  let chatStatusRequest;
  const conversation = [];

  function addMessage(role, text) {
    const message = makeElement('div', `chat-message chat-message--${role}`, text);
    chatMessages?.append(message);
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
    return message;
  }

  const providerNames = { openai: 'OpenAI', gemini: 'Gemini', ollama: 'Local Ollama' };

  function describeChatStatus() {
    if (!chatStatus) {
      setText('chat-mode', 'Checking assistant setup…');
      return;
    }

    const provider = providerNames[chatStatus.provider];
    setText('adapt-plan-label', chatStatus.enabled ? 'Ask AI to adapt plan' : 'Adapt my plan');
    setText('chat-mode', chatStatus.enabled ? `${provider} ready` : 'Built-in guide');
    setText('chat-data-note', chatStatus.enabled
      ? `Your question, recent messages, city label, and plan context are sent to ${provider}.`
      : 'The built-in guide uses your current plan. Configure a local model or an API key for generative replies.');
    if (chatMode) chatMode.dataset.mode = chatStatus.enabled ? 'ai' : 'local';
  }

  function loadChatStatus() {
    if (chatStatusRequest) return chatStatusRequest;
    chatStatusRequest = api('/api/status', {}, 4000).then(({ chat }) => {
      const provider = Object.hasOwn(providerNames, chat?.provider) ? chat.provider : null;
      chatStatus = { enabled: Boolean(provider && chat.enabled === true), provider };
    }).catch(() => {
      chatStatus = { enabled: false, provider: null };
    }).finally(() => {
      chatStatusRequest = undefined;
      if (!chatRequest) describeChatStatus();
    });
    return chatStatusRequest;
  }

  function resetChat() {
    chatRequest?.abort();
    chatRequest = undefined;
    chatPlace = undefined;
    chatForecastContext = undefined;
    conversation.length = 0;
    if (chatMessages) {
      chatMessages.replaceChildren(...(chatGreeting ? [chatGreeting] : []));
      chatMessages.setAttribute('aria-busy', 'false');
    }
    if (chatQuestion) chatQuestion.value = '';
    const sendButton = chatForm?.querySelector('[type="submit"]');
    if (sendButton) sendButton.disabled = false;
    describeChatStatus();
  }

  async function ask(questionValue, selectedContext) {
    const question = questionValue.trim().slice(0, 1000);
    if (!question || chatRequest || !chatQuestion) return;
    const request = new AbortController();
    chatRequest = request;
    const sendButton = chatForm?.querySelector('[type="submit"]');
    if (sendButton) sendButton.disabled = true;
    chatMessages?.setAttribute('aria-busy', 'true');
    chatQuestion.value = '';
    addMessage('user', question);
    const response = addMessage('assistant', 'Preparing your reply…');
    try {
      if (selectedContext) {
        chatForecastContext = selectedContext;
        chatPlace = undefined;
      }
      const context = selectedContext ?? await chatProfile(question, request.signal);
      if (request.signal.aborted) return;
      if (!chatStatus || chatStatusRequest) await loadChatStatus();
      if (request.signal.aborted) return;

      let result;
      if (chatStatus.enabled) {
        try {
          result = await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, profile: context, history: conversation }),
            signal: request.signal,
          }, chatStatus.provider === 'ollama' ? 185000 : 60000);
        } catch {
          result = { reason: 'provider_unavailable' };
        }
      }
      if (request.signal.aborted) return;

      const answer = typeof result?.reply === 'string' && result.reply.trim() ? result.reply : localReply(question, context);
      const isAi = result?.mode === 'ai';
      renderAIResponse(response, answer);
      if (context.dataMode === 'demo') {
        response.prepend(makeElement('p', 'reply-evidence', 'Delhi sample · Example readings'));
      } else if (context.dataMode === 'live' && context.time && Number.isFinite(context.aqi)) {
        const evidence = makeElement('p', 'reply-evidence');
        evidence.textContent = `Air data for ${context.city} · ${localClock(context.time, true)} local time · US AQI ${context.aqi}`;
        if (Number.isFinite(context.pm25)) evidence.append(` · PM₂.₅ ${context.pm25} µg/m³`);
        const source = makeElement('a', '', 'Open-Meteo / CAMS model estimate');
        source.href = 'https://open-meteo.com/en/docs/air-quality-api';
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        evidence.append(document.createElement('br'), source);
        response.append(evidence);
      }
      conversation.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
      if (conversation.length > 6) conversation.splice(0, conversation.length - 6);
      if (chatMode) {
        const provider = providerNames[result?.provider] || 'AI';
        chatMode.textContent = isAi ? `AI reply · ${provider}` : result?.reason === 'provider_unavailable'
          ? 'AI unavailable · built-in guide' : 'Built-in guide';
        chatMode.dataset.mode = isAi ? 'ai' : 'local';
      }
    } catch {
      if (!request.signal.aborted) response.textContent = 'Breezy could not answer. Please try again.';
    } finally {
      if (chatRequest === request) {
        chatRequest = undefined;
        if (sendButton) sendButton.disabled = false;
        if (chatMessages) {
          chatMessages.setAttribute('aria-busy', 'false');
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      }
    }
  }


  const launcher = get('assistant-launcher');
  const welcome = get('assistant-welcome');
  const welcomeKey = 'clearskies.assistant-welcome.v1';
  function initializeWelcome() {
    if (launcher) launcher.hidden = false;
    if (!welcome) return;
    try {
      welcome.hidden = window.sessionStorage.getItem(welcomeKey) === 'seen';
    } catch {
      welcome.hidden = false;
    }
  }

  function dismissWelcome() {
    if (!welcome || welcome.hidden) return;
    welcome.hidden = true;
    try {
      window.sessionStorage.setItem(welcomeKey, 'seen');
    } catch {
      // The greeting can still be dismissed when browser storage is disabled.
    }
  }

  function openChat() {
    dismissWelcome();
    showDialog(chatDialog, chatQuestion);
    void loadChatStatus();
  }

  function initializeChat() {
    initializeWelcome();
    get('assistant-welcome-close')?.addEventListener('click', () => {
      dismissWelcome();
      get('assistant-launch-button')?.focus({ preventScroll: true });
    });
    chatDialog?.addEventListener('close', dismissWelcome);

    document.querySelectorAll('[data-open-chat]').forEach((button) => {
      button.addEventListener('click', openChat);
    });
    document.querySelectorAll('[data-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        openChat();
        void ask(button.dataset.prompt || button.textContent);
      });
    });
    get('chat-close')?.addEventListener('click', () => chatDialog?.close());
    chatForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void ask(chatQuestion?.value || '');
    });
    describeChatStatus();
    void loadChatStatus();
  }

  function renderAIResponse(element, answer) {
    element.replaceChildren();
    element.style.whiteSpace = 'pre-wrap';

    const lines = answer.split(/\r?\n/);

    lines.forEach((line, index) => {
      line = line.replace(/^\s*[-*]\s+/, '\u2022 ');

      const parts = line.split(/(\*\*[^*]+\*\*)/g);

      for (const part of parts) {
        if (part.startsWith('**') && part.endsWith('**')) {
          const bold = document.createElement('strong');
          bold.textContent = part.slice(2, -2);
          element.appendChild(bold);
        } else {
          element.appendChild(document.createTextNode(part));
        }
      }

      if (index < lines.length - 1) {
        element.appendChild(document.createTextNode('\n'));
      }
    });
  }

  async function chatProfile(question, signal) {
    const placeMention = /\b(?:air quality|AQI|pollution|smog)\s+in\s+([\p{L}][\p{L}'’ -]{1,59}?)(?=\s+(?:today|tomorrow|right now|this morning|this evening|for|and)\b|[?.!,]|$)/iu;
    const locationMention = /\b(?:live in|lives in|living in|located in|based in|city of|in)\s+([A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,3})/;
    const requestedCity = question.match(placeMention)?.[1]?.trim();
    const name = requestedCity || question.match(locationMention)?.[1];
    if (!name && chatForecastContext) return chatForecastContext;
    const place = name ? await resolveChatPlace(name, signal) : chatPlace;
    if (signal.aborted) return;
    if (place) {
      chatForecastContext = undefined;
      chatPlace = place;
      return profileForChatPlace(place, signal);
    }
    if (requestedCity) {
      chatForecastContext = undefined;
      chatPlace = undefined;
      return { ...profile(undefined, null, 'unavailable'), city: requestedCity };
    }
    return chatForecastContext ?? profile();
  }

  return { initialize: initializeChat, open: openChat, ask, reset: resetChat };
}
