import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ApiClientError } from '../../api/client'

/** Never surface a raw server/transport error: it may contain submitted secrets. */
export function personalError(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '操作未完成，请重新读取当前状态后重试。'
  if (error.code === 'ACCESS_DENIED') return '个人口令或初始化邀请未通过验证，请重新输入。'
  if (error.status === 403 && error.code === 'VAULT_UNLOCK_FAILED') return '解锁口令错误，请重新输入。当前访问会话仍然有效。'
  if (error.code === 'DELETION_ACCESS_DENIED' || error.code === 'DELETION_VERIFICATION_FAILED') return '删除访问验证未通过，请重新输入本人验证口令；未恢复业务权限。'
  if (error.code === 'DELETION_NOT_CANCELLABLE') return '服务端确认已超出撤销期限或删除已开始，不能撤销。请重新核对删除状态。'
  if (error.code === 'DELETION_NOT_DUE') return '服务端确认尚未到执行期限，请重新核对时间与状态。'
  if (error.code === 'DELETION_DATABASE_BUSY') return '服务端数据暂时被占用，删除尚未完成。请重新查询状态，待服务恢复后重试。'
  if (error.code === 'DELETION_RECEIPT_EXPIRED') return '删除凭据查询期已结束，无法继续确认删除状态。'
  if (error.code === 'VAULT_LOCKED') return '凭据库已锁定，请在下方使用个人口令解锁后重试。'
  if (error.status === 401) return '访问已失效，请重新验证个人访问。'
  if (error.status === 403) return '服务端未授权此操作，请重新验证访问或检查权限。'
  if (error.status === 409) return '请求与服务端当前状态冲突，请重新读取后再操作。'
  if (error.status === 429) return '请求过于频繁，请稍后重试。'
  if (error.status === 400 || error.status === 422) return '填写内容未通过服务端校验，请检查字段后重试。'
  if (error.code === 'request_timeout') return '请求超时，保存结果尚未确认。请重读状态；重试将沿用本次操作标识。'
  if (error.code === 'network_error') return '无法连接本地服务，结果尚未确认。请检查服务后重试。'
  if (error.code === 'invalid_response') return '服务端响应无法验证，请重新读取，不能视为操作成功。'
  return '操作未完成，请重新读取当前状态后重试。'
}

/** Per-view mutex and generation guard; this is not server-side idempotency. */
export function useScopedAction(scope: string) {
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useLayoutEffect(() => {
    generation.current++
    setBusy(false)
    setError('')
    setNotice('')
    return () => {
      generation.current++
      const previous = request.current
      request.current = null
      previous?.abort()
    }
  }, [scope])

  const cancel = useCallback(() => {
    generation.current++
    const previous = request.current
    request.current = null
    previous?.abort()
    setBusy(false)
    setError('')
    setNotice('')
  }, [])

  const run = useCallback(async <T,>(
    work: (signal: AbortSignal) => Promise<T>,
    accept?: (result: T) => void,
  ): Promise<boolean> => {
    if (request.current) return false
    const controller = new AbortController()
    const version = generation.current
    request.current = controller
    const isCurrent = () => generation.current === version && request.current === controller && !controller.signal.aborted
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await work(controller.signal)
      if (!isCurrent()) return false
      accept?.(result)
      return true
    } catch (failure) {
      if (isCurrent()) setError(personalError(failure))
      return false
    } finally {
      if (isCurrent()) { request.current = null; setBusy(false) }
    }
  }, [scope])

  return { busy, error, notice, run, cancel, setError, setNotice }
}
