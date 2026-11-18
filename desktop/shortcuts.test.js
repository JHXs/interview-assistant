const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { portalBinding } = require('./kdeWayland');

const {
  createShortcutState,
  getShortcutsFilePath,
  isValidShortcutKey,
  isWaylandShortcutKey,
  loadShortcutConfig,
  saveShortcutConfig,
  validateShortcutMap,
} = require('./shortcuts');

function makeFakeApp(tmpDir) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return tmpDir;
    },
  };
}

test('isValidShortcutKey accepts CommandOrControl with optional Shift and Alt plus supported key', () => {
  assert.equal(isValidShortcutKey('CommandOrControl+B'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+.'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+/'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Enter'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Escape'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Left'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Right'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Shift+J'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Shift+Enter'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Shift+/'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Alt+J'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Shift+Alt+J'), true);
  assert.equal(isValidShortcutKey('Alt+B'), false);
  assert.equal(isValidShortcutKey('CommandOrControl+Alt+Shift+B'), false);
  assert.equal(isValidShortcutKey('CommandOrControl+Shift+Shift+B'), false);
  assert.equal(isValidShortcutKey('CommandOrControl+Meta+B'), false);
  assert.equal(isValidShortcutKey('CommandOrControl+Backspace'), false);
});

test('validateShortcutMap rejects duplicate keys', () => {
  const shortcuts = createShortcutState({
    hardClearSession: { key: 'CommandOrControl+B' },
  });
  const result = validateShortcutMap(shortcuts);
  assert.equal(result.ok, false);
  assert.match(result.error, /重复/);
});

test('load and save shortcut config roundtrip', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-shortcuts-'));
  const app = makeFakeApp(tmpDir);
  const shortcuts = createShortcutState({
    askFromServerScreen: { key: 'CommandOrControl+/' },
    cancelAnswer: { key: 'CommandOrControl+Escape' },
    addMultiServerScreenShot: { key: 'CommandOrControl+Shift+/' },
    hardClearSession: { key: 'CommandOrControl+.' },
    toggleInterviewOverlay: { key: 'CommandOrControl+Shift+Enter' },
    focusPrevTab: { key: 'CommandOrControl+Left' },
    focusNextTab: { key: 'CommandOrControl+Right' },
    overlayPrevQuestion: { key: 'CommandOrControl+Up' },
    overlayNextQuestion: { key: 'CommandOrControl+Down' },
    askScreenForceThink: { key: 'CommandOrControl+Alt+/' },
    askScreenForceNoThink: { key: 'CommandOrControl+Alt+.' },
    toggleThinkMode: { key: 'CommandOrControl+Shift+T' },
  });

  saveShortcutConfig(app, shortcuts);
  const loaded = loadShortcutConfig(app);

  assert.equal(loaded.askFromServerScreen.key, 'CommandOrControl+/');
  assert.equal(loaded.cancelAnswer.key, 'CommandOrControl+Escape');
  assert.equal(loaded.addMultiServerScreenShot.key, 'CommandOrControl+Shift+/');
  assert.equal(loaded.hardClearSession.key, 'CommandOrControl+.');
  assert.equal(loaded.toggleInterviewOverlay.key, 'CommandOrControl+Shift+Enter');
  assert.equal(loaded.focusPrevTab.key, 'CommandOrControl+Left');
  assert.equal(loaded.focusNextTab.key, 'CommandOrControl+Right');
  assert.equal(loaded.overlayPrevQuestion.key, 'CommandOrControl+Up');
  assert.equal(loaded.overlayNextQuestion.key, 'CommandOrControl+Down');
  assert.equal(loaded.askScreenForceThink.key, 'CommandOrControl+Alt+/');
  assert.equal(loaded.askScreenForceNoThink.key, 'CommandOrControl+Alt+.');
  assert.equal(loaded.toggleThinkMode.key, 'CommandOrControl+Shift+T');
  assert.ok(fs.existsSync(getShortcutsFilePath(app)));
});

test('default think shortcuts are valid and unique', () => {
  const shortcuts = createShortcutState();
  assert.equal(shortcuts.askScreenForceThink.key, 'CommandOrControl+Alt+/');
  assert.equal(shortcuts.askScreenForceNoThink.key, 'CommandOrControl+Alt+.');
  assert.equal(shortcuts.toggleThinkMode.key, 'CommandOrControl+Shift+T');
  assert.equal(isValidShortcutKey(shortcuts.askScreenForceThink.key), true);
  assert.equal(isValidShortcutKey(shortcuts.askScreenForceNoThink.key), true);
  assert.equal(isValidShortcutKey(shortcuts.toggleThinkMode.key), true);
  const result = validateShortcutMap(shortcuts);
  assert.equal(result.ok, true);
});

test('Wayland uses distinct portal-compatible defaults and preserves saved custom keys', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-shortcuts-'));
  const app = makeFakeApp(tmpDir);
  saveShortcutConfig(app, createShortcutState({
    toggleInterviewOverlay: { key: 'CommandOrControl+Shift+J' },
  }));

  const shortcuts = loadShortcutConfig(app, true);
  assert.equal(shortcuts.hideOrShowWindow.key, 'CommandOrControl+B');
  assert.equal(shortcuts.askFromServerScreen.key, 'CommandOrControl+K');
  assert.equal(shortcuts.toggleInterviewOverlay.key, 'CommandOrControl+Shift+J');
  assert.ok(Object.values(shortcuts).every(({ key }) => isWaylandShortcutKey(key)));
  assert.equal(validateShortcutMap(shortcuts).ok, true);

  saveShortcutConfig(app, shortcuts);
  assert.equal(loadShortcutConfig(app).askFromServerScreen.key, 'CommandOrControl+/');
});

test('KDE can reuse Chromium bindings for existing keys with punctuation', () => {
  const profileId = '12345678-1234-1234-1234-123456789abc';
  assert.deepEqual(portalBinding('CommandOrControl+Alt+.', profileId), {
    id: 'ABDF5BD351B97290C58CDE7FEDEA713F-Ctrl+Alt+Period',
    trigger: 'CTRL+ALT+period',
  });
  assert.equal(portalBinding('CommandOrControl+Up', profileId).trigger, 'CTRL+Up');
});
