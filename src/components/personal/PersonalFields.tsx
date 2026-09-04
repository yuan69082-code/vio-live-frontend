import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './personal.module.css'

export function Panel({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return <section className={styles.panel} id={id}><h2>{title}</h2>{children}</section>
}

export function Status({ busy, error, notice }: { busy?: boolean; error?: string; notice?: string }) {
  return <>
    {busy && <p role="status">正在处理，请稍候…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
  </>
}

// Local visual assets, not accounts, assistants, or saved data.
export const avatarChoices = [
  { value: '', label: '不设置', symbol: '◇' },
  { value: 'spark', label: '星光', symbol: '✦' },
  { value: 'moon', label: '月亮', symbol: '☾' },
  { value: 'wave', label: '波纹', symbol: '≈' },
  { value: 'bloom', label: '花朵', symbol: '✿' },
]

export function AvatarField({ label, value, onChange, disabled = false }: {
  label: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean
}) {
  const [error, setError] = useState('')
  const reader = useRef<FileReader | null>(null)
  useEffect(() => () => { reader.current?.abort(); reader.current = null }, [])
  return <div className={styles.field}>
    <label>{label}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      reader.current?.abort()
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || Math.ceil(file.size / 3) * 4 + `data:${file.type};base64,`.length > 180000) {
        setError('请选择 PNG、JPEG 或 WebP 图片，编码后不得超过 180000 字符（约 132 KiB）。'); return
      }
      const next = new FileReader(); reader.current = next
      next.onload = () => { if (reader.current === next) { onChange(String(next.result)); setError('') } }
      next.onerror = () => { if (reader.current === next) setError('图片读取失败，请重新选择。') }
      next.readAsDataURL(file)
    }} /></label>
    {value && <img src={value} alt={`${label}预览`} width={56} height={56} style={{ objectFit: 'cover', borderRadius: 18 }} />}
    <button type="button" disabled={disabled} onClick={() => { reader.current?.abort(); reader.current = null; onChange(null); setError('') }}>不设置{label}</button>
    {error && <p role="alert">{error}</p>}
  </div>
}

export function avatarSymbol(value: string | null | undefined) {
  return avatarChoices.find((choice) => choice.value === value)?.symbol ?? '◇'
}
