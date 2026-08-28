const SCRIPT_BUTTON_NAME = '开场白索引';
const BUTTON_RETRY_INTERVAL_MS = 1500;
const BUTTON_RETRY_MAX_ATTEMPTS = 20;

type GreetingItem = {
  index: number;
  title: string;
  content: string;
};

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function toPreviewText(content: string): string {
  return normalizeSpace(content)
    .replace(/\*\*/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .slice(0, 180);
}

function getGreetingItems(): GreetingItem[] {
  const data = getCharData('current');
  if (!data) {
    return [];
  }

  // 只读取“额外问候语”，不包含第一条消息 first_mes。
  const v2 = data.data as Partial<SillyTavern.v2CharData> | undefined;
  const alternateRaw = v2?.alternate_greetings;
  const alternates = Array.isArray(alternateRaw) ? alternateRaw.map(item => String(item ?? '')) : [];
  return alternates.map((content, idx) => {
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const firstLine = lines[0] ?? '';
    const bracketTitle = firstLine.match(/^\[(.+?)\]/)?.[1]?.trim();
    const plainTitle = normalizeSpace(firstLine).slice(0, 24);

    return {
      index: idx + 1,
      title: bracketTitle || plainTitle || `开场白 #${idx + 1}`,
      content,
    };
  });
}

function findGreetingSwipeMessage(): ChatMessageSwiped | null {
  const messages = getChatMessages('0-{{lastMessageId}}', { include_swipes: true });
  if (messages.length === 0) {
    return null;
  }

  const candidate = messages.find(message => Array.isArray(message.swipes) && message.swipes.length > 1);
  return candidate ?? null;
}

function normalizeForMatch(text: string): string {
  return normalizeSpace(text).replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function extractBracketTitle(text: string): string {
  const firstLine = text.split('\n').map(line => line.trim()).find(Boolean) ?? '';
  return firstLine.match(/^\[(.+?)\]/)?.[1]?.trim() ?? '';
}

function getFirstMessageContent(): string {
  const data = getCharData('current');
  if (!data) {
    return '';
  }

  const v2 = data.data as Partial<SillyTavern.v2CharData> | undefined;
  return String(v2?.first_mes ?? data.first_mes ?? '');
}

function resolveSwipeId(target: GreetingItem, swipes: string[]): number | null {
  const normalizedTarget = normalizeForMatch(target.content);

  // 1) 优先全文归一化精确匹配
  let idx = swipes.findIndex(swipe => normalizeForMatch(swipe) === normalizedTarget);
  if (idx >= 0) {
    return idx;
  }

  // 2) 再按 [标题] 匹配
  const targetTitle = extractBracketTitle(target.content);
  if (targetTitle) {
    idx = swipes.findIndex(swipe => extractBracketTitle(swipe) === targetTitle);
    if (idx >= 0) {
      return idx;
    }
  }

  // 3) 最后用前缀模糊匹配
  const targetPrefix = normalizedTarget.slice(0, 120);
  idx = swipes.findIndex(swipe => {
    const normalizedSwipe = normalizeForMatch(swipe);
    return normalizedSwipe.includes(targetPrefix) || targetPrefix.includes(normalizedSwipe.slice(0, 120));
  });
  if (idx >= 0) {
    return idx;
  }

  // 4) 兜底：根据 first_mes 是否出现在第 0 个 swipe 自动判断偏移，避免 3->2 的错位
  const normalizedFirstMes = normalizeForMatch(getFirstMessageContent());
  const firstSwipe = swipes[0] ?? '';
  const normalizedFirstSwipe = normalizeForMatch(firstSwipe);

  const hasFirstMesAtZero =
    normalizedFirstMes.length > 0 &&
    normalizedFirstSwipe.length > 0 &&
    (normalizedFirstSwipe === normalizedFirstMes ||
      normalizedFirstSwipe.includes(normalizedFirstMes.slice(0, 120)) ||
      normalizedFirstMes.includes(normalizedFirstSwipe.slice(0, 120)));

  const fallbackByOffset = target.index - 1 + (hasFirstMesAtZero ? 1 : 0);
  if (fallbackByOffset >= 0 && fallbackByOffset < swipes.length) {
    return fallbackByOffset;
  }

  return null;
}

async function jumpToGreeting(targetIndex: number): Promise<boolean> {
  const items = getGreetingItems();
  if (items.length === 0) {
    toastr.error('未读取到额外问候语数据。');
    return false;
  }

  if (targetIndex < 1 || targetIndex > items.length) {
    toastr.error(`索引越界: ${targetIndex} (有效范围 1-${items.length})`);
    return false;
  }

  const greetingMessage = findGreetingSwipeMessage();
  if (!greetingMessage) {
    toastr.error('未找到可切换的开场白楼层（swipes）。请先进入角色聊天并确保开场白已生成。');
    return false;
  }

  const swipeCount = greetingMessage.swipes.length;
  if (targetIndex > swipeCount) {
    toastr.error(`当前聊天仅有 ${swipeCount} 条可切换开场白。`);
    return false;
  }

  const target = items[targetIndex - 1];
  const swipeId = resolveSwipeId(target, greetingMessage.swipes);
  if (swipeId === null) {
    toastr.error('未能定位对应开场白，建议先在“其他开场”里手动切一次后重试。');
    return false;
  }

  await setChatMessages([{ message_id: greetingMessage.message_id, swipe_id: swipeId }], { refresh: 'all' });

  toastr.success(`已切换到开场白 #${targetIndex}`);
  return true;
}

function buildPopupContent(items: GreetingItem[], onPicked?: () => void): JQuery<HTMLElement> {
  const $root = $('<div>').css({
    display: 'grid',
    gap: '12px',
    maxHeight: '68vh',
    overflowY: 'auto',
    padding: '4px 6px 6px 2px',
  });

  const $hero = $('<div>').css({
    border: '1px solid rgba(90,180,255,0.35)',
    borderRadius: '12px',
    padding: '10px 12px',
    background:
      'linear-gradient(135deg, rgba(24,42,72,0.75) 0%, rgba(20,57,78,0.55) 45%, rgba(18,32,58,0.75) 100%)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
  });
  const $heroTitle = $('<div>').text('开场白索引').css({
    fontSize: '15px',
    fontWeight: '700',
    letterSpacing: '0.5px',
    color: '#eaf5ff',
  });
  const $heroDesc = $('<div>').text(`共 ${items.length} 条，点击任意卡片立即切换并自动关闭`).css({
    marginTop: '4px',
    fontSize: '12px',
    opacity: '0.82',
    color: '#cfe8ff',
  });
  $hero.append($heroTitle, $heroDesc);
  $root.append($hero);

  items.forEach(item => {
    const $card = $('<button>')
      .attr('type', 'button')
      .css({
        textAlign: 'left',
        width: '100%',
        border: '1px solid rgba(90,180,255,0.28)',
        borderRadius: '12px',
        padding: '10px 12px',
        background:
          'linear-gradient(145deg, rgba(17,35,60,0.9) 0%, rgba(22,53,82,0.75) 45%, rgba(13,30,52,0.88) 100%)',
        transition: 'transform .15s ease, border-color .2s ease, box-shadow .2s ease',
        boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
      })
      .on('mouseenter', function () {
        $(this).css({
          transform: 'translateY(-1px)',
          borderColor: 'rgba(132,208,255,0.62)',
          boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
        });
      })
      .on('mouseleave', function () {
        $(this).css({
          transform: 'translateY(0)',
          borderColor: 'rgba(90,180,255,0.28)',
          boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
        });
      })
      .on('click', () => {
        onPicked?.();
        errorCatched(async () => {
          await jumpToGreeting(item.index);
        })();
      });

    const $metaRow = $('<div>').css({
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '6px',
    });
    const $badge = $('<span>').text(`#${item.index}`).css({
      display: 'inline-block',
      minWidth: '42px',
      textAlign: 'center',
      fontWeight: '700',
      fontSize: '12px',
      lineHeight: '20px',
      borderRadius: '999px',
      color: '#dff4ff',
      background: 'linear-gradient(90deg, rgba(51,141,214,0.95), rgba(33,102,170,0.95))',
      boxShadow: '0 2px 10px rgba(9,44,78,0.45)',
    });
    const $title = $('<div>').text(item.title).css({
      fontSize: '18px',
      fontWeight: '700',
      color: '#eef7ff',
      lineHeight: '1.25',
      textShadow: '0 1px 2px rgba(0,0,0,0.35)',
    });
    $metaRow.append($badge, $title);

    const $preview = $('<div>').text(toPreviewText(item.content)).css({
      fontSize: '13px',
      lineHeight: '1.55',
      color: 'rgba(223,239,255,0.9)',
      opacity: '0.95',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: '-webkit-box',
      '-webkit-line-clamp': '2',
      '-webkit-box-orient': 'vertical',
    });

    $card.append($metaRow, $preview);
    $root.append($card);
  });

  return $root as JQuery<HTMLElement>;
}

async function openGreetingIndexPopup(): Promise<void> {
  const items = getGreetingItems();
  if (items.length === 0) {
    toastr.error('当前角色没有可用开场白。');
    return;
  }

  let popup: InstanceType<typeof SillyTavern.Popup> | null = null;
  const content = buildPopupContent(items, () => {
    void popup?.completeAffirmative();
  });
  popup = new SillyTavern.Popup(content, SillyTavern.POPUP_TYPE.DISPLAY, '', {
    okButton: '关闭',
    leftAlign: true,
    wide: true,
    allowHorizontalScrolling: false,
    allowVerticalScrolling: true,
  });
  await popup.show();
}

function ensureButtonVisible(): boolean {
  const current = getScriptButtons();
  const hasButton = current.some(button => button.name === SCRIPT_BUTTON_NAME);
  const next = hasButton
    ? current.map(button => (button.name === SCRIPT_BUTTON_NAME ? { ...button, visible: true } : button))
    : [...current, { name: SCRIPT_BUTTON_NAME, visible: true }];

  replaceScriptButtons(next);

  // 某些环境下按钮可能被后续逻辑覆盖，追加一次不存在按钮作为兜底。
  appendInexistentScriptButtons([{ name: SCRIPT_BUTTON_NAME, visible: true }]);

  return getScriptButtons().some(button => button.name === SCRIPT_BUTTON_NAME && button.visible);
}

function setupButtonRegistrationRetry(): number {
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const ok = errorCatched(ensureButtonVisible)();
    if (ok || attempts >= BUTTON_RETRY_MAX_ATTEMPTS) {
      window.clearInterval(timer);
      if (!ok) {
        console.warn('[开场白索引] 按钮注册重试结束，但按钮仍可能不可见。');
      }
    }
  }, BUTTON_RETRY_INTERVAL_MS);
  return timer;
}

$(() => {
  errorCatched(ensureButtonVisible)();
  const retryTimer = setupButtonRegistrationRetry();

  eventOn(getButtonEvent(SCRIPT_BUTTON_NAME), () => {
    errorCatched(openGreetingIndexPopup)();
  });

  eventOn(tavern_events.CHAT_CHANGED, () => {
    errorCatched(ensureButtonVisible)();
  });

  $(window).on('pagehide', () => {
    window.clearInterval(retryTimer);
  });

  console.info('[开场白索引] 已加载，可在脚本按钮中点击“开场白索引”直接跳转。');
});
