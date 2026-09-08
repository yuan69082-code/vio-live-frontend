import type {
  ContextAssembly,
  ContextEvidence,
  ContextMode,
  ContextSource,
  ConversationContextSettings,
} from '../../api/personal-context-api'
import styles from './ContextControlPanel.module.css'

const modes: Array<{ value: ContextMode; label: string; description: string }> = [
  { value: 'concise', label: '精简', description: '较小近期窗口' },
  { value: 'balanced', label: '标准', description: '兼顾近期与跨窗口' },
  { value: 'complete', label: '完整', description: '使用完整安全预算' },
  { value: 'custom', label: '自定义', description: '逐项排除可选来源' },
]

const slotLabels: Record<string, string> = {
  system_rules: '系统规则', assistant_settings: '助手全局设定', runtime_projection: '外部运行时投影', unresolved_events: '未解决事件',
  recent_original_text: '近期原文', long_term_memory: '长期记忆', current_user_message: '本轮用户消息',
}
const originLabels: Record<string, string> = {
  system: '系统', assistant: '当前助手', runtime: '运行时投影', current_conversation: '当前会话', cross_window: '同助手跨窗口', event: '事件', memory: '记忆', current_turn: '本轮',
}
const statusLabels: Record<string, string> = {
  included: '已纳入', excluded: '已排除', trimmed: '已裁剪', summarized: '已折叠', empty: '无内容', not_available: '未连接', not_implemented: 'R5 尚未实现', pending: '发送时锁定',
  not_required: '无需折叠', planned: '已计划折叠', ready: '摘要就绪', failed: '摘要失败', failed_fallback_original: '摘要失败，保留原文',
}

export type ContextPanelProps = {
  open: boolean
  loading: boolean
  saving: boolean
  settings: ConversationContextSettings | null
  mode: ContextMode
  excludedSourceRefs: string[]
  plan: ContextAssembly | null
  snapshot: ContextAssembly | null
  error: string
  notice: string
  dirty: boolean
  evidence: ContextEvidence | null
  evidenceLoading: boolean
  evidenceError: string
  onToggleOpen: () => void
  onMode: (mode: ContextMode) => void
  onToggleSource: (source: ContextSource) => void
  onSave: () => void
  onRefresh: () => void
  onEvidence: (source: ContextSource) => void
  onCloseEvidence: () => void
  onRetryFold: () => void
}

function modeLabel(mode: ContextMode) { return modes.find((item) => item.value === mode)?.label ?? mode }
function sourceTitle(source: ContextSource) {
  if (source.sourceType === 'message_version') return source.evidence.senderType === 'user' ? '用户消息版本' : '助手消息版本'
  if (source.sourceType === 'summary') return '结构化摘要'
  if (source.sourceType === 'event') return 'Vio 事件'
  return slotLabels[source.slot] ?? source.sourceType
}
function canExclude(source: ContextSource) { return !['system_rules', 'assistant_settings', 'current_user_message'].includes(source.slot) }
function hasExactEvidence(source: ContextSource) { return ['message_version', 'event', 'summary'].includes(source.sourceType) }

function EvidenceView({ value }: { value: ContextEvidence }) {
  if (value.sourceType === 'message_version') return <><p>{value.content}</p><dl><div><dt>消息版本</dt><dd>{value.messageVersionId}</dd></div><div><dt>会话 / 分支</dt><dd>{value.conversationId} / {value.branchId}</dd></div><div><dt>内容校验</dt><dd>{value.contentHash}</dd></div></dl></>
  if (value.sourceType === 'event') return <><p>{value.summary}</p><pre>{JSON.stringify(value.data, null, 2)}</pre><dl><div><dt>事件</dt><dd>{value.eventType} · {value.eventId}</dd></div><div><dt>发生时间</dt><dd>{new Date(value.occurredAt).toLocaleString('zh-CN')}</dd></div></dl></>
  return <><pre>{JSON.stringify(value.structuredSummary, null, 2)}</pre><dl><div><dt>摘要</dt><dd>{value.summaryId}</dd></div><div><dt>会话 / 分支</dt><dd>{value.conversationId} / {value.branchId}</dd></div><div><dt>来源数量</dt><dd>{value.sourceRefs.length}</dd></div><div><dt>内容校验</dt><dd>{value.contentHash}</dd></div></dl></>
}

export default function ContextControlPanel(props: ContextPanelProps) {
  const assembly = props.plan ?? props.snapshot
  const foldAssembly = props.snapshot ?? props.plan
  const used = assembly?.budget.estimatedInputTokens ?? 0
  const raw = assembly?.budget.rawEstimatedInputTokens ?? 0
  const limit = assembly?.budget.inputBudgetTokens ?? 0
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return <>
    <section className={styles.control} aria-label="上下文控制">
      <button type="button" className={styles.summaryButton} onClick={props.onToggleOpen} aria-expanded={props.open}>
        <span><small>上下文模式</small><strong>{modeLabel(props.mode)}</strong></span>
        <span>{assembly ? `${raw > used ? `${raw} → ` : ''}${used} / ${limit} 预估词元` : '读取装配范围'}</span>
      </button>
      {props.open && <div className={styles.panel}>
        <header><div><small>本会话装配设置</small><h2>本轮准备使用什么</h2></div><button type="button" onClick={props.onToggleOpen}>收起</button></header>
        {props.settings && <div className={styles.scopeFacts}>
          <span>助手默认：{modeLabel(props.settings.personalDefault.mode)}</span>
          <span>会话保存：{props.settings.conversation ? modeLabel(props.settings.conversation.mode) : '沿用助手默认'}</span>
          <span>当前生效：{modeLabel(props.settings.effective.mode)}</span>
          {props.snapshot && <span>已锁定轮次：{modeLabel(props.snapshot.mode)} · {props.snapshot.controlsSource === 'turn' ? '本轮覆盖' : props.snapshot.controlsSource === 'conversation' ? '会话设置' : '助手默认'}</span>}
        </div>}
        <fieldset className={styles.modes} disabled={props.saving}>
          <legend>选择会话模式</legend>
          {modes.map((item) => <label key={item.value} className={props.mode === item.value ? styles.selectedMode : ''}>
            <input type="radio" name="r4-context-mode" value={item.value} checked={props.mode === item.value} onChange={() => props.onMode(item.value)} />
            <span><strong>{item.label}</strong><small>{item.description}</small></span>
          </label>)}
        </fieldset>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={props.loading || props.saving || !props.dirty} onClick={props.onSave}>{props.saving ? '正在保存…' : '保存本会话设置'}</button>
          <button type="button" disabled={props.loading || props.saving} onClick={props.onRefresh}>重新读取</button>
        </div>
        {props.dirty && <p className={styles.dirtyNotice}>当前选择尚未保存：直接发送只会把它作为下一轮覆盖，不会改变本会话保存值。</p>}
        {props.settings && props.settings.effective.unavailableExcludedSourceRefs.length > 0 && <p className={styles.dirtyNotice} role="status">
          {props.settings.effective.unavailableExcludedSourceRefs.length} 项已保存排除来源现已不可用或被移除；它们不会进入预览、发送或 Provider。再次保存当前设置会安全清理这些失效引用。
        </p>}
        {props.loading && <p role="status">正在读取服务端上下文范围…</p>}
        {props.error && <p className={styles.error} role="alert">{props.error}</p>}
        {props.notice && <p className={styles.notice} role="status">{props.notice}</p>}
        {assembly && <>
          <section className={styles.budget} aria-label="Token 预算">
            <div><strong>Token 预算</strong><span>{used} / {limit} · {percent}%</span></div>
            <progress max={Math.max(1, limit)} value={Math.min(used, Math.max(1, limit))} />
            <small>上限 {assembly.budget.contextLimitTokens}，已为输出保留 {assembly.budget.reservedOutputTokens}；估算方法为 UTF-8 上界，不是供应商精确计费。</small>
            <p>原始输入估算 {raw}；折叠与裁剪后的确定性估算 {used}。</p>
            {raw > limit && assembly.budget.withinLimit && <p>原始历史超过输入预算，但服务端已通过确定性折叠或裁剪将本轮控制在安全范围内，可以发送。</p>}
            {assembly.budget.foldPlanned && <p>本轮计划使用结构化摘要折叠；预览不会创建摘要或调用 Provider。</p>}
            <p>本轮用户消息属于必需槽位，不会被折叠、裁剪或静默丢弃。</p>
            {assembly.budget.trimmingApplied && <p>已按固定优先级裁剪：{assembly.budget.trimmingReason ?? '达到模型输入上限'}。本轮用户消息不会被丢弃。</p>}
            {!assembly.budget.withinLimit && <p className={styles.error}>必需内容超过模型上限；服务端会在调用供应商前阻止本轮。</p>}
          </section>
          <section className={styles.boundaries} aria-label="上下文边界">
            <div><strong>运行时投影</strong><span>{assembly.runtimeProjection.status === 'not_available' ? '未连接，槽位为空' : statusLabels[assembly.runtimeProjection.status] ?? assembly.runtimeProjection.status}</span></div>
            <div><strong>长期记忆</strong><span>R5 尚未实现，不会注入模拟记忆</span></div>
            <div><strong>摘要折叠</strong><span>{foldAssembly ? statusLabels[foldAssembly.folding.status] ?? foldAssembly.folding.status : '尚未读取'}</span></div>
            <div><strong>跨窗口选择</strong><span>{assembly.selection.status === 'provisional' ? '预览暂定；发送后按本轮消息最终排序' : `已按本轮消息锁定 · ${assembly.selection.crossWindowSelectedCount}/${assembly.selection.crossWindowCandidateCount}`}</span></div>
          </section>
          {foldAssembly && (foldAssembly.state === 'fold_failed' || ['failed', 'failed_fallback_original'].includes(foldAssembly.folding.status)) && <div className={styles.foldFailure}>
            <p>摘要生成失败。{foldAssembly.folding.status === 'failed_fallback_original' ? '原文仍在预算内，本轮会保留原文。' : '原文无法安全装入，供应商尚未被调用。'}</p>
            <p>失败原因：{foldAssembly.folding.reason ?? '服务端未提供原因'}。</p>
            <p>原始来源集：{foldAssembly.folding.sourceCount} 项 · {foldAssembly.folding.sourceSetHash ?? '未提供来源集校验'}，保持在该轮不可变失败候选中供解释与恢复核对。</p>
            {foldAssembly.turnId && foldAssembly.state === 'fold_failed' && foldAssembly.folding.recoveryAction === 'retry_fold' && <button type="button" disabled={props.saving} onClick={props.onRetryFold}>使用新恢复键重试折叠</button>}
          </div>}
          <ol className={styles.slots} aria-label="固定装配顺序">{assembly.slots.map((slot) => <li key={slot.slot}><span>{slotLabels[slot.slot] ?? slot.slot}</span><small>{statusLabels[slot.status] ?? slot.status}</small></li>)}</ol>
          <div className={styles.sources} aria-label="上下文来源">
            <header><strong>可追溯来源</strong><span>{assembly.sources.length} 项</span></header>
            {assembly.sources.length === 0 ? <p>当前没有可展示的可选来源。</p> : assembly.sources.map((source) => {
              const excluded = props.excludedSourceRefs.includes(source.sourceRef)
              return <article key={source.sourceRef} className={excluded || source.status === 'excluded' ? styles.excluded : ''}>
                <div><strong>{sourceTitle(source)}</strong><small>{originLabels[source.origin] ?? source.origin} · {statusLabels[source.status] ?? source.status} · 约 {source.estimatedTokens} 词元</small></div>
                <p>{source.evidence.preview || '该来源无可公开预览。'}</p>
                {source.evidence.selection && <p>相关度排序 #{source.evidence.selection.rank} · 命中 {source.evidence.selection.matchedTermCount} 项 · {source.evidence.selection.representation === 'latest_ready_summary' ? '使用最新有效摘要' : '摘要不可用，使用合格原文'}</p>}
                <div className={styles.sourceActions}>
                  {!props.plan && hasExactEvidence(source) ? <button type="button" onClick={() => props.onEvidence(source)}>查看精确证据</button> : <span>发送并锁定后可查证</span>}
                  {props.mode === 'custom' && canExclude(source) && <button type="button" disabled={props.loading || props.saving} onClick={() => props.onToggleSource(source)}>{excluded ? '恢复来源' : '排除来源'}</button>}
                </div>
              </article>
            })}
          </div>
          {props.snapshot && <section className={styles.locked} aria-label="已锁定轮次范围">
            <header><strong>已锁定轮次范围</strong><span>{modeLabel(props.snapshot.mode)} · {props.snapshot.sources.length} 项来源</span></header>
            <p>轮次 {props.snapshot.turnId} 已绑定不可变快照；下方事实不会随待发送预览变化。</p>
            <div className={styles.lockedFacts}>
              <span>预算 {props.snapshot.budget.estimatedInputTokens} / {props.snapshot.budget.inputBudgetTokens}</span>
              <span>{props.snapshot.controlsSource === 'turn' ? '本轮覆盖' : props.snapshot.controlsSource === 'conversation' ? '会话设置' : '助手默认'}</span>
              <span>{statusLabels[props.snapshot.folding.status] ?? props.snapshot.folding.status}</span>
              <span>最终相关度选择 {props.snapshot.selection.crossWindowSelectedCount}/{props.snapshot.selection.crossWindowCandidateCount}</span>
            </div>
            {props.snapshot.sources.length === 0 ? <p>该轮次没有可展示的来源。</p> : <ul>{props.snapshot.sources.map((source) => <li key={source.sourceRef}>
              <span><strong>{sourceTitle(source)}</strong><small>{originLabels[source.origin] ?? source.origin} · {statusLabels[source.status] ?? source.status}</small></span>
              {hasExactEvidence(source) ? <button type="button" onClick={() => props.onEvidence(source)}>查看精确证据</button> : <small>受服务端内部规则约束</small>}
            </li>)}</ul>}
          </section>}
        </>}
      </div>}
    </section>
    {(props.evidence || props.evidenceLoading || props.evidenceError) && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) props.onCloseEvidence() }}>
      <section className={styles.evidence} role="dialog" aria-modal="true" aria-label="上下文来源证据"><header><h2>精确来源证据</h2><button type="button" onClick={props.onCloseEvidence}>关闭</button></header>
        {props.evidenceLoading ? <p role="status">正在读取受保护证据…</p> : props.evidenceError ? <p className={styles.error} role="alert">{props.evidenceError}</p> : props.evidence ? <EvidenceView value={props.evidence} /> : null}
      </section>
    </div>}
  </>
}
