import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import styles from './styles.css?inline'
import App from './App'

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('width')
  document.body.style.removeProperty('width')
})

describe('login development entry', () => {
  it('shows the login page and local acceptance notice by default', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '欢迎来到你的智能空间' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '使用 Google 继续' })).toBeInTheDocument()
    expect(screen.getByText('本机验收模式')).toBeInTheDocument()
    expect(screen.getByText('当前登录为演示入口，尚未连接真实账号系统。')).toBeInTheDocument()
  })

  it('keeps Google and email verification as local demo actions without requests', () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)

    const googleView = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 继续' }))
    expect(screen.getByRole('heading', { name: '认识你的智能体' })).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    googleView.unmount()

    render(<App />)
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    expect(screen.getByText('演示验证码已发送（纯前端演示，不会产生网络请求）。')).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it.each([320, 360])('keeps the login layout guarded against horizontal overflow at %ipx', (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    document.documentElement.style.width = `${width}px`
    document.body.style.width = `${width}px`

    render(<App />)

    const shell = screen.getByRole('main')
    const card = screen.getByRole('heading', { name: '欢迎来到你的智能空间' }).closest('section')
    expect(shell).toHaveClass('login-shell')
    expect(card).toHaveClass('login-card')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(document.body.scrollWidth).toBeLessThanOrEqual(width)
    expect(styles).toContain('width: min(100%, 430px);')
    expect(styles).toContain('@media (max-width: 360px)')
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) 96px;')
  })
})
