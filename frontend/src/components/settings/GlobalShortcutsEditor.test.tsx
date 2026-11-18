import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GlobalShortcutsEditor from './GlobalShortcutsEditor'
import { defaultShortcuts } from '@/lib/shortcuts'
import { useInterviewStore } from '@/stores/configStore'
import { useShortcutsStore } from '@/stores/shortcutsStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('GlobalShortcutsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useShortcutsStore.getState().resetShortcuts()
    useInterviewStore.setState({ toastMessage: null } as any)
    ;(window as any).electronAPI = {
      getShortcuts: vi.fn().mockResolvedValue(defaultShortcuts),
      updateShortcuts: vi.fn().mockResolvedValue({ ok: true, shortcuts: defaultShortcuts }),
      resetShortcuts: vi.fn().mockResolvedValue({ ok: true, shortcuts: defaultShortcuts }),
    }
  })

  it('ignores rapid duplicate shortcut recordings while save is pending', async () => {
    const save = deferred<{ ok: boolean; shortcuts: Record<string, any> }>()
    window.electronAPI!.updateShortcuts = vi.fn().mockReturnValueOnce(save.promise)

    render(<GlobalShortcutsEditor />)

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
      save.resolve({
        ok: true,
        shortcuts: {
          ...defaultShortcuts,
          hideOrShowWindow: {
            ...defaultShortcuts.hideOrShowWindow,
            key: 'CommandOrControl+H',
          },
        },
      })
      await save.promise
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ctrl+H' })).toBeInTheDocument())
  })

  it('ignores rapid duplicate shortcut resets while reset is pending', async () => {
    const reset = deferred<{ ok: boolean; shortcuts: Record<string, any> }>()
    window.electronAPI!.resetShortcuts = vi.fn().mockReturnValueOnce(reset.promise)

    render(<GlobalShortcutsEditor />)

    const resetButton = screen.getByRole('button', { name: '恢复默认快捷键' })
    act(() => {
      resetButton.click()
      resetButton.click()
    })

    expect(window.electronAPI!.resetShortcuts).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '重置中…' })).toBeDisabled()

    await act(async () => {
      reset.resolve({ ok: true, shortcuts: defaultShortcuts })
      await reset.promise
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
    useShortcutsStore.getState().setShortcuts(kdeShortcuts)
    const suspended = deferred<{ ok: boolean; suspended: boolean }>()
    window.electronAPI!.setShortcutsSuspended = vi.fn()
      .mockReturnValueOnce(suspended.promise)
      .mockResolvedValue({ ok: true, suspended: false })
    const edited = {
      ...kdeShortcuts,
      toggleInterviewOverlay: { ...kdeShortcuts.toggleInterviewOverlay, triggerDescription: 'Ctrl+Alt+H' },
    }
    window.electronAPI!.updateShortcuts = vi.fn().mockResolvedValue({ ok: true, shortcuts: edited })
    render(<GlobalShortcutsEditor />)

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

    window.electronAPI!.resetShortcuts = vi.fn().mockResolvedValue({
      ok: true,
      shortcuts: {
        ...kdeShortcuts,
        toggleInterviewOverlay: { ...kdeShortcuts.toggleInterviewOverlay, triggerDescription: 'Ctrl+O' },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '恢复默认快捷键' }))
    expect(window.electronAPI!.resetShortcuts).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Ctrl+O' })).toBeInTheDocument()
  })

  it('cancels recording and restores shortcuts when the window loses focus', async () => {
    window.electronAPI!.setShortcutsSuspended = vi.fn().mockResolvedValue({ ok: true, suspended: true })
    render(<GlobalShortcutsEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+B' }))
    await screen.findByRole('button', { name: '按下新快捷键…' })
    fireEvent.blur(window)
    expect(screen.getByRole('button', { name: 'Ctrl+B' })).toBeInTheDocument()
    expect(window.electronAPI!.setShortcutsSuspended).toHaveBeenLastCalledWith(false)
    expect(window.electronAPI!.updateShortcuts).not.toHaveBeenCalled()
  })
})
