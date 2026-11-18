import { create } from 'zustand'
import {
  defaultShortcuts,
  mergeShortcutConfigs,
  type ShortcutAction,
  type ShortcutConfig,
} from '@/lib/shortcuts'

type ShortcutsState = {
  shortcuts: Record<ShortcutAction, ShortcutConfig>
  setShortcuts: (shortcuts: Record<string, Record<string, unknown>> | undefined) => void
  updateShortcut: (action: ShortcutAction, shortcut: ShortcutConfig) => void
  resetShortcuts: () => void
}

export const useShortcutsStore = create<ShortcutsState>((set) => ({
  shortcuts: defaultShortcuts,
  setShortcuts: (shortcuts) => set({ shortcuts: mergeShortcutConfigs(shortcuts) }),
  updateShortcut: (action, shortcut) =>
    set((state) => ({
      shortcuts: {
        ...state.shortcuts,
        [action]: shortcut,
      },
    })),
  resetShortcuts: () => set({ shortcuts: defaultShortcuts }),
}))

export function subscribeToDesktopShortcuts() {
  const api = window.electronAPI
  if (!api?.getShortcuts) return
  const { setShortcuts } = useShortcutsStore.getState()
  let useSnapshot = true
  const unsubscribe = api.onShortcuts?.((shortcuts) => {
    useSnapshot = false
    setShortcuts(shortcuts)
  })
  api.getShortcuts().then((shortcuts) => {
    if (useSnapshot) setShortcuts(shortcuts)
  }).catch(() => {})
  return () => {
    useSnapshot = false
    unsubscribe?.()
  }
}
