// Legacy card pages submit through these SillyTavern DOM IDs. Keep the
// adapter inside its owning frame so it cannot target another conversation.
function installLegacyTavernComposer() {
  if (document.getElementById('send_textarea') || document.getElementById('send_but')) return;
  const controls = document.createElement('div');
  controls.hidden = true;
  const area = document.createElement('textarea');
  area.id = 'send_textarea';
  const button = document.createElement('button');
  button.id = 'send_but';
  button.type = 'button';
  controls.append(area, button);
  document.body.append(controls);
  let pending = false;
  button.addEventListener('click', function () {
    const text = String(area.value || '').trim();
    if (pending || !text) return;
    if (typeof window.triggerSlash !== 'function') throw new Error('当前对话发送入口尚未就绪');
    pending = true;
    button.disabled = true;
    Promise.resolve().then(function () {
      return window.triggerSlash('/send ' + text + '|/trigger');
    }).then(function () {
      if (area.value.trim() === text) area.value = '';
    }, function (error) {
      // A DOM click cannot return an asynchronous rejection to legacy callers.
      // Surface it in the card itself, retaining the payload for a retry.
      const notice = document.createElement('div');
      notice.setAttribute('role', 'alert');
      notice.textContent = '开局消息发送失败：' + String(error && error.message || error);
      document.body.append(notice);
      console.error('[DSH Tavern] 开局消息发送失败', error);
    }).finally(function () { pending = false; button.disabled = false; });
  });
}

// Preparation pages address the parent DOM. Own these controls only while that
// preview is mounted; they must never forward a submission to the current chat.
function installOpeningHostComposer(hostDocument, submit, report) {
  if (hostDocument.getElementById('send_textarea') || hostDocument.getElementById('send_but')) return function () {};
  const controls = hostDocument.createElement('div');
  controls.hidden = true;
  const area = hostDocument.createElement('textarea');
  area.id = 'send_textarea';
  const button = hostDocument.createElement('button');
  button.id = 'send_but'; button.type = 'button';
  controls.append(area, button);
  hostDocument.body.append(controls);
  let active = true, pending = false, completed = false;
  button.addEventListener('click', function () {
    const text = String(area.value || '').trim();
    if (!active || pending || completed || !text) return;
    pending = true; button.disabled = true;
    Promise.resolve().then(function () { return submit(text); }).then(function () {
      completed = true; area.value = '';
    }, report).finally(function () { pending = false; button.disabled = completed; });
  });
  return function () { active = false; controls.remove(); };
}
