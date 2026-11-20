import type { OverlayStatePayload } from '@/lib/interviewOverlay'

type DesktopShortcuts = Record<string, Record<string, unknown>>
type ShortcutUpdateResult = { ok: true; warning?: string } | { ok: false; error?: string }

export {}

declare global {
  interface Window {
    electronAPI?: {
    hideWindow: () => Promise<void>
    minimizeWindow: () => Promise<void>
    quitApp: () => Promise<void>
    showWindow: () => Promise<void>
      getShortcuts: () => Promise<DesktopShortcuts>
      updateShortcuts: (shortcuts: Array<{ action: string; key: string }>) => Promise<ShortcutUpdateResult>
      resetShortcuts: () => Promise<ShortcutUpdateResult>
      toggleAlwaysOnTop: () => Promise<boolean>
      toggleContentProtection: () => Promise<boolean>
      getWindowState: () => Promise<{ alwaysOnTop: boolean; contentProtection: boolean; visible: boolean }>
      syncOverlayWindow?: (payload: Partial<OverlayStatePayload> & { visible?: boolean }) => Promise<{ ok: boolean; visible: boolean }>
      resizeOverlayWindow?: (payload: { width?: number; height?: number }) => Promise<{ ok: boolean; width?: number; height?: number; skipped?: boolean }>
      setShortcutsSuspended?: (on: boolean) => Promise<{ ok: boolean; suspended: boolean; error?: string }>
      destroyOverlay?: () => Promise<{ ok: boolean }>
      moveOverlayWindow?: (dx: number, dy: number) => Promise<void>
      overlayDragStart?: () => void
      overlayDragEnd?: () => void
      getOverlayState?: () => Promise<(OverlayStatePayload & { visible: boolean }) | null>
      onOverlayState?: (callback: (payload: OverlayStatePayload) => void) => (() => void)
      onShortcuts?: (callback: (payload: DesktopShortcuts) => void) => (() => void)
      onFocusTabCommand?: (callback: (direction: 'prev' | 'next') => void) => (() => void)
      onOverlayQuestionCommand?: (callback: (direction: 'prev' | 'next') => void) => (() => void)
      onDesktopToast?: (callback: (payload: { message: string; level?: 'info' | 'success' | 'warn' | 'error' } | string) => void) => (() => void)
      onConfigUpdated?: (callback: (payload: Record<string, unknown>) => void) => (() => void)
      removeOverlayStateListener?: (listener?: (...args: unknown[]) => void) => void
    }
  }
}
