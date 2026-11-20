const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate } = require('node:timers/promises');
const { createKdeShortcutSession, createKdeWindowController } = require('./kdeWayland');

const APP_ID = 'io.example.App';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SHORTCUTS = 'org.freedesktop.portal.GlobalShortcuts';
const SESSION = '/example/session';
const ACTION = 'toggleWindow';
const OLD_KEY = [[[0x04000042, 0, 0, 0]]];
const NEW_KEY = [[[0x0400004a, 0, 0, 0]]];

function shortcutFixture(t, { failReadback = false, failWrite = false } = {}) {
  let bindingIds;
  let bus;
  let savedKeys = OLD_KEY;
  let readbacks = 0;
  const writes = [];
  const bindings = [];
  const activations = [];
  const busMethods = {
    name: ':1.42',
    async watch() { return { async remove() {} }; },
    async addMatch() {},
    async close() {},
    mangle: (path, iface, member) => [path, iface, member].join(':'),
    async invoke({ member, body }) {
      switch (member) {
        case 'Register':
        case 'setInactive':
        case 'setShortcutKeys':
          return;
        case 'shortcutKeys':
          return savedKeys;
        case 'globalShortcutsByKey':
          return [];
        case 'setForeignShortcutKeys':
          writes.push(body[1]);
          savedKeys = body[1];
          if (failWrite && body[1][0]?.[0][0] === NEW_KEY[0][0][0]) throw new Error('write failed');
          return;
      }
      const token = body.at(-1).handle_token.value;
      const path = `${PORTAL_PATH}/request/1_42/${token}`;
      let response;
      if (member === 'CreateSession') {
        response = [0, { session_handle: SESSION }];
      } else if (member === 'BindShortcuts' || member === 'ListShortcuts') {
        if (member === 'BindShortcuts') bindingIds = body[1].map(([id]) => id);
        const key = savedKeys === OLD_KEY ? 'Ctrl+B' : 'Ctrl+J';
        response = member === 'ListShortcuts' && ++readbacks === 1 && failReadback
          ? [2, {}] : [0, { shortcuts: bindingIds.map(id => [id, { trigger_description: key }]) }];
      } else {
        assert.fail(`Unexpected D-Bus method: ${member}`);
      }
      queueMicrotask(() => this.signals.emit(this.mangle(path, 'org.freedesktop.portal.Request', 'Response'), response));
      return path;
    },
  };
  const session = createKdeShortcutSession({
    app: { getPath: () => __dirname },
    appId: APP_ID,
    onBound: value => bindings.push(value),
    onActivate: action => activations.push(action),
    openBus() {
      bus = { ...busMethods, signals: new EventEmitter(), connection: new EventEmitter() };
      return bus;
    },
  });
  t.after(() => session.stop());
  return {
    session,
    bind: (shortcuts = [{ action: ACTION, key: 'CommandOrControl+B', label: 'Toggle', defaultKey: 'CommandOrControl+B' }]) =>
      session.bind(shortcuts),
    activate: () => bus.signals.emit(bus.mangle(PORTAL_PATH, SHORTCUTS, 'Activated'), [SESSION, bindingIds[0]]),
    getBus: () => bus,
    getSavedKeys: () => savedKeys,
    writes,
    bindings,
    activations,
  };
}

test('KDE saves once and retries only the Portal readback while recording still suppresses activation', async t => {
  t.mock.method(console, 'warn', () => {});
  const { session, bind, activate, writes, bindings, activations } = shortcutFixture(t, { failReadback: true });
  await bind();
  assert.equal(bindings.at(-1).get(ACTION), 'Ctrl+B');
  await session.setSuspended(true);
  assert.equal(await session.updateShortcuts([[ACTION, 'CommandOrControl+J']]), false);
  activate();
  assert.deepEqual(activations, []);

  await session.setSuspended(false);
  assert.deepEqual(writes, [[], NEW_KEY]);
  assert.equal(bindings.at(-1).get(ACTION), 'Ctrl+J');
  activate();
  assert.deepEqual(activations, [ACTION]);
});

test('KDE still rolls back and rejects a failed shortcut write', async t => {
  const { session, bind, getSavedKeys, bindings } = shortcutFixture(t, { failWrite: true });
  await bind();
  await assert.rejects(session.updateShortcuts([[ACTION, 'CommandOrControl+J']]), /write failed/);
  assert.deepEqual(getSavedKeys(), OLD_KEY);
  assert.equal(bindings.at(-1).get(ACTION), 'Ctrl+B');
});

test('KDE rebinds the saved shortcuts after D-Bus disconnects during resume', async t => {
  t.mock.method(console, 'warn', () => {});
  const { session, bind, getBus, bindings, activate, activations } = shortcutFixture(t);
  await bind();
  await session.setSuspended(true);
  const bus = getBus();
  const invoke = bus.invoke.bind(bus);
  t.mock.method(bus, 'invoke', async request => {
    if (request.member !== 'setShortcutKeys') return invoke(request);
    const error = new Error('D-Bus disconnected');
    bus.connection.emit('close', error);
    throw error;
  });

  await assert.rejects(session.setSuspended(false), /会话已关闭/);
  await setImmediate();
  assert.notEqual(getBus(), bus);
  assert.equal(bindings.at(-1).get(ACTION), 'Ctrl+B');
  activate();
  assert.deepEqual(activations, [ACTION]);
});

test('KDE does not rebind when the app stops during resume', async t => {
  const { session, bind, getBus } = shortcutFixture(t);
  await bind();
  await session.setSuspended(true);
  const bus = getBus();
  const invoke = bus.invoke.bind(bus);
  t.mock.method(bus, 'invoke', async request => {
    if (request.member !== 'setShortcutKeys') return invoke(request);
    await session.stop();
    throw new Error('D-Bus closed');
  });

  await assert.rejects(session.setSuspended(false), /会话已关闭/);
  await setImmediate();
  assert.equal(getBus(), bus);
});

test('KDE keeps the newer session when an older resume fails', async t => {
  const { session, bind, getBus, bindings } = shortcutFixture(t);
  await bind();
  await session.setSuspended(true);
  const bus = getBus();
  const invoke = bus.invoke.bind(bus);
  t.mock.method(bus, 'invoke', async request => {
    if (request.member !== 'setShortcutKeys') return invoke(request);
    bus.connection.emit('close');
    await bind([{ action: 'capture', key: 'CommandOrControl+K', label: 'Capture', defaultKey: 'CommandOrControl+K' }]);
    throw new Error('old session closed');
  });

  await assert.rejects(session.setSuspended(false), /会话已关闭/);
  await setImmediate();
  assert.deepEqual([...bindings.at(-1).keys()], ['capture']);
});

test('KDE reapplies suspension to every binding after a partial resume', async t => {
  const { session, bind, getBus } = shortcutFixture(t);
  await bind([
    { action: ACTION, key: 'CommandOrControl+B', label: 'Toggle', defaultKey: 'CommandOrControl+B' },
    { action: 'capture', key: 'CommandOrControl+K', label: 'Capture', defaultKey: 'CommandOrControl+K' },
  ]);
  const bus = getBus();
  const invoke = bus.invoke.bind(bus);
  const inactive = new Set();
  const suspensionCalls = [];
  const firstRestored = Promise.withResolvers();
  const finishResume = Promise.withResolvers();
  t.mock.method(bus, 'invoke', async request => {
    if (request.member === 'setInactive') {
      const id = request.body[0][1];
      inactive.add(id);
      suspensionCalls.push(id);
      return;
    }
    if (request.member === 'setShortcutKeys') {
      const id = request.body[0][1];
      if (id.endsWith('Ctrl+B')) {
        inactive.delete(id);
        firstRestored.resolve();
        return;
      }
      await finishResume.promise;
      throw new Error('one binding failed to resume');
    }
    return invoke(request);
  });

  await session.setSuspended(true);
  const ids = [...inactive];
  assert.equal(ids.length, 2);
  const resumeFailed = assert.rejects(session.setSuspended(false), /one binding failed to resume/);
  await firstRestored.promise;
  const resuspend = session.setSuspended(true);
  finishResume.resolve();

  await resumeFailed;
  await resuspend;
  assert.deepEqual([...inactive].sort(), [...ids].sort());
  assert.deepEqual(suspensionCalls, [...ids, ...ids]);
});

function fakeWindow() {
  const win = new EventEmitter();
  win.visible = false;
  win.isVisible = () => win.visible;
  win.isDestroyed = () => false;
  win.show = () => {
    win.visible = true;
    win.emit('show');
  };
  win.hide = () => {
    win.visible = false;
    win.emit('hide');
  };
  return win;
}

test('KWin reapplies window settings on show and serializes cursor moves with pending flags', async () => {
  const main = fakeWindow();
  const overlay = fakeWindow();
  const windows = {
    Main: { keepAbove: false, excludeFromCapture: false },
    Overlay: { keepAbove: false, excludeFromCapture: false, frameGeometry: { width: 480, height: 320 } },
  };
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const calls = [];
  const controller = createKdeWindowController({
    onStateChanged() {},
    onError: assert.fail,
    async runWindowScript(title, script) {
      calls.push(title);
      if (calls.length === 1) {
        started.resolve();
        await finish.promise;
      }
      return new Function('window', 'workspace', script)(windows[title], { cursorPos: { x: 120, y: 70 } });
    },
  });
  controller.trackWindow(main, 'main', 'Main');
  controller.trackWindow(overlay, 'overlay', 'Overlay');
  assert.equal(await controller.setMainWindowAlwaysOnTop(true), true);
  assert.deepEqual(calls, []);

  main.show();
  overlay.show();
  await started.promise;
  const move = controller.moveOverlayToCursor();
  const duplicateMove = controller.moveOverlayToCursor();
  assert.equal(controller.isCaptureProtectionActive(), false);
  assert.deepEqual(calls, ['Main']);
  finish.resolve();

  await Promise.all([move, duplicateMove]);
  assert.deepEqual(calls, ['Main', 'Overlay', 'Overlay']);
  assert.equal(windows.Main.keepAbove, true);
  assert.equal(windows.Overlay.keepAbove, true);
  assert.deepEqual(windows.Overlay.frameGeometry, { x: 100, y: 50, width: 480, height: 320 });
  assert.equal(controller.isCaptureProtectionActive(), true);
});

test('KWin without capture exclusion still supports window pinning', async () => {
  const main = fakeWindow();
  const controller = createKdeWindowController({
    onStateChanged() {},
    onError: assert.fail,
    runWindowScript: async (_title, script) => new Function('window', script)({ keepAbove: false }),
  });
  controller.trackWindow(main, 'main', 'Main');
  main.show();
  assert.equal(await controller.setMainWindowAlwaysOnTop(true), true);
  assert.equal(controller.isCaptureProtectionSupported(), false);
  assert.equal(await controller.setCaptureProtection(true), false);
  assert.equal(controller.isCaptureProtectionActive(), false);
});

test('KWin retains a confirmed pin change across a hide and show while it is in flight', async () => {
  const main = fakeWindow();
  const window = { keepAbove: false, excludeFromCapture: false };
  const pinApplied = Promise.withResolvers();
  const reply = Promise.withResolvers();
  const controller = createKdeWindowController({
    onStateChanged() {},
    onError: assert.fail,
    async runWindowScript(_title, script) {
      const actual = new Function('window', script)(window);
      if (script.includes('{"keepAbove":true}')) {
        pinApplied.resolve();
        await reply.promise;
      }
      return actual;
    },
  });
  controller.trackWindow(main, 'main', 'Main');
  main.show();
  const pinned = controller.setMainWindowAlwaysOnTop(true);
  await pinApplied.promise;
  main.hide();
  main.show();
  reply.resolve();

  assert.equal(await pinned, true);
  await setImmediate();
  assert.equal(window.keepAbove, true);
});
