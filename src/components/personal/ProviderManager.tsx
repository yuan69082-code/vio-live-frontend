import { useCallback, useEffect, useRef, useState } from 'react'
import { finishOperation, operationKey } from '../../api/personal-api'
import type { Vault } from '../../api/personal-api'
import type { ConnectionTest, PersonalModel, PersonalProviderRecord } from '../../api/personal-configuration-types'
import { sealCredential } from '../../api/seal-credential'
import { usePersonal } from '../../state/PersonalContext'
import { Panel, Status } from './PersonalFields'
import { useScopedAction } from './useScopedAction'
import { useConfirmedAction } from './ConfirmedAction'
import ModelManager from './ModelManager'
import styles from './personal.module.css'

export default function ProviderManager() {
  const { api, scope, guarded } = usePersonal()
  const task = useScopedAction(scope)
  const [providers, setProviders] = useState<PersonalProviderRecord[] | null>(null)
  const [models, setModels] = useState<PersonalModel[]>([])
  const [editing, setEditing] = useState<PersonalProviderRecord | 'new' | null>(null)
  const load = useCallback(() => task.run((signal) => guarded(async (owned) => {
    const providers = await api.request<{ items: PersonalProviderRecord[] }>('/providers', 'GET', undefined, { signal: owned })
    const models = await api.request<{ items: PersonalModel[] }>('/models', 'GET', undefined, { signal: owned })
    return { providers, models }
  }, signal), (value) => { setProviders(value.providers.items); setModels(value.models.items) }), [api, guarded, task.run])
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load() }); return () => { active = false } }, [load])
  return <div className={styles.page}><Panel title="模型 / API">
    <p className={styles.hint}>配置来自当前服务端。已保存配置不等于连接成功；连接测试仅验证认证与模型列表，不发起文本生成。</p>
    <div className={styles.actions}><button type="button" disabled={task.busy} onClick={() => void load()}>刷新供应商与模型</button>
      <button type="button" onClick={() => setEditing('new')}>新增服务</button></div>
    <Status {...task} />
    {providers?.length === 0 && <p>尚未配置供应商。</p>}
    {editing && <ProviderForm key={editing === 'new' ? 'new' : editing.providerId} provider={editing === 'new' ? null : editing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    <div className={styles.grid}>{providers?.map((provider) => <article className={styles.item} key={`${provider.providerId}:${provider.version}`}>
      <h3>{provider.displayName}</h3><dl><dt>Base URL</dt><dd>{provider.baseUrl}</dd><dt>接口</dt><dd>{provider.interfaceFormat}</dd><dt>配置状态（不是连接状态）</dt><dd>{provider.status}</dd></dl>
      <button type="button" onClick={() => setEditing(provider)}>编辑供应商</button>
      <CredentialControls provider={provider} reload={load} />
    </article>)}</div>
    {providers && <ModelManager providers={providers} models={models} reload={load} />}
  </Panel><VaultUnlock /></div>
}

function ProviderForm({ provider, onSaved, onClose }: { provider: PersonalProviderRecord | null; onSaved: () => void; onClose: () => void }) {
  const { api, scope, state } = usePersonal()
  const action = useConfirmedAction(`${scope}:${provider?.providerId ?? 'new'}`)
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '')
  const [providerType, setProviderType] = useState(provider?.providerType ?? 'custom')
  const [status, setStatus] = useState(provider?.status ?? 'enabled')
  const user = state.kind === 'ready' ? state.session.user.userId : ''
  const operation = provider ? `update-provider/${provider.providerId}` : 'create-provider'
  return <form className={styles.item} noValidate onSubmit={(e) => {
    e.preventDefault()
    if (!displayName.trim() || !baseUrl.trim()) { action.setError('请填写供应商名称和 Base URL。'); return }
    try { const url = new URL(baseUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error() }
    catch { action.setError('Base URL 必须是无凭据、查询参数和片段的 HTTP(S) 地址。'); return }
    const body = { displayName: displayName.trim(), baseUrl: baseUrl.trim(), interfaceFormat: 'openai_compatible', status,
      ...(provider ? { expectedVersion: provider.version } : { providerType }) }
    const key = operationKey(user, operation)
    void action.execute({ label: provider ? '修改供应商配置' : '新增供应商',
      work: (signal, confirmationId) => api.request(provider ? `/providers/${encodeURIComponent(provider.providerId)}` : '/providers', provider ? 'PATCH' : 'POST', { ...body, ...(confirmationId ? { confirmationId } : {}) }, { signal, idempotencyKey: key }),
      cancel: (signal) => api.cancelOperation({ operation, key }, { signal }),
      onCancelled: () => finishOperation(user, operation, key),
      accept: () => { finishOperation(user, operation, key); onSaved() } })
  }}>
    <h3>{provider ? '编辑供应商配置' : '新增供应商配置'}</h3>
    <label className={styles.field}>供应商名称<input value={displayName} maxLength={160} disabled={action.busy || Boolean(action.confirmation)} onChange={(e) => setDisplayName(e.target.value)} /></label>
    <label className={styles.field}>Base URL<input type="url" value={baseUrl} maxLength={2048} disabled={action.busy || Boolean(action.confirmation)} onChange={(e) => setBaseUrl(e.target.value)} /></label>
    {!provider && <label className={styles.field}>供应商分类<select value={providerType} disabled={action.busy || Boolean(action.confirmation)} onChange={(e) => setProviderType(e.target.value)}><option value="custom">自定义服务</option><option value="openai">OpenAI 兼容服务</option></select></label>}
    <p className={styles.hint}>本阶段支持 OpenAI-compatible 接口；不代表任意品牌、模型或生成能力已验证。</p>
    <label className={styles.field}>配置启用状态<select value={status} disabled={action.busy || Boolean(action.confirmation)} onChange={(e) => setStatus(e.target.value as 'enabled' | 'disabled')}><option value="enabled">启用</option><option value="disabled">停用</option></select></label>
    <div className={styles.actions}><button type="submit" disabled={action.busy || Boolean(action.confirmation)}>保存供应商</button><button type="button" disabled={action.busy || Boolean(action.confirmation)} onClick={() => { action.cancel(); onClose() }}>取消编辑供应商</button></div>
    {action.controls}
  </form>
}

function CredentialControls({ provider, reload }: { provider: PersonalProviderRecord; reload: () => Promise<boolean> }) {
  const { api, scope, state, guarded } = usePersonal()
  const action = useConfirmedAction(`${scope}:${provider.providerId}`)
  const preparation = useScopedAction(`${scope}:${provider.providerId}:encryption`)
  const [keyInput, setKeyInput] = useState('')
  const [test, setTest] = useState<ConnectionTest | null>(null)
  const encrypted = useRef<Awaited<ReturnType<typeof sealCredential>> | null>(null)
  useEffect(() => () => { encrypted.current = null }, [])
  const user = state.kind === 'ready' ? state.session.user.userId : ''
  const path = `/providers/${encodeURIComponent(provider.providerId)}`
  const credential = provider.credentials.apiKey
  const busy = action.busy || preparation.busy || Boolean(action.confirmation)
  function saveCredential() {
    if (busy) return
    if (!keyInput && !encrypted.current) { preparation.setError('请先输入密钥。'); return }
    let secret = keyInput
    setKeyInput('')
    void preparation.run(async (signal) => {
      if (encrypted.current && !secret) return encrypted.current
      try {
        const vault = await guarded((owned) => api.vault({ signal: owned }), signal)
        return await sealCredential(secret, vault.transport)
      } finally { secret = '' }
    }, (sealed) => {
      encrypted.current = sealed
      const operation = `save-credential/${provider.providerId}`
      const key = operationKey(user, operation)
      void action.execute({ label: '保存或轮换供应商密钥', work: (signal, confirmationId) => api.request(`${path}/credential`, 'PUT', { ...sealed, ...(confirmationId ? { confirmationId } : {}) }, { signal, idempotencyKey: key }),
        cancel: (signal) => api.cancelOperation({ operation, key }, { signal }),
        onCancelled: () => { setKeyInput(''); encrypted.current = null; finishOperation(user, operation, key) },
        accept: () => { encrypted.current = null; finishOperation(user, operation, key); void reload() } })
    })
  }
  function recoverOperation(operation: string, key: string, accept: (result: Record<string, unknown>) => boolean | void) {
    // Recovery keeps the original server key, but no longer needs an old sealed-payload closure.
    setKeyInput('')
    encrypted.current = null
    action.clearPending()
    void preparation.run((signal) => guarded((owned) => api.operation(operation, key, { signal: owned }), signal), (value) => {
      if (value.status === 'completed' && value.result) { if (accept(value.result) !== false) finishOperation(user, operation, key) }
      else if (value.status === 'confirmation_required') preparation.setError(operation.startsWith('save-credential/')
        ? '上次密钥保存仍等待安全确认；本地输入及临时密文已清除，原操作标识保留。请先取消上次待处理密钥保存，再重新输入。'
        : '上次操作仍等待安全确认；请再次发起同一操作以恢复确认，继续沿用原操作标识。')
      else if (value.status === 'cancelled') { setKeyInput(''); encrypted.current = null; finishOperation(user, operation, key); preparation.setNotice('上次操作已取消，可以重新发起。') }
      else preparation.setNotice('没有找到待恢复的服务端操作。')
    })
  }
  const credentialOperation = `save-credential/${provider.providerId}`
  const credentialKey = operationKey(user, credentialOperation)
  return <section aria-label={`${provider.displayName}密钥管理`}>
    <p>密钥状态：{credential.status}</p><p>掩码：{['configured', 'locked'].includes(credential.status) ? (credential.masked ?? '••••••••（不回显正文）') : '未配置可用密钥'}</p>
    <label className={styles.field}>供应商密钥<input type="password" autoComplete="off" spellCheck={false} value={keyInput} disabled={busy} onChange={(e) => setKeyInput(e.target.value)} /></label>
    <p className={styles.hint}>密钥仅在此输入，经加密提交给服务端。请勿放入 URL、聊天或截图。保存、取消、退出、切换身份时清空输入。</p>
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={saveCredential}>保存 / 轮换密钥</button>
      <button type="button" disabled={Boolean(action.confirmation)} onClick={() => { preparation.cancel(); action.cancel(); setKeyInput(''); encrypted.current = null }}>取消密钥操作</button>
      <button type="button" disabled={busy} onClick={() => recoverOperation(credentialOperation, credentialKey, () => void reload())}>核对上次密钥保存</button>
      <button type="button" disabled={busy} onClick={() => { setKeyInput(''); encrypted.current = null; action.clearPending(); void preparation.run((signal) => guarded((owned) => api.cancelOperation({ operation: credentialOperation, key: credentialKey }, { signal: owned }), signal), (value) => { if (value.status === 'cancelled') { finishOperation(user, credentialOperation, credentialKey); preparation.setNotice('服务端已取消待处理操作，请重新输入密钥。') } else if (value.status === 'completed' && value.result) { finishOperation(user, credentialOperation, credentialKey); preparation.setNotice('操作已经完成，无法取消；请刷新供应商状态。'); void reload() } else preparation.setError('服务端尚未确认最终结果，请继续核对；原操作标识已保留。') }) }}>取消上次待处理密钥保存</button>
      <button type="button" disabled={busy} onClick={() => {
        setKeyInput(''); encrypted.current = null
        const operation = `revoke-credential/${provider.providerId}`; const key = operationKey(user, operation)
        void action.execute({ label: '撤销供应商密钥', work: (signal, confirmationId) => api.request(`${path}/credential`, 'DELETE', confirmationId ? { confirmationId } : {}, { signal, idempotencyKey: key }), cancel: (signal) => api.cancelOperation({ operation, key }, { signal }), onCancelled: () => { setKeyInput(''); encrypted.current = null; finishOperation(user, operation, key) }, accept: () => { finishOperation(user, operation, key); void reload() } })
      }}>撤销密钥</button>
      <button type="button" disabled={busy} onClick={() => {
        setKeyInput(''); encrypted.current = null; setTest(null)
        const operation = `connection/${provider.providerId}`; const key = operationKey(user, operation)
        void action.execute({ label: '测试供应商认证与模型列表', work: (signal, confirmationId) => api.request(`${path}/connection-tests`, 'POST', { scope: 'authentication', ...(confirmationId ? { confirmationId } : {}) }, { signal, idempotencyKey: key, timeoutMs: 15000 }),
          cancel: (signal) => api.cancelOperation({ operation, key }, { signal }),
          onCancelled: () => { setKeyInput(''); encrypted.current = null; setTest(null); finishOperation(user, operation, key) },
          accept: (value) => { const result = value as { test: ConnectionTest }; setTest(result.test); if (!['running', 'outcome_unknown'].includes(result.test.status)) finishOperation(user, operation, key) } })
      }}>测试连接</button>
      <button type="button" disabled={busy} onClick={() => { const operation = `connection/${provider.providerId}`; const key = operationKey(user, operation); recoverOperation(operation, key, (result) => { if (!result.test) return false; const recovered = result.test as ConnectionTest; setTest(recovered); return !['running', 'outcome_unknown'].includes(recovered.status) }) }}>恢复上次连接测试</button>
    </div>
    {test && <div className={styles.item}><strong>认证检查：{test.status === 'succeeded' ? '通过' : test.status === 'failed' ? '失败' : test.status}</strong><p>{test.reason ?? ''}</p><p>仅 /models 网络与认证检查；未验证聊天生成、未发起生成调用。</p>
      <button type="button" disabled={busy} onClick={() => void action.run((signal) => guarded((owned) => api.request<ConnectionTest>(`${path}/connection-tests/${encodeURIComponent(test.testId)}`, 'GET', undefined, { signal: owned }), signal), setTest)}>重新读取连接测试结果</button></div>}
    <Status {...preparation} />{action.controls}
  </section>
}

function VaultUnlock() {
  const { api, scope, guarded } = usePersonal()
  const task = useScopedAction(scope)
  const [passphrase, setPassphrase] = useState('')
  const [vault, setVault] = useState<Vault | null>(null)
  return <Panel title="凭据库访问"><p className={styles.hint}>服务重启后若凭据库锁定，请本人重新验证口令。口令不会持久保存在浏览器。</p>
    <button type="button" disabled={task.busy} onClick={() => void task.run((signal) => guarded((owned) => api.vault({ signal: owned }), signal), setVault)}>读取凭据库状态</button>
    {vault && <p>凭据库：{vault.status}</p>}
    <form onSubmit={(e) => { e.preventDefault(); const value = passphrase; setPassphrase(''); void task.run((signal) => guarded(async (owned) => { await api.request('/vault/unlock', 'POST', { passphrase: value }, { signal: owned }); return api.vault({ signal: owned }) }, signal), setVault) }}>
      <label className={styles.field}>解锁凭据库口令<input type="password" autoComplete="off" value={passphrase} disabled={task.busy} onChange={(e) => setPassphrase(e.target.value)} /></label>
      <div className={styles.actions}><button type="submit" disabled={task.busy || !passphrase}>解锁凭据库</button><button type="button" onClick={() => { task.cancel(); setPassphrase('') }}>取消解锁</button></div>
    </form><Status {...task} />
  </Panel>
}
