export type CapabilityIconName =
  | 'model'
  | 'mcp'
  | 'skill'
  | 'plugin'
  | 'tool'
  | 'device'
  | 'plus'
  | 'test'
  | 'shield'
  | 'clock'
  | 'update'
  | 'trash'
  | 'settings'
  | 'spark'
  | 'link'
  | 'phone'
  | 'laptop'

export const capabilityMock = {
  summary: {
    connected: 11,
    active: 8,
    needsAttention: 2,
  },
  modelApi: {
    connectedCount: 2,
    services: [
      {
        id: 'vio-general',
        provider: 'Vio 模拟服务',
        baseUrl: 'https://api.vio.example.test/v1',
        modelName: 'vio-general-mock',
        defaultTasks: ['日常对话', '任务规划', '内容整理'],
        connected: true,
      },
      {
        id: 'local-light',
        provider: '本地轻量服务',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelName: 'local-light-mock',
        defaultTasks: ['快速摘要', '离线草稿'],
        connected: true,
      },
    ],
  },
  mcp: [
    {
      id: 'workspace-files',
      name: 'Workspace Files',
      description: '读取当前工作区中的用户授权文件',
      enabled: true,
      permission: '只读',
      recentCall: '12 分钟前 · 读取 3 个文件',
    },
    {
      id: 'calendar-context',
      name: 'Calendar Context',
      description: '为计划任务提供模拟日历上下文',
      enabled: false,
      permission: '等待授权',
      recentCall: '尚无调用记录',
    },
    {
      id: 'device-bridge',
      name: 'Device Bridge',
      description: '连接已授权设备的状态摘要',
      enabled: true,
      permission: '状态读取',
      recentCall: '1 小时前 · 获取设备状态',
    },
  ],
  skills: [
    {
      id: 'daily-planner',
      name: '日程规划',
      description: '将目标整理为可执行的时间安排',
      scope: '工作台、对话',
      enabled: true,
    },
    {
      id: 'memory-review',
      name: '连续性复盘',
      description: '按时间线整理模拟变化与未完成事项',
      scope: '连续性',
      enabled: true,
    },
    {
      id: 'private-writing',
      name: '私域书写',
      description: '生成仅用于私域原型的本地文案',
      scope: 'AI 私域',
      enabled: false,
    },
  ],
  plugins: [
    {
      id: 'vio-mobile-shell',
      name: 'Vio Mobile Shell',
      description: '提供手机端界面能力占位',
      version: 'v0.8.0',
      updateAvailable: false,
    },
    {
      id: 'context-visualizer',
      name: 'Context Visualizer',
      description: '以卡片方式展示上下文结构',
      version: 'v1.3.2',
      updateAvailable: true,
    },
  ],
  tools: [
    {
      id: 'file-reader',
      name: '文件读取',
      permission: '只读',
      usage: '今天 6 次 · 最近 18:42',
      recommended: true,
    },
    {
      id: 'reminder-maker',
      name: '提醒创建',
      permission: '每次确认',
      usage: '本周 3 次 · 最近昨天',
      recommended: true,
    },
    {
      id: 'device-control',
      name: '设备控制',
      permission: '高风险确认',
      usage: '尚无使用记录',
      recommended: false,
    },
  ],
  devices: [
    {
      id: 'vio-phone',
      name: 'Vio Phone',
      type: 'phone' as CapabilityIconName,
      description: '当前手机 · 模拟设备',
      permission: '通知与状态已授权',
      connected: true,
    },
    {
      id: 'studio-laptop',
      name: 'Studio Laptop',
      type: 'laptop' as CapabilityIconName,
      description: '常用电脑 · 模拟设备',
      permission: '仅状态读取',
      connected: true,
    },
  ],
}
