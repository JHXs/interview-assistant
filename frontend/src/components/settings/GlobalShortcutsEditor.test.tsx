import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GlobalShortcutsEditor from './GlobalShortcutsEditor'
import { defaultShortcuts } from '@/lib/shortcuts'
import { useInterviewStore } from '@/stores/configStore'
import { subscribeToDesktopShortcuts, useShortcutsStore } from '@/stores/shortcutsStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function DesktopShortcutsEditor() {
  useEffect(subscribeToDesktopShortcuts, [])
  return <GlobalShortcutsEditor />
}

describe('GlobalShortcutsEditor', () => {
  let publishShortcuts: (shortcuts: typeof defaultShortcuts) => void

  beforeEach(() => {
    vi.clearAllMocks()
    useShortcutsStore.setState(useShortcutsStore.getInitialState())
    useInterviewStore.setState({ toastMessage: null } as any)
    ;(window as any).electronAPI = {
      getShortcuts: vi.fn().mockResolvedValue(defaultShortcuts),
      updateShortcuts: vi.fn().mockResolvedValue({ ok: true }),
      resetShortcuts: vi.fn().mockResolvedValue({ ok: true }),
      onShortcuts: vi.fn((listener: typeof publishShortcuts) => {
        publishShortcuts = listener
        return () => {}
      }),
    }
  })

  it('ignores rapid duplicate shortcut recordings while save is pending', async () => {
    const save = deferred<{ ok: true }>()
    window.electronAPI!.updateShortcuts = vi.fn().mockReturnValueOnce(save.promise)

    render(<DesktopShortcutsEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+B' }))
    expect(screen.getByRole('button', { name: '按下新快捷键…' })).toBeInTheDocument()

    const eventInit = {
      key: 'H',
      code: 'KeyH',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', eventInit))
      window.dispatchEvent(new KeyboardEvent('keydown', eventInit))
      await Promise.resolve()
    })

    expect(window.electronAPI!.updateShortcuts).toHaveBeenCalledTimes(1)
    expect(window.electronAPI!.updateShortcuts).toHaveBeenCalledWith([
      { action: 'hideOrShowWindow', key: 'CommandOrControl+H' },
    ])
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()

    await act(async () => {
      publishShortcuts({
        ...defaultShortcuts,
        hideOrShowWindow: { ...defaultShortcuts.hideOrShowWindow, key: 'CommandOrControl+H' },
      })
      save.resolve({ ok: true })
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ctrl+H' })).toBeInTheDocument())
  })

  it('ignores rapid duplicate shortcut resets while reset is pending', async () => {
    const reset = deferred<{ ok: true }>()
    window.electronAPI!.resetShortcuts = vi.fn().mockReturnValueOnce(reset.promise)

    render(<DesktopShortcutsEditor />)

    const resetButton = screen.getByRole('button', { name: '恢复默认快捷键' })
    act(() => {
      resetButton.click()
      resetButton.click()
    })

    expect(window.electronAPI!.resetShortcuts).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '重置中…' })).toBeDisabled()

    await act(async () => {
      reset.resolve({ ok: true })
    })

    expect(await screen.findByRole('button', { name: '恢复默认快捷键' })).toBeEnabled()
  })

  it('records and resets KDE bindings in the same editor', async () => {
    const kdeShortcuts = {
      ...defaultShortcuts,
      toggleInterviewOverlay: {
        ...defaultShortcuts.toggleInterviewOverlay,
        status: 'registered' as const,
        triggerDescription: 'Ctrl+Alt+O',
      },
    }
    window.electronAPI!.getShortcuts = vi.fn().mockResolvedValue(kdeShortcuts)
    const suspended = deferred<{ ok: boolean; suspended: boolean }>()
    window.electronAPI!.setShortcutsSuspended = vi.fn()
      .mockReturnValueOnce(suspended.promise)
      .mockResolvedValue({ ok: true, suspended: false })
    window.electronAPI!.updateShortcuts = vi.fn(async () => {
      publishShortcuts({
        ...kdeShortcuts,
        toggleInterviewOverlay: { ...kdeShortcuts.toggleInterviewOverlay, triggerDescription: 'Ctrl+Alt+H' },
      })
      return { ok: true } as const
    })
    render(<DesktopShortcutsEditor />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ctrl+Alt+O' }))
    expect(screen.getByText('已注册')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '准备录键…' })).toBeInTheDocument()
    const chord = { key: 'h', code: 'KeyH', ctrlKey: true, altKey: true }
    fireEvent.keyDown(window, chord)
    expect(window.electronAPI!.updateShortcuts).not.toHaveBeenCalled()

    await act(async () => suspended.resolve({ ok: true, suspended: true }))
    fireEvent.keyDown(window, chord)
    await screen.findByRole('button', { name: 'Ctrl+Alt+H' })
    expect(window.electronAPI!.updateShortcuts).toHaveBeenCalledWith([
      { action: 'toggleInterviewOverlay', key: 'CommandOrControl+Alt+H' },
    ])
    expect(window.electronAPI!.setShortcutsSuspended).toHaveBeenLastCalledWith(false)

    window.electronAPI!.resetShortcuts = vi.fn(async () => {
      publishShortcuts({
        ...kdeShortcuts,
        toggleInterviewOverlay: { ...kdeShortcuts.toggleInterviewOverlay, triggerDescription: 'Ctrl+O' },
      })
      return { ok: true } as const
    })
    fireEvent.click(screen.getByRole('button', { name: '恢复默认快捷键' }))
    expect(window.electronAPI!.resetShortcuts).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Ctrl+O' })).toBeInTheDocument()
  })

  it('shows the saved binding when a delayed Portal readback is published', async () => {
    const warning = '快捷键已保存，显示状态待刷新'
    window.electronAPI!.updateShortcuts = vi.fn().mockResolvedValue({ ok: true, warning })
    render(<DesktopShortcutsEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+B' }))
    fireEvent.keyDown(window, { key: 'h', code: 'KeyH', ctrlKey: true })

    await waitFor(() => expect(useInterviewStore.getState().toastMessage).toBe(warning))
    expect(screen.getByRole('button', { name: 'Ctrl+B' })).toBeEnabled()

    act(() => publishShortcuts({
      ...defaultShortcuts,
      hideOrShowWindow: {
        ...defaultShortcuts.hideOrShowWindow,
        status: 'registered',
        triggerDescription: 'Ctrl+H',
      },
    }))
    expect(screen.getByRole('button', { name: 'Ctrl+H' })).toBeEnabled()
  })

  it('cancels recording and restores shortcuts when the window loses focus', async () => {
    window.electronAPI!.setShortcutsSuspended = vi.fn().mockResolvedValue({ ok: true, suspended: true })
    render(<DesktopShortcutsEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+B' }))
    await screen.findByRole('button', { name: '按下新快捷键…' })
    fireEvent.blur(window)
    expect(screen.getByRole('button', { name: 'Ctrl+B' })).toBeInTheDocument()
    expect(window.electronAPI!.setShortcutsSuspended).toHaveBeenLastCalledWith(false)
    expect(window.electronAPI!.updateShortcuts).not.toHaveBeenCalled()
  })
})
