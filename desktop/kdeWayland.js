const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');
const { sessionBus, defineInterface, Variant } = require('dbus-native');
const { isWaylandShortcutKey } = require('./shortcuts');

const PORTAL = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SHORTCUTS = 'org.freedesktop.portal.GlobalShortcuts';
const REQUEST = 'org.freedesktop.portal.Request';
const GLOBAL_ACCEL = 'org.kde.kglobalaccel';
const SET_PRESENT = 2;
const KWIN = 'org.kde.KWin';
const SCRIPTING = 'org.kde.kwin.Scripting';
const RESULT_INTERFACE = 'io.github.powAu3.InterviewAssistant.WindowResult';
const RESULT_PATH = '/io/github/powAu3/InterviewAssistant/WindowResult';

function openSessionBus() {
  const bus = sessionBus({ timeout: 5000 });
  bus.connection.on('error', () => { void bus.close(); });
  return bus;
}

function call(bus, destination, path, iface, member, signature, body) {
  return bus.invoke({ destination, path, interface: iface, member, signature, body });
}

function callGlobalAccel(bus, method, signature, args) {
  return call(bus, GLOBAL_ACCEL, '/kglobalaccel', 'org.kde.KGlobalAccel', method, signature, args);
}

function kdeActionId(appId, { id, label }) {
  return [appId, id, '', label];
}

function portalBinding(key, profileId) {
  const parts = key.trim().replace('CommandOrControl', 'Ctrl').split('+');
  const modifiers = parts.slice(0, -1);
  const last = parts.at(-1);
  const name = ({ '.': 'Period', ',': 'Comma' })[last] || last;
  // Retain Chromium's IDs so KDE keeps the user's existing assignments.
  const command = [...modifiers, name].join('+');
  const hash = createHash('sha256').update(`${command}+${profileId}${profileId}`).digest('hex');
  const trigger = /^[A-Z]$/.test(name) || name !== last ? name.toLowerCase() : name;
  return {
    id: `${hash.slice(0, 32).toUpperCase()}-${command}`,
    trigger: [...modifiers.map((modifier) => modifier.toUpperCase()), trigger].join('+'),
  };
}

function getProfileId(userData, appId) {
  try {
    const preferences = JSON.parse(readFileSync(join(userData, 'Preferences'), 'utf8'));
    return preferences.electron?.global_shortcuts?.uuid || appId;
  } catch {
    return appId;
  }
}

async function portalRequest(bus, member, signature, args, options, signal) {
  const token = 'ia_' + randomUUID().replaceAll('-', '');
  const sender = bus.name.slice(1).replaceAll('.', '_');
  const path = `${PORTAL_PATH}/request/${sender}/${token}`;
  const match = `type='signal',sender='${PORTAL}',path='${path}',interface='${REQUEST}',member='Response'`;
  const subscription = await bus.watch(match);
  const event = bus.mangle(path, REQUEST, 'Response');
  const request = new AbortController();
  const response = once(bus.signals, event, { signal: AbortSignal.any([signal, request.signal]) });
  // A rebind may abort while the method reply is still pending.
  response.catch(() => {});
  try {
    const handle = await call(bus, PORTAL, PORTAL_PATH, SHORTCUTS, member, signature, [
      ...args, { ...options, handle_token: new Variant('s', token) },
    ]);
    if (handle !== path) throw new Error(`${member}: Portal returned an unexpected request path`);
    const [[code, result]] = await response;
    if (code !== 0) throw new Error(`${member}: Portal response ${code}`);
    return result;
  } finally {
    request.abort();
    await subscription.remove();
  }
}

async function bindPortalShortcuts(bus, appId, entries, onBound, onActivate, signal) {
  const actions = new Map(entries.map(({ id, action }) => [id, action]));
  const publishBindings = (shortcuts) => onBound(new Map(
    shortcuts.map(([id, { trigger_description }]) => [actions.get(id), trigger_description || null]),
  ));

  await call(bus, PORTAL, PORTAL_PATH, 'org.freedesktop.host.portal.Registry', 'Register', 'sa{sv}', [appId, {}]);
  await bus.addMatch(`type='signal',sender='${PORTAL}',path='${PORTAL_PATH}',interface='${SHORTCUTS}'`);
  const { session_handle: session } = await portalRequest(bus, 'CreateSession', 'a{sv}', [], {
    session_handle_token: new Variant('s', 'shortcuts_' + randomUUID().replaceAll('-', '')),
  }, signal);

  bus.signals.on(bus.mangle(PORTAL_PATH, SHORTCUTS, 'Activated'), ([handle, id]) => {
    const action = actions.get(id);
    if (handle === session && action) onActivate(action);
  });
  bus.signals.on(bus.mangle(PORTAL_PATH, SHORTCUTS, 'ShortcutsChanged'), ([handle, shortcuts]) => {
    if (handle === session) publishBindings(shortcuts);
  });
  const shortcuts = entries.map(({ id, label, trigger }) => {
    const properties = { description: new Variant('s', label) };
    if (trigger) properties.preferred_trigger = new Variant('s', trigger);
    return [id, properties];
  });
  const result = await portalRequest(bus, 'BindShortcuts', 'oa(sa{sv})sa{sv}', [session, shortcuts, ''], {}, signal);
  publishBindings(result.shortcuts ?? []);
  return async () => {
    const { shortcuts } = await portalRequest(bus, 'ListShortcuts', 'oa{sv}', [session], {},
      AbortSignal.any([signal, AbortSignal.timeout(5000)]));
    publishBindings(shortcuts ?? []);
  };
}

function kdeKeySequence(accelerator) {
  const parts = accelerator.split('+');
  const key = parts.pop();
  // Qt::Key and Qt::KeyboardModifier values used by KGlobalAccel's QKeySequence.
  const arrows = { Left: 0x01000012, Up: 0x01000013, Right: 0x01000014, Down: 0x01000015 };
  const modifiers = { CommandOrControl: 0x04000000, Shift: 0x02000000, Alt: 0x08000000 };
  return [parts.reduce((value, part) => value | modifiers[part], arrows[key] ?? key.charCodeAt(0)), 0, 0, 0];
}

async function changeKdeShortcuts(bus, appId, entries, requested) {
  const accel = (method, signature, args) => callGlobalAccel(bus, method, signature, args);
  const read = (id) => accel('shortcutKeys', 'as', [id]);
  const write = (id, keys) => accel('setForeignShortcutKeys', 'asa(ai)', [id, keys]);
  const keySet = (keys) => keys.map(([sequence]) => sequence.join(',')).sort().join(';');
  const sameKeys = (left, right) => keySet(left) === keySet(right);
  const changes = (await Promise.all(entries.filter(({ action }) => requested.has(action)).map(async (entry) => {
    const key = requested.get(entry.action);
    const actionId = kdeActionId(appId, entry);
    const original = await read(actionId);
    return { actionId, original, target: [[kdeKeySequence(key)]], key };
  }))).filter(({ original, target }) => !sameKeys(original, target));

  const changing = new Set(changes.map(({ actionId }) => actionId[1]));
  for (const { target, key } of changes) {
    const owners = await accel('globalShortcutsByKey', '(ai)(i)', [target[0], [0]]);
    const conflict = owners.find(([id, , component]) => component !== appId || !changing.has(id));
    if (conflict) throw new Error(`快捷键 ${key.replace('CommandOrControl', 'Ctrl')} 已被「${conflict[1]}」占用`);
  }

  // Release this app's changed bindings first so swapped keys can be restored.
  const attempted = [];
  try {
    for (const change of changes) {
      attempted.push(change);
      await write(change.actionId, []);
    }
    for (const { actionId, target } of changes) {
      await write(actionId, target);
      if (!sameKeys(await read(actionId), target)) throw new Error(`KDE 未能设置「${actionId[3]}」的快捷键`);
    }
  } catch (error) {
    for (const { actionId } of attempted) await write(actionId, []).catch(() => {});
    let restored = true;
    for (const { actionId, original } of attempted) {
      try {
        await write(actionId, original);
        if (!sameKeys(await read(actionId), original)) restored = false;
      } catch {
        restored = false;
      }
    }
    if (!restored) throw new Error('设置失败，部分原有快捷键未能恢复', { cause: error });
    throw error;
  }
}

function createKdeShortcutSession({ app, appId, onBound, onActivate }) {
  let profileId;
  let current;
  let pendingUpdate = Promise.resolve();
  let closing = Promise.resolve();

  function stop() {
    const previous = current;
    current = undefined;
    previous?.controller.abort();
    if (previous?.bus) closing = previous.bus.close();
    return closing;
  }

  function queueUpdate(update) {
    const state = current;
    const result = pendingUpdate.then(() => {
      if (state !== current) throw new Error('KDE 快捷键会话已关闭');
      return update(state);
    });
    pendingUpdate = result.catch(() => {});
    return result;
  }

  async function suspendShortcuts(state, next) {
    if (next === (state?.suspended ?? false)) return;
    if (!state?.refreshBindings) throw new Error('KDE 快捷键尚未注册，请稍后重试');
    const ids = state.entries.map(entry => kdeActionId(appId, entry));
    // Autoload + SetPresent restores KDE's saved keys without writing new assignments.
    const resume = id => callGlobalAccel(state.bus, 'setShortcutKeys', 'asa(ai)u', [id, [], SET_PRESENT]);
    const apply = next ? id => callGlobalAccel(state.bus, 'setInactive', 'as', [id]) : resume;
    const results = await Promise.allSettled(ids.map(apply));
    const failure = results.find(result => result.status === 'rejected');
    if (state !== current) throw new Error('KDE 快捷键会话已关闭');
    if (failure) {
      if (next) {
        const restored = await Promise.allSettled(ids.map(resume));
        state.suspended = restored.some(result => result.status === 'rejected');
      }
      throw failure.reason;
    }
    state.suspended = next;
  }

  function updateShortcuts(updates) {
    return queueUpdate(async (state) => {
      if (!state?.refreshBindings) throw new Error('KDE 快捷键尚未注册，请稍后重试');
      const { bus, entries, refreshBindings } = state;
      const requested = new Map(updates ?? entries.map(({ action, defaultKey }) => [action, defaultKey]));
      if (requested.size !== new Set(requested.values()).size) throw new Error('快捷键重复');
      for (const action of requested.keys()) {
        if (!entries.some(entry => entry.action === action)) throw new Error('该快捷键尚未在 KDE 注册');
      }
      await suspendShortcuts(state, false);
      await changeKdeShortcuts(bus, appId, entries, requested);
      await refreshBindings();
    });
  }

  return {
    async bind(shortcuts) {
      // Disconnecting releases the old Portal session before a new bind.
      const previous = stop();
      const state = current = { controller: new AbortController(), suspended: false };
      await previous;
      if (state !== current || !shortcuts.length) return;

      function finish(error) {
        if (state !== current) return;
        if (error) console.warn('[shortcuts]', error.message);
        const disconnected = stop();
        onBound(new Map());
        return disconnected;
      }

      try {
        const bus = state.bus = openSessionBus();
        bus.connection.once('close', error => { void finish(error); });
        profileId ??= getProfileId(app.getPath('userData'), appId);
        const usedKeys = new Set();
        state.entries = shortcuts.map(({ action, key, label, defaultKey }) => {
          const accelerator = key.trim();
          // Legacy duplicate or unsupported keys still need an ID so they can be edited or reset.
          const binding = isWaylandShortcutKey(accelerator) && !usedKeys.has(accelerator)
            ? portalBinding(accelerator, profileId) : { id: action };
          usedKeys.add(accelerator);
          return { action, label, defaultKey, ...binding };
        });
        state.refreshBindings = await bindPortalShortcuts(bus, appId, state.entries,
          bindings => { if (state === current) onBound(bindings); },
          action => { if (state === current) onActivate(action); },
          state.controller.signal);
      } catch (error) {
        await finish(error);
      }
    },
    setSuspended: next => queueUpdate(state => suspendShortcuts(state, next)),
    updateShortcuts,
    stop,
  };
}

async function runKdeWindowScript(title, operation) {
  const bus = openSessionBus();
  let owner;
  let directory;
  let scriptId;
  let timer;
  try {
    owner = await bus.getNameOwner(KWIN);
    const { promise: result, resolve } = Promise.withResolvers();
    await bus.export(RESULT_PATH, defineInterface({
      name: RESULT_INTERFACE,
      methods: {
        Report: {
          in: { json: 's' },
          handler: ({ json }, { sender }) => {
            if (sender === owner) resolve(json);
          },
        },
      },
    }));

    // Electron can emit 'show' before the Wayland surface is mapped.
    directory = await mkdtemp(join(tmpdir(), 'ia-kwin-'));
    const script = join(directory, 'window.js');
    await writeFile(script, `
      const timer = new QTimer();
      function apply() {
        const window = workspace.windowList().find(window =>
          window.pid === ${process.pid} && (window.captionNormal || window.caption) === ${JSON.stringify(title)}
        );
        if (!window) return;
        timer.stop();
        const result = (() => { ${operation} })();
        callDBus(${JSON.stringify(bus.name)}, "${RESULT_PATH}", "${RESULT_INTERFACE}", "Report", JSON.stringify(result));
      }
      timer.interval = 25;
      timer.timeout.connect(apply);
      timer.start();
      apply();
    `);
    scriptId = await call(bus, owner, '/Scripting', SCRIPTING, 'loadScript', 'ss', [script, basename(directory)]);
    if (scriptId < 0) throw new Error('KWin 无法加载窗口脚本');
    await call(bus, owner, `/Scripting/Script${scriptId}`, 'org.kde.kwin.Script', 'run');

    // run() acknowledges script execution separately from the script's result.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('KWin 未确认窗口属性')), 2000);
    });
    return JSON.parse(await Promise.race([result, timeout]));
  } finally {
    clearTimeout(timer);
    try {
      if (scriptId >= 0) {
        await call(bus, owner, '/Scripting', SCRIPTING, 'unloadScript', 's', [basename(directory)]).catch(() => {});
      }
    } finally {
      await bus.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
}

function moveKdeOverlayToCursor(title) {
  return runKdeWindowScript(title, `
    const cursor = workspace.cursorPos;
    const { width, height } = window.frameGeometry;
    window.frameGeometry = {
      x: Math.round(cursor.x - 20), y: Math.round(cursor.y - 20), width, height,
    };
    return true;
  `);
}

function setKdeWindowFlags(title, flags) {
  return runKdeWindowScript(title, `
    const actual = {};
    for (const [flag, enabled] of Object.entries(${JSON.stringify(flags)})) {
      const supported = typeof window[flag] === 'boolean';
      if (supported && enabled !== null) window[flag] = enabled;
      actual[flag] = supported ? window[flag] : null;
    }
    return actual;
  `);
}

module.exports = { createKdeShortcutSession, moveKdeOverlayToCursor, setKdeWindowFlags, portalBinding };
