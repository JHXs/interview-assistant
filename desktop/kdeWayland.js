const { execFile, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');

const SYSTEM_PYTHON = '/usr/bin/python3';
const WORKER = join(__dirname, 'kde_wayland.py');
const execFileAsync = promisify(execFile);

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

function createKdeShortcutSession({ app, appId, onBound, onActivate }) {
  let profileId;
  let child;
  let pending;
  let stopping = false;

  function start() {
    const entries = pending;
    pending = null;
    if (!entries?.length || stopping) return;
    const actions = new Map(entries.map(({ id, action }) => [id, action]));
    const worker = spawn(SYSTEM_PYTHON, [WORKER, 'bind-shortcuts']);
    child = worker;
    createInterface({ input: worker.stdout }).on('line', (line) => {
      if (pending || stopping) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        console.warn('[shortcuts] 无法读取 KDE 快捷键服务响应');
        return;
      }
      if (event.error) console.warn('[shortcuts]', event.error);
      if (event.bound) {
        onBound(new Set(event.bound.map((id) => actions.get(id))));
      }
      const action = actions.get(event.activated);
      if (action) onActivate(action);
    });
    worker.stderr.on('data', (chunk) => process.stderr.write(chunk));
    worker.stdin.on('error', () => {}); // The worker may exit before reading stdin.
    worker.on('error', (error) => console.warn('[shortcuts] 无法启动 KDE 快捷键服务:', error.message));
    worker.on('close', () => {
      child = null;
      if (pending) start();
      else if (!stopping) onBound(new Set());
    });
    worker.stdin.write(`${JSON.stringify({ appId, shortcuts: entries })}\n`);
  }

  return {
    bind(shortcuts) {
      profileId ??= getProfileId(app.getPath('userData'), appId);
      pending = shortcuts.map(({ action, key, label }) => ({
        action, label, ...portalBinding(key, profileId),
      }));
      // Let the old D-Bus connection close before creating another session.
      if (child) child.stdin.end();
      else start();
    },
    stop() {
      stopping = true;
      pending = null;
      child?.stdin.end();
    },
  };
}

async function moveKdeOverlayToCursor(title) {
  await execFileAsync(SYSTEM_PYTHON, [WORKER, 'move-overlay', String(process.pid), title], { timeout: 18000 });
}

module.exports = { createKdeShortcutSession, moveKdeOverlayToCursor, portalBinding };
