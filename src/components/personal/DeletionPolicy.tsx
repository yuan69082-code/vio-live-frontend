import styles from './personal.module.css'

/** User-confirmed R2 retention policy, not a client-side deletion scheduler. */
export default function DeletionPolicy() {
  return <section className={styles.item} aria-label="个人空间删除范围与期限">
    <h3>删除前请确认</h3>
    <ul>
      <li>申请生效后立即撤销旧访问会话，停止业务与凭据使用；不会继续开放原业务页面。</li>
      <li>有 7 天可撤销期。本人须通过受控验证，在服务端期限内撤销；撤销后仍须重新登录，旧令牌不恢复。</li>
      <li>期满由服务端真实删除本人在 Vio 管理范围内的数据及历史，删除后不可恢复这些在线数据。</li>
      <li>实际删除后，最小删除凭据保留 30 天，不包含正文或密钥。</li>
      <li>Vio 受管备份在实际删除后最多保留 14 天；恢复前须应用删除标记。用户自行保存的副本不由 Vio 代删。</li>
    </ul>
    <p className={styles.hint}>期限、执行结果和备份清理状态以服务端记录为准。失败、服务未运行或仍有受管副本待处理时，不代表整体删除完成。此流程不表示 R11 完整备份系统已实现。</p>
  </section>
}
