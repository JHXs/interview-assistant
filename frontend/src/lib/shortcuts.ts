export type ShortcutAction =
  | 'hideOrShowWindow'
  | 'hardClearSession'
  | 'askFromServerScreen'
  | 'cancelAnswer'
  | 'addMultiServerScreenShot'
  | 'toggleInterviewOverlay'
  | 'moveOverlayToMouse'
  | 'focusPrevTab'
  | 'focusNextTab'
  | 'overlayPrevQuestion'
  | 'overlayNextQuestion'
  | 'askScreenForceThink'
  | 'askScreenForceNoThink'
  | 'toggleThinkMode'
export type ShortcutStatus = 'registered' | 'failed' | 'available' | 'unbound'

export type ShortcutConfig = {
  action: ShortcutAction
  key: string
  defaultKey: string
  label: string
  category: string
  status?: ShortcutStatus
  triggerDescription?: string | null
}

export const defaultShortcuts: Record<ShortcutAction, ShortcutConfig> = {
  hideOrShowWindow: {
    action: 'hideOrShowWindow',
    key: 'CommandOrControl+B',
    defaultKey: 'CommandOrControl+B',
    label: '隐藏/显示窗口',
    category: '窗口',
    status: 'available',
  },
  hardClearSession: {
    action: 'hardClearSession',
    key: 'CommandOrControl+.',
    defaultKey: 'CommandOrControl+.',
    label: '硬清空',
    category: '实时辅助',
    status: 'available',
  },
  askFromServerScreen: {
    action: 'askFromServerScreen',
    key: 'CommandOrControl+/',
    defaultKey: 'CommandOrControl+/',
    label: '服务端截图审题',
    category: '实时辅助',
    status: 'available',
  },
  cancelAnswer: {
    action: 'cancelAnswer',
    key: 'CommandOrControl+Escape',
    defaultKey: 'CommandOrControl+Escape',
    label: '取消生成',
    category: '实时辅助',
    status: 'available',
  },
  addMultiServerScreenShot: {
    action: 'addMultiServerScreenShot',
    key: 'CommandOrControl+Shift+/',
    defaultKey: 'CommandOrControl+Shift+/',
    label: '多图截图判题',
    category: '实时辅助',
    status: 'available',
  },
  toggleInterviewOverlay: {
    action: 'toggleInterviewOverlay',
    key: 'CommandOrControl+O',
    defaultKey: 'CommandOrControl+O',
    label: '显示/隐藏悬浮窗',
    category: '实时辅助',
    status: 'available',
  },
  moveOverlayToMouse: {
    action: 'moveOverlayToMouse',
    key: 'CommandOrControl+M',
    defaultKey: 'CommandOrControl+M',
    label: '移动悬浮窗到鼠标位置',
    category: '实时辅助',
    status: 'available',
  },
  focusPrevTab: {
    action: 'focusPrevTab',
    key: 'CommandOrControl+Left',
    defaultKey: 'CommandOrControl+Left',
    label: '专注面板上一栏',
    category: '专注面板',
    status: 'available',
  },
  focusNextTab: {
    action: 'focusNextTab',
    key: 'CommandOrControl+Right',
    defaultKey: 'CommandOrControl+Right',
    label: '专注面板下一栏',
    category: '专注面板',
    status: 'available',
  },
  overlayPrevQuestion: {
    action: 'overlayPrevQuestion',
    key: 'CommandOrControl+Up',
    defaultKey: 'CommandOrControl+Up',
    label: '悬浮窗上一题',
    category: '悬浮窗',
    status: 'available',
  },
  overlayNextQuestion: {
    action: 'overlayNextQuestion',
    key: 'CommandOrControl+Down',
    defaultKey: 'CommandOrControl+Down',
    label: '悬浮窗下一题',
    category: '悬浮窗',
    status: 'available',
  },
  askScreenForceThink: {
    action: 'askScreenForceThink',
    key: 'CommandOrControl+Alt+/',
    defaultKey: 'CommandOrControl+Alt+/',
    label: '截图审题（强制思考）',
    category: '实时辅助',
    status: 'available',
  },
  askScreenForceNoThink: {
    action: 'askScreenForceNoThink',
    key: 'CommandOrControl+Alt+.',
    defaultKey: 'CommandOrControl+Alt+.',
    label: '截图审题（强制非思考）',
    category: '实时辅助',
    status: 'available',
  },
  toggleThinkMode: {
    action: 'toggleThinkMode',
    key: 'CommandOrControl+Shift+T',
    defaultKey: 'CommandOrControl+Shift+T',
    label: '切换思考模式',
    category: '实时辅助',
    status: 'available',
  },
}

const supportedPhysicalKeys = new Map<string, string>([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((key) => [`Key${key}`, key] as const),
  ...'0123456789'.split('').map((digit) => [`Digit${digit}`, digit] as const),
  ['Period', '.'],
  ['Slash', '/'],
  ['Backslash', '\\'],
  ['Minus', '-'],
  ['Equal', '='],
  ['Comma', ','],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backquote', '`'],
  ['Enter', 'Enter'],
  ['Escape', 'Escape'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
])

export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.platform)
}

export function getShortcutAccelerator(event: KeyboardEvent): string | null {
  if (!(event.metaKey || event.ctrlKey)) return null
  const key = supportedPhysicalKeys.get(event.code)
  if (!key) return null
  const parts: string[] = ['CommandOrControl']
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  parts.push(key)
  return parts.join('+')
}

const KEY_DISPLAY: Record<string, string> = {
  Enter: 'Enter',
  Escape: 'Esc',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
}

export function getShortcutDisplay(shortcut: ShortcutConfig) {
  if (shortcut.triggerDescription !== undefined) {
    return shortcut.triggerDescription ?? '未绑定'
  }
  const parts = shortcut.key.split('+')
  const ctrl = isMacPlatform() ? '⌘' : 'Ctrl'
  const shiftSym = isMacPlatform() ? '⇧' : 'Shift'
  const altSym = isMacPlatform() ? '⌥' : 'Alt'
  const out: string[] = []
  for (const p of parts) {
    if (p === 'CommandOrControl') out.push(ctrl)
    else if (p === 'Shift') out.push(shiftSym)
    else if (p === 'Alt') out.push(altSym)
    else out.push(KEY_DISPLAY[p] ?? p)
  }
  return out.join(isMacPlatform() ? '' : '+')
}

const SHORTCUT_STATUSES = new Set<unknown>(['registered', 'failed', 'available', 'unbound'])
const SUPPORTED_KEY_RE = /^CommandOrControl(\+Shift)?(\+Alt)?\+([A-Za-z0-9./\\\- =;,'`\[\]\{\}]|Enter|Escape|Up|Down|Left|Right)$/

export function mergeShortcutConfigs(
  input: Record<string, Partial<ShortcutConfig> | Record<string, unknown>> | undefined,
) {
  const merged = { ...defaultShortcuts }
  for (const [action, shortcut] of Object.entries(input || {})) {
    if (!Object.prototype.hasOwnProperty.call(defaultShortcuts, action)) continue
    if (!shortcut || typeof shortcut !== 'object') continue
    const s = shortcut as Record<string, unknown>
    const key = typeof s.key === 'string' ? s.key.trim() : ''
    if (SUPPORTED_KEY_RE.test(key)) {
      merged[action as ShortcutAction] = {
        ...merged[action as ShortcutAction],
        key,
        status: SHORTCUT_STATUSES.has(s.status) ? s.status as ShortcutStatus : undefined,
        triggerDescription: typeof s.triggerDescription === 'string'
          ? s.triggerDescription
          : s.triggerDescription === null ? null : undefined,
      }
    }
  }
  return merged
}
