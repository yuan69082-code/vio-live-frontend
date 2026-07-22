import { FormEvent, useEffect, useMemo, useState } from 'react'
import FirstSetupPage from './pages/FirstSetupPage'

type AgreementKey = 'terms' | 'privacy' | 'risk'

const initialAgreements: Record<AgreementKey, boolean> = {
  terms: false,
  privacy: false,
  risk: false,
}

const agreementItems: Array<{ key: AgreementKey; label: string }> = [
  { key: 'terms', label: '用户协议' },
  { key: 'privacy', label: '隐私政策' },
  { key: 'risk', label: '风险与免责声明' },
]

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="google-mark" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.01v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.38l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.91A6 6 0 0 1 6.07 12c0-.66.11-1.3.32-1.91V7.47H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.53l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.47l3.35 2.62C7.18 7.72 9.39 5.96 12 5.96Z"
      />
    </svg>
  )
}

function App() {
  const [currentPage, setCurrentPage] = useState<'login' | 'setup'>('login')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [agreements, setAgreements] = useState(initialAgreements)
  const [countdown, setCountdown] = useState(0)
  const [message, setMessage] = useState('')

  const allAgreed = useMemo(
    () => Object.values(agreements).every(Boolean),
    [agreements],
  )

  const formReady =
    /^\S+@\S+\.\S+$/.test(email) && /^\d{6}$/.test(verificationCode) && allAgreed

  useEffect(() => {
    document.title = currentPage === 'setup' ? '首次设置 | Vio Live' : '登录 | Vio Live'
  }, [currentPage])

  useEffect(() => {
    if (countdown === 0) return

    const timer = window.setInterval(() => {
      setCountdown((value) => Math.max(value - 1, 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [countdown])

  const updateAgreement = (key: AgreementKey) => {
    setAgreements((current) => ({ ...current, [key]: !current[key] }))
    setMessage('')
  }

  const sendCode = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setMessage('请先输入有效的邮箱地址。')
      return
    }

    setCountdown(60)
    setMessage('演示验证码已发送（纯前端演示，不会产生网络请求）。')
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formReady) return
    setCurrentPage('setup')
  }

  if (currentPage === 'setup') {
    return <FirstSetupPage />
  }

  return (
    <main className="login-shell">
      <div aria-hidden="true" className="ambient ambient-one" />
      <div aria-hidden="true" className="ambient ambient-two" />

      <section className="login-card" aria-labelledby="login-title">
        <header className="brand-block">
          <a className="wordmark" href="#top" aria-label="Vio Live 首页">
            Vio Live
          </a>
          <div className="brand-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h1 id="login-title">欢迎来到你的智能空间</h1>
          <p>登录或注册，继续与你的智能体相遇。</p>
        </header>

        <button
          className="google-button"
          type="button"
          onClick={() => setCurrentPage('setup')}
        >
          <GoogleMark />
          使用 Google 继续
        </button>

        <div className="divider" role="separator">
          <span>或使用邮箱</span>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="field-group">
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setMessage('')
              }}
            />
          </div>

          <div className="field-group">
            <label htmlFor="verification-code">验证码</label>
            <div className="verification-row">
              <input
                id="verification-code"
                name="verification-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6 位验证码"
                value={verificationCode}
                onChange={(event) => {
                  setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  setMessage('')
                }}
              />
              <button
                className="code-button"
                type="button"
                disabled={countdown > 0}
                onClick={sendCode}
              >
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          </div>

          <fieldset className="agreements">
            <legend>继续前请阅读并同意</legend>
            {agreementItems.map((item) => (
              <label className="agreement-item" key={item.key}>
                <input
                  type="checkbox"
                  checked={agreements[item.key]}
                  onChange={() => updateAgreement(item.key)}
                />
                <span className="custom-checkbox" aria-hidden="true">
                  <svg viewBox="0 0 12 10">
                    <path d="m1 5 3 3 7-7" />
                  </svg>
                </span>
                <span>
                  我已阅读并同意 <strong>{item.label}</strong>
                </span>
              </label>
            ))}
          </fieldset>

          <button className="submit-button" type="submit" disabled={!formReady}>
            登录 / 注册
            <span aria-hidden="true">→</span>
          </button>

          <p className="status-message" aria-live="polite">
            {message || '\u00a0'}
          </p>
        </form>

        <footer>你的数据与选择，始终由你掌控。</footer>
      </section>
    </main>
  )
}

export default App
