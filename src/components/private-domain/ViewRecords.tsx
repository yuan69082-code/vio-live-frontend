import PrivateDomainIcon from './PrivateDomainIcon'

type ViewRecord = {
  id: string
  requestTime: string
  scope: string
  action: string
}

function ViewRecords({ records }: { records: ViewRecord[] }) {
  return (
    <section className="private-records" aria-labelledby="private-records-title">
      <div className="private-section-heading">
        <div>
          <span className="private-section-icon">
            <PrivateDomainIcon name="history" />
          </span>
          <div>
            <small>ACCESS HISTORY</small>
            <h2 id="private-records-title">查看记录</h2>
          </div>
        </div>
        <span>模拟记录</span>
      </div>

      <div className="private-record-list">
        {records.map((record) => (
          <article key={record.id} className="private-record-item">
            <div>
              <PrivateDomainIcon name="clock" />
              <span>申请时间</span>
              <strong>{record.requestTime}</strong>
            </div>
            <div>
              <PrivateDomainIcon name="scope" />
              <span>开放范围</span>
              <strong>{record.scope}</strong>
            </div>
            <div>
              <PrivateDomainIcon name="record" />
              <span>操作记录</span>
              <strong>{record.action}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default ViewRecords
