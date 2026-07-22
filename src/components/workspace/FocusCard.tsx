import WorkspaceIcon from './WorkspaceIcon'

type FocusCardProps = {
  title: string
  detail: string
  progress: string
}

function FocusCard({ title, detail, progress }: FocusCardProps) {
  return (
    <section className="focus-card" aria-labelledby="current-focus-title">
      <div className="focus-card-heading">
        <span className="focus-icon-wrap">
          <WorkspaceIcon name="target" />
        </span>
        <span id="current-focus-title">当前关注</span>
        <small>模拟数据</small>
      </div>
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="focus-progress">
        <span>{progress}</span>
        <span aria-hidden="true">→</span>
      </div>
    </section>
  )
}

export default FocusCard
