import { useState } from 'react'
import type { PersonalModel, PersonalProviderRecord } from '../../api/personal-configuration-types'
import { finishOperation, operationKey } from '../../api/personal-api'
import { usePersonal } from '../../state/PersonalContext'
import { useConfirmedAction } from './ConfirmedAction'
import styles from './personal.module.css'

const capabilities = ['chat', 'long_text', 'vision', 'image', 'video', 'audio', 'search', 'embedding']
export default function ModelManager({ providers, models, reload }: { providers: PersonalProviderRecord[]; models: PersonalModel[]; reload: () => Promise<boolean> }) {
  const [editing, setEditing] = useState<PersonalModel | 'new' | null>(null)
  return <section><h3>模型配置与默认任务</h3><p className={styles.hint}>能力声明只是保存配置，不代表已经实际调用验证。</p>
    <button type="button" onClick={() => setEditing('new')}>新增模型</button>
    {models.length === 0 && <p>尚未配置模型。</p>}
    <div className={styles.grid}>{models.map((model) => <article key={model.modelId} className={styles.item}><strong>{model.modelName}</strong><p>{model.capabilities.join(' · ')}</p><p>配置：{model.status} · 默认聊天：{model.defaultForChat ? '是' : '否'}</p><button type="button" onClick={() => setEditing(model)}>编辑模型</button></article>)}</div>
    {editing && <ModelForm key={editing === 'new' ? 'new' : `${editing.modelId}:${editing.version}`} model={editing === 'new' ? null : editing} providers={providers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
  </section>
}

function ModelForm({ model, providers, onClose, onSaved }: { model: PersonalModel | null; providers: PersonalProviderRecord[]; onClose: () => void; onSaved: () => void }) {
  const { api, scope, state } = usePersonal()
  const action = useConfirmedAction(`${scope}:${model?.modelId ?? 'new-model'}`)
  const [providerId, setProviderId] = useState(model?.providerId ?? providers[0]?.providerId ?? '')
  const [modelName, setModelName] = useState(model?.modelName ?? '')
  const [modelType, setModelType] = useState(model?.modelType ?? 'chat')
  const [selected, setSelected] = useState(model?.capabilities ?? ['chat'])
  const [costDescription, setCostDescription] = useState(model?.costDescription ?? '')
  const [status, setStatus] = useState(model?.status ?? 'enabled')
  const [defaultForChat, setDefault] = useState(model?.defaultForChat ?? false)
  const user = state.kind === 'ready' ? state.session.user.userId : ''
  const busy = action.busy || Boolean(action.confirmation)
  return <form className={styles.item} noValidate onSubmit={(e) => {
    e.preventDefault()
    if (!providerId || !modelName.trim() || !modelType.trim() || !selected.length) { action.setError('请选择供应商，填写模型名称/类型，并选择至少一项能力。'); return }
    if (defaultForChat && !selected.includes('chat')) { action.setError('默认聊天模型必须声明 chat 能力。'); return }
    const operation = model ? `update-model/${model.modelId}` : 'create-model'
    const key = operationKey(user, operation)
    const body = { modelName: modelName.trim(), modelType: modelType.trim(), capabilities: selected, costDescription, defaultForChat,
      ...(model ? { expectedVersion: model.version, status } : { providerId }) }
    void action.execute({ label: model ? '修改模型配置' : '新增模型配置',
      work: (signal, confirmationId) => api.request(model ? `/models/${encodeURIComponent(model.modelId)}` : '/models', model ? 'PATCH' : 'POST', { ...body, ...(confirmationId ? { confirmationId } : {}) }, { signal, idempotencyKey: key }),
      cancel: (signal) => api.cancelOperation({ operation, key }, { signal }),
      onCancelled: () => finishOperation(user, operation, key),
      accept: () => { finishOperation(user, operation, key); onSaved() } })
  }}>
    <h3>{model ? '编辑模型配置' : '新增模型配置'}</h3>
    {!model && <label className={styles.field}>模型供应商<select value={providerId} disabled={busy} onChange={(e) => setProviderId(e.target.value)}><option value="">请选择已保存的供应商</option>{providers.map((provider) => <option value={provider.providerId} key={provider.providerId}>{provider.displayName}</option>)}</select></label>}
    <label className={styles.field}>模型名称<input value={modelName} maxLength={160} disabled={busy} onChange={(e) => setModelName(e.target.value)} /></label>
    <label className={styles.field}>模型类型<input value={modelType} maxLength={80} disabled={busy} onChange={(e) => setModelType(e.target.value)} /></label>
    <fieldset className={styles.checks} disabled={busy}><legend>模型能力声明</legend>{capabilities.map((capability) => <label key={capability}><input type="checkbox" checked={selected.includes(capability)} onChange={(e) => setSelected((items) => e.target.checked ? [...items, capability] : items.filter((item) => item !== capability))} />{capability}</label>)}</fieldset>
    <label className={styles.field}>费用说明<textarea value={costDescription} maxLength={2000} disabled={busy} onChange={(e) => setCostDescription(e.target.value)} /></label>
    {model && <label className={styles.field}>模型启用状态<select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value as 'enabled' | 'disabled')}><option value="enabled">启用</option><option value="disabled">停用</option></select></label>}
    <label><input type="checkbox" checked={defaultForChat} disabled={busy} onChange={(e) => setDefault(e.target.checked)} />作为默认聊天模型</label>
    <div className={styles.actions}><button type="submit" disabled={busy}>保存模型配置</button><button type="button" disabled={busy} onClick={() => { action.cancel(); onClose() }}>取消模型编辑</button></div>
    {action.controls}
  </form>
}
