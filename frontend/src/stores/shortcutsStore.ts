import { create } from 'zustand'
import { defaultShortcuts, mergeShortcutConfigs } from '@/lib/shortcuts'

export const useShortcutsStore = create(() => ({
  shortcuts: defaultShortcuts,
}))

export function subscribeToDesktopShortcuts() {
  const api = window.electronAPI
  if (!api?.getShortcuts) return
  const setShortcuts = (shortcuts: Parameters<typeof mergeShortcutConfigs>[0]) => {
    useShortcutsStore.setState({ shortcuts: mergeShortcutConfigs(shortcuts) })
  }
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
