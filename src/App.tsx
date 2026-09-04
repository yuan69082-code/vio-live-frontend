import { PersonalProvider, usePersonal } from './state/PersonalContext'
import type { PersonalApi } from './api/personal-api'
import FirstSetupPage from './pages/FirstSetupPage'
import MainNavigation from './pages/MainNavigation'
import PersonalAccessPage from './pages/PersonalAccessPage'
import PersonalDeletionPage, { DeletionAccessPage } from './pages/PersonalDeletionPage'

function PersonalEntry() {
  const { state, scope, restore } = usePersonal()
  if (state.kind === 'loading') return <main className="login-shell"><section className="login-card"><span className="wordmark">Vio Live</span><p role="status">正在恢复个人访问…</p></section></main>
  if (state.kind === 'error') return <main className="login-shell"><section className="login-card"><h1>个人访问暂不可用</h1><p role="alert">{state.message}</p><button type="button" onClick={() => void restore()}>重试访问恢复</button></section></main>
  if (state.kind === 'deletion') return <PersonalDeletionPage key={scope} />
  if (state.kind === 'deletion-receipt-expired') return <main className="login-shell"><section className={`login-card`}><h1>删除凭据查询期已结束</h1><p>服务端返回凭据已过期，当前无法继续确认删除状态；不据此宣称整体删除完成。</p><button type="button" onClick={() => void restore()}>重新读取访问状态</button></section></main>
  if (state.kind === 'access' && state.access.status === 'deletion_authentication_required') return <DeletionAccessPage key={scope} />
  if (state.kind === 'access') return <PersonalAccessPage key={scope} access={state.access} message={state.message} />
  if (!state.session.onboardingCompleted) return <FirstSetupPage key={scope} />
  return <MainNavigation key={scope} />
}

export default function App({ personalApi }: { personalApi?: PersonalApi }) {
  return <PersonalProvider api={personalApi}><PersonalEntry /></PersonalProvider>
}
