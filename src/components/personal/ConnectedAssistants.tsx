import { useCallback, useEffect, useState } from 'react'
import AssistantManager from '../assistant-management/AssistantManager'
import { emptyAssistantSettings, finishOperation, operationKey } from '../../api/personal-api'
import type { PersonalAssistant } from '../../api/personal-api'
import { usePersonal } from '../../state/PersonalContext'
import { AvatarField, Panel, Status } from './PersonalFields'
import { AssistantSettingsFields } from './PreferenceFields'
import { useScopedAction } from './useScopedAction'
import styles from './personal.module.css'

export default function ConnectedAssistants() {
  const { api, scope, state, assistants, guarded, reloadAssistants } = usePersonal()
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const userId = state.kind === 'ready' ? state.session.user.userId : ''
  const reload = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading')
    try { await reloadAssistants(signal); if (!signal?.aborted) setStatus('ready') }
    catch (error) { if (!signal?.aborted) setStatus('error'); throw error }
  }, [reloadAssistants])
  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => { if (!controller.signal.aborted) void reload(controller.signal).catch(() => {}) })
    return () => controller.abort()
  }, [reload, scope])
  const current = assistants?.items.find((item) => item.assistantId === assistants.currentAssistantId)
  return <>
    <AssistantManager contextKey={scope} data={status === 'ready' && assistants
      ? { contextKey: scope, status: 'ready', assistants: assistants.items.map((item) => ({ subjectId: item.assistantId, name: item.name })), currentAssistantId: assistants.currentAssistantId }
      : { contextKey: scope, status: status === 'error' ? 'error' : 'loading' }}
      onReload={({ signal }) => reload(signal)}
      onCreate={async (input, { signal }) => {
        const key = operationKey(userId, 'create-assistant')
        await guarded((owned) => api.createAssistant({ name: input.name, avatar: null, settings: { ...emptyAssistantSettings } }, { signal: owned, idempotencyKey: key }), signal)
        await reload(signal)
        // Clear only after both the mutation AND the authoritative reread succeed.
        finishOperation(userId, 'create-assistant')
      }}
      onSelect={async (assistantId, { signal }) => {
        if (!assistants) return
        await guarded((owned) => api.selectAssistant({ assistantId, expectedSelectionVersion: assistants.selectionVersion }, { signal: owned }), signal)
        await reload(signal)
      }} />
    {status === 'ready' && current && <AssistantEditor key={current.assistantId} id={current.assistantId} />}
  </>
}

function AssistantEditor({ id }: { id: string }) {
  const { api, scope, guarded, reloadAssistants } = usePersonal()
  const task = useScopedAction(`${scope}:${id}`)
  const [assistant, setAssistant] = useState<PersonalAssistant | null>(null)
  const load = useCallback(() => task.run((signal) => guarded((owned) => api.assistant(id, { signal: owned }), signal), setAssistant), [api, guarded, id, task.run])
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load() }); return () => { active = false } }, [load])
  return <Panel title="当前助手设置"><button type="button" disabled={task.busy} onClick={() => void load()}>重新读取助手设置</button>
    <Status {...task} />
    {assistant && <AssistantForm key={`${id}:${assistant.version}`} assistant={assistant} save={async (value, signal) => {
      const saved = await guarded((owned) => api.updateAssistant(id, value, { signal: owned }), signal)
      await reloadAssistants(signal)
      setAssistant(saved)
    }} />}
  </Panel>
}

function AssistantForm({ assistant, save }: { assistant: PersonalAssistant; save: (value: { name: string; avatar: string | null; settings: PersonalAssistant['settings']; expectedVersion: number }, signal: AbortSignal) => Promise<void> }) {
  const task = useScopedAction(`${assistant.assistantId}:${assistant.version}`)
  const [name, setName] = useState(assistant.name)
  const [avatar, setAvatar] = useState(assistant.avatar)
  const [settings, setSettings] = useState({ ...emptyAssistantSettings, ...assistant.settings })
  return <form noValidate onSubmit={(e) => { e.preventDefault(); if (!name.trim() || name.trim().length > 80) { task.setError('请输入 1–80 字的助手名称。'); return }
    void task.run((signal) => save({ name: name.trim(), avatar, settings, expectedVersion: assistant.version }, signal)) }}>
    <label className={styles.field}>助手名字<input value={name} maxLength={80} disabled={task.busy} onChange={(e) => setName(e.target.value)} /></label>
    <AvatarField label="助手头像" value={avatar} onChange={setAvatar} disabled={task.busy} />
    <AssistantSettingsFields value={settings} onChange={setSettings} disabled={task.busy} />
    <p className={styles.hint}>设定保存到当前助手；上下文仅为偏好，执行机制在后续阶段实现。</p>
    <div className={styles.actions}><button type="submit" disabled={task.busy}>保存助手设置</button><button type="button" onClick={() => { task.cancel(); setName(assistant.name); setAvatar(assistant.avatar); setSettings({ ...emptyAssistantSettings, ...assistant.settings }) }}>取消修改</button></div>
    <Status {...task} />
  </form>
}
