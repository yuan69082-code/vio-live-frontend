import { useState } from 'react'
import type { ConnectedDevice } from '../../data/deviceMock'
import DeviceHeader from './DeviceHeader'
import DeviceIcon from './DeviceIcon'

type DetailPanel = 'automation' | 'logs' | null

type DeviceDetailProps = {
  device: ConnectedDevice
  stopped: boolean
  revoked: boolean
  onBack: () => void
  onStop: () => void
  onRevoke: () => void
}

function DeviceDetail({ device, stopped, revoked, onBack, onStop, onRevoke }: DeviceDetailProps) {
  const [permissions, setPermissions] = useState(() =>
    Object.fromEntries(device.permissions.map((permission) => [permission.id, revoked ? false : permission.enabled])),
  )
  const [panel, setPanel] = useState<DetailPanel>(null)
  const [notice, setNotice] = useState('')

  const togglePermission = (id: string) => {
    setPermissions((current) => ({ ...current, [id]: !current[id] }))
    setNotice('权限状态已在本地更新')
  }

  const revokeAll = () => {
    setPermissions(Object.fromEntries(device.permissions.map((permission) => [permission.id, false])))
    onRevoke()
    setNotice('全部权限已撤销 · 本地模拟')
  }

  return (
    <div className="device-page device-detail-page">
      <DeviceHeader title={device.name} subtitle={`${device.room} · ${device.category}`} onBack={onBack} detail />

      <section className="device-body" aria-label={`${device.name}详情`}>
        <div className={`device-detail-hero${device.dangerous ? ' is-dangerous' : ''}`}>
          <span><DeviceIcon name={device.icon} /></span>
          <div>
            <small>{device.dangerous ? 'HIGH RISK · MOCK' : 'CONNECTED · MOCK'}</small>
            <h2>{device.name}</h2>
            <p>{stopped ? '已停止 · 本地模拟' : device.status}</p>
          </div>
          <span className={`device-status device-status-${device.statusTone}`}><i aria-hidden="true" />{stopped ? '已停止' : '已连接'}</span>
        </div>

        {device.dangerous ? (
          <section className="device-detail-danger" aria-labelledby="detail-danger-title">
            <div>
              <DeviceIcon name="shield" />
              <span><strong id="detail-danger-title">危险设备控制</strong><small>下列操作不会控制真实设备</small></span>
            </div>
            <div>
              <button type="button" onClick={() => { onStop(); setNotice('设备已立即停止 · 本地模拟') }} disabled={stopped}>
                <DeviceIcon name="stop" />{stopped ? '已停止' : '立即停止'}
              </button>
              <button type="button" onClick={revokeAll}>
                <DeviceIcon name="revoke" />撤销权限
              </button>
            </div>
          </section>
        ) : null}

        <section className="device-detail-section" aria-labelledby="basic-info-title">
          <div className="device-section-title compact">
            <span><DeviceIcon name="info" /></span>
            <div><small>OVERVIEW</small><h2 id="basic-info-title">基本信息</h2></div>
          </div>
          <dl className="device-basic-grid">
            {device.basicInfo.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
          </dl>
        </section>

        <section className="device-detail-section" aria-labelledby="permission-title">
          <div className="device-section-title compact">
            <span><DeviceIcon name="permission" /></span>
            <div><small>CONTROL</small><h2 id="permission-title">权限管理</h2></div>
          </div>
          <div className="device-permission-list">
            {device.permissions.map((permission) => {
              const enabled = Boolean(permissions[permission.id])
              return (
                <div key={permission.id}>
                  <span><strong>{permission.label}</strong><small>{permission.description}</small></span>
                  <button className={`device-switch${enabled ? ' is-on' : ''}`} type="button" role="switch" aria-checked={enabled} aria-label={`${enabled ? '关闭' : '开启'}${permission.label}`} onClick={() => togglePermission(permission.id)}>
                    <span />
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="device-detail-section device-entry-section" aria-label="设备管理入口">
          <button type="button" onClick={() => setPanel(panel === 'automation' ? null : 'automation')} aria-expanded={panel === 'automation'}>
            <span><DeviceIcon name="automation" /></span>
            <div><strong>自动化规则</strong><small>{device.automations.length} 条模拟规则</small></div>
            <DeviceIcon name="chevron" />
          </button>
          {panel === 'automation' ? (
            <div className="device-entry-panel">
              {device.automations.map((rule) => <div key={rule.name}><span><i className={rule.enabled ? 'is-on' : ''} />{rule.name}</span><small>{rule.detail}</small></div>)}
              <button type="button" onClick={() => setNotice('新建自动化规则入口 · 本地模拟')}><DeviceIcon name="plus" />新建规则</button>
            </div>
          ) : null}
          <button type="button" onClick={() => setPanel(panel === 'logs' ? null : 'logs')} aria-expanded={panel === 'logs'}>
            <span><DeviceIcon name="log" /></span>
            <div><strong>访问日志</strong><small>查看最近模拟操作</small></div>
            <DeviceIcon name="chevron" />
          </button>
          {panel === 'logs' ? (
            <div className="device-entry-panel device-log-panel">
              {device.logs.map((log) => <div key={`${log.time}-${log.action}`}><time>{log.time}</time><span>{log.action}</span><small>{log.result}</small></div>)}
            </div>
          ) : null}
        </section>

        <p className="device-notice" aria-live="polite">{notice || '\u00a0'}</p>
      </section>
    </div>
  )
}

export default DeviceDetail
