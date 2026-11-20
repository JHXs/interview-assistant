import { useState, useEffect, useRef } from 'react'
import { Section } from './shared'
import { useInterviewStore } from '@/stores/configStore'
import { useShortcutsStore } from '@/stores/shortcutsStore'
import {
  getShortcutAccelerator,
  getShortcutDisplay,
  type ShortcutAction,
} from '@/lib/shortcuts'

type RecordingPhase = 'preparing' | 'ready' | 'saving'

export default function GlobalShortcutsEditor() {
  const shortcuts = useShortcutsStore((s) => s.shortcuts)
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null)
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>('preparing')
  const [resetting, setResetting] = useState(false)
  const resettingRef = useRef(false)

  useEffect(() => {
    if (!recordingAction) return
    const api = window.electronAPI
    let active = true
    let phase: RecordingPhase = 'preparing'
    const setPhase = (next: RecordingPhase) => {
      phase = next
      setRecordingPhase(next)
    }
    const cancel = () => {
      if (phase !== 'saving') setRecordingAction(null)
    }
    const handleKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        cancel()
        return
      }
      if (phase !== 'ready') return
      const accelerator = getShortcutAccelerator(e)
      if (!accelerator || !api?.updateShortcuts) return
      setPhase('saving')
      try {
        const res = await api.updateShortcuts([
          { action: recordingAction, key: accelerator },
        ])
        useInterviewStore.getState().setToastMessage(
          res.ok === true ? res.warning || '快捷键已更新' : res.error || '快捷键保存失败',
        )
      } catch (err) {
        useInterviewStore.getState().setToastMessage(err instanceof Error ? err.message : '快捷键保存失败')
      } finally {
        if (active) setRecordingAction(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', cancel)
    if (api?.setShortcutsSuspended) {
      api.setShortcutsSuspended(true).then((result) => {
        if (!result.ok) throw new Error(result.error || '无法开始录制快捷键')
        if (active) setPhase('ready')
      }).catch((error) => {
        if (!active) return
        cancel()
        useInterviewStore.getState().setToastMessage(error instanceof Error ? error.message : '无法开始录制快捷键')
      })
    } else {
      setPhase('ready')
    }
    return () => {
      active = false
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', cancel)
      void api?.setShortcutsSuspended?.(false).catch(() => {})
    }
  }, [recordingAction])

  if (!window.electronAPI?.getShortcuts) return null

  const saving = Boolean(recordingAction) && recordingPhase === 'saving'

  const resetDefaults = async () => {
    if (!window.electronAPI?.resetShortcuts) return
    if (resettingRef.current) return
    resettingRef.current = true
    setResetting(true)
    try {
      const res = await window.electronAPI.resetShortcuts()
      useInterviewStore.getState().setToastMessage(
        res.ok === true ? res.warning || '已恢复默认快捷键' : res.error || '重置失败',
      )
    } catch (err) {
      useInterviewStore.getState().setToastMessage(err instanceof Error ? err.message : '重置失败')
    } finally {
      resettingRef.current = false
      setResetting(false)
    }
  }

  const statusTone = (status?: string) => {
    if (status === 'registered') return 'text-accent-green'
    if (status === 'failed') return 'text-accent-red'
    return 'text-text-muted'
  }

  const statusLabel = (status?: string) => {
    if (status === 'registered') return '已注册'
    if (status === 'failed') return '注册失败'
    if (status === 'unbound') return '未绑定'
    return '待注册'
  }

  return (
    <Section title="全局快捷键" keywords="hotkey shortcut 快捷键 alt ctrl cmd shift 截图">
      <div className="bg-bg-tertiary/30 rounded-lg p-3 text-xs text-text-muted leading-relaxed">
        必须以 <code className="px-1 py-0.5 rounded bg-bg-tertiary border border-bg-hover font-mono text-[11px]">⌘/Ctrl</code> 开头，可叠加 <code className="px-1 py-0.5 rounded bg-bg-tertiary border border-bg-hover font-mono text-[11px]">⇧Shift</code>、<code className="px-1 py-0.5 rounded bg-bg-tertiary border border-bg-hover font-mono text-[11px]">⌥Alt</code>。
        支持字母、数字、方向键等。点击某项后按新快捷键，<code className="px-1 py-0.5 rounded bg-bg-tertiary border border-bg-hover font-mono text-[11px]">Esc</code> 取消。系统或其他应用占用的组合键可能无法录入。
      </div>
      <div className="space-y-2">
        {Object.values(shortcuts).map((shortcut) => {
          const { action } = shortcut
          const isRecording = recordingAction === action
          return (
            <div
              key={action}
              className="flex items-center justify-between gap-3 rounded-xl border border-bg-hover bg-bg-primary/40 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">{shortcut.label}</div>
                <div className={`text-[10px] mt-0.5 ${statusTone(shortcut.status)}`}>
                  {statusLabel(shortcut.status)}
                </div>
              </div>
              <button
                type="button"
                disabled={saving || resetting}
                onClick={() => {
                  setRecordingPhase('preparing')
                  setRecordingAction(isRecording ? null : action)
                }}
                className={`min-w-[120px] rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  isRecording
                    ? 'border-accent-blue bg-accent-blue/10 text-accent-blue animate-pulse'
                    : 'border-bg-hover bg-bg-tertiary text-text-primary hover:border-accent-blue/40'
                }`}
              >
                {isRecording
                  ? { preparing: '准备录键…', ready: '按下新快捷键…', saving: '保存中…' }[recordingPhase]
                  : getShortcutDisplay(shortcut)}
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        disabled={resetting || Boolean(recordingAction)}
        onClick={resetDefaults}
        className="w-full py-2.5 text-xs font-medium rounded-xl border border-bg-hover text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
      >
        {resetting ? '重置中…' : '恢复默认快捷键'}
      </button>
    </Section>
  )
}
