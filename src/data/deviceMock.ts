export type DeviceIconName =
  | 'devices'
  | 'back'
  | 'chevron'
  | 'lamp'
  | 'air'
  | 'camera'
  | 'lock'
  | 'power'
  | 'plus'
  | 'link'
  | 'shield'
  | 'automation'
  | 'log'
  | 'location'
  | 'activity'
  | 'stop'
  | 'revoke'
  | 'info'
  | 'permission'
  | 'adapter'

export type DeviceStatusTone = 'online' | 'working' | 'guarding' | 'risk'

export type ConnectedDevice = {
  id: string
  name: string
  category: string
  room: string
  status: string
  statusTone: DeviceStatusTone
  icon: DeviceIconName
  dangerous: boolean
  parameters: Array<{ label: string; value: string }>
  actions: Array<{ id: string; label: string }>
  basicInfo: Array<{ label: string; value: string }>
  permissions: Array<{
    id: string
    label: string
    description: string
    enabled: boolean
  }>
  automations: Array<{ name: string; detail: string; enabled: boolean }>
  logs: Array<{ time: string; action: string; result: string }>
}

export const deviceMock = {
  summary: {
    connected: 4,
    active: 3,
    needsAttention: 1,
  },
  connected: [
    {
      id: 'living-room-lamp',
      name: '客厅落地灯',
      category: '照明设备 · 模拟',
      room: '客厅 · 阅读角',
      status: '已开启',
      statusTone: 'online' as DeviceStatusTone,
      icon: 'lamp' as DeviceIconName,
      dangerous: false,
      parameters: [
        { label: '亮度', value: '72%' },
        { label: '色温', value: '暖光' },
      ],
      actions: [
        { id: 'toggle', label: '关闭' },
        { id: 'brighter', label: '调亮' },
      ],
      basicInfo: [
        { label: '设备类型', value: '通用照明设备' },
        { label: '所在位置', value: '客厅 · 阅读角' },
        { label: '接入方式', value: '本地模拟适配器' },
        { label: '最近更新', value: '刚刚' },
      ],
      permissions: [
        { id: 'read', label: '读取状态', description: '读取开关、亮度与色温', enabled: true },
        { id: 'control', label: '常用控制', description: '执行开关与亮度调整', enabled: true },
      ],
      automations: [
        { name: '夜间阅读光', detail: '每天 20:30 · 亮度 55%', enabled: true },
        { name: '离家关闭', detail: '离家状态触发 · 仅模拟', enabled: false },
      ],
      logs: [
        { time: '19:42', action: '读取亮度', result: '72%' },
        { time: '18:10', action: '开启设备', result: '模拟成功' },
      ],
    },
    {
      id: 'bedroom-air',
      name: '卧室空气净化器',
      category: '环境设备 · 模拟',
      room: '卧室 · 窗边',
      status: '自动运行',
      statusTone: 'working' as DeviceStatusTone,
      icon: 'air' as DeviceIconName,
      dangerous: false,
      parameters: [
        { label: '空气质量', value: '优' },
        { label: '风速', value: '2 档' },
      ],
      actions: [
        { id: 'pause', label: '暂停' },
        { id: 'boost', label: '强力' },
      ],
      basicInfo: [
        { label: '设备类型', value: '通用空气处理设备' },
        { label: '所在位置', value: '卧室 · 窗边' },
        { label: '接入方式', value: '本地模拟服务' },
        { label: '最近更新', value: '2 分钟前' },
      ],
      permissions: [
        { id: 'read', label: '读取环境', description: '读取空气质量与运行状态', enabled: true },
        { id: 'control', label: '模式控制', description: '调整运行模式与风速', enabled: true },
      ],
      automations: [
        { name: '睡眠模式', detail: '每天 23:00 · 低速运行', enabled: true },
      ],
      logs: [
        { time: '19:40', action: '读取空气质量', result: '优' },
        { time: '17:30', action: '切换自动模式', result: '模拟成功' },
      ],
    },
    {
      id: 'entry-camera',
      name: '玄关摄像头',
      category: '安防设备 · 模拟',
      room: '玄关 · 入户门',
      status: '守护中',
      statusTone: 'guarding' as DeviceStatusTone,
      icon: 'camera' as DeviceIconName,
      dangerous: false,
      parameters: [
        { label: '画面', value: '已遮罩' },
        { label: '电量', value: '84%' },
      ],
      actions: [
        { id: 'privacy', label: '隐私模式' },
        { id: 'snapshot', label: '模拟截图' },
      ],
      basicInfo: [
        { label: '设备类型', value: '通用安防设备' },
        { label: '所在位置', value: '玄关 · 入户门' },
        { label: '接入方式', value: '本地模拟适配器' },
        { label: '最近更新', value: '5 分钟前' },
      ],
      permissions: [
        { id: 'status', label: '读取状态', description: '仅读取在线与电量状态', enabled: true },
        { id: 'image', label: '画面访问', description: '查看遮罩后的模拟预览', enabled: false },
      ],
      automations: [
        { name: '回家隐私模式', detail: '到家后暂停画面访问', enabled: true },
      ],
      logs: [
        { time: '19:35', action: '读取在线状态', result: '在线' },
        { time: '08:20', action: '启用守护模式', result: '模拟成功' },
      ],
    },
    {
      id: 'door-lock-controller',
      name: '门锁控制器',
      category: '高风险设备 · 模拟',
      room: '玄关 · 入户门',
      status: '权限需复核',
      statusTone: 'risk' as DeviceStatusTone,
      icon: 'lock' as DeviceIconName,
      dangerous: true,
      parameters: [
        { label: '门锁', value: '已锁定' },
        { label: '权限', value: '高风险' },
      ],
      actions: [
        { id: 'audit', label: '复核权限' },
      ],
      basicInfo: [
        { label: '设备类型', value: '通用门锁控制器' },
        { label: '所在位置', value: '玄关 · 入户门' },
        { label: '接入方式', value: '本地高风险模拟' },
        { label: '最近更新', value: '10 分钟前' },
      ],
      permissions: [
        { id: 'read', label: '读取锁定状态', description: '只读取当前锁定状态', enabled: true },
        { id: 'control', label: '门锁控制', description: '高风险操作，每次需要确认', enabled: true },
      ],
      automations: [
        { name: '离家检查', detail: '离家时仅检查锁定状态', enabled: true },
      ],
      logs: [
        { time: '19:32', action: '权限复核提醒', result: '等待处理' },
        { time: '08:15', action: '读取锁定状态', result: '已锁定' },
      ],
    },
  ] satisfies ConnectedDevice[],
  unconnected: [
    {
      id: 'lighting-category',
      name: '其他照明设备',
      description: '通用类别 · 未指定品牌',
      requirement: '需要添加适配器后再配置',
      action: '添加适配器',
      icon: 'adapter' as DeviceIconName,
    },
    {
      id: 'climate-category',
      name: '温控与环境设备',
      description: '通用类别 · 未指定品牌',
      requirement: '当前没有可用的模拟服务',
      action: '连接服务',
      icon: 'link' as DeviceIconName,
    },
  ],
}
