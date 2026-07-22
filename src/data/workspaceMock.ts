import { QuickAction } from '../components/workspace/QuickActions'
import { RecentChange } from '../components/workspace/RecentChanges'
import { TodayItem } from '../components/workspace/TodayOverview'

export const workspaceMock = {
  agent: {
    name: 'Vio',
    avatar: 'V',
  },
  focus: {
    title: '让第一次使用变得更顺畅',
    detail: '我正在整理今天的重点、待办和最近变化，方便你快速接上进度。',
    progress: '正在梳理 3 项内容',
  },
  today: [
    {
      id: 'priority',
      label: '今日重点',
      value: '完善工作台',
      detail: '检查第一屏体验',
      icon: 'target',
      tone: 'violet',
    },
    {
      id: 'todo',
      label: '待办事项',
      value: '3 项待处理',
      detail: '其中 1 项较重要',
      icon: 'check',
      tone: 'blue',
    },
    {
      id: 'reminder',
      label: '提醒',
      value: '18:30',
      detail: '复盘今天的计划',
      icon: 'bell',
      tone: 'rose',
    },
    {
      id: 'device',
      label: '设备状态',
      value: '3 台在线',
      detail: '1 台设备休眠中',
      icon: 'device',
      tone: 'aqua',
    },
  ] satisfies TodayItem[],
  changes: [
    {
      id: 'memory',
      category: '记忆变化',
      detail: '记住了你偏好简洁的页面反馈',
      time: '刚刚',
      icon: 'memory',
    },
    {
      id: 'state',
      category: '状态变化',
      detail: '当前关注切换为工作台体验',
      time: '8 分钟前',
      icon: 'state',
    },
    {
      id: 'tool',
      category: '工具变化',
      detail: '新增一个可用能力占位',
      time: '今天',
      icon: 'tool',
    },
    {
      id: 'permission',
      category: '权限变化',
      detail: '设备控制仍保持未授权',
      time: '今天',
      icon: 'permission',
    },
    {
      id: 'unfinished',
      category: '未完成事项',
      detail: '工作台第一屏等待最终检查',
      time: '今天',
      icon: 'unfinished',
    },
  ] satisfies RecentChange[],
  quickActions: [
    { id: 'chat', label: '开始对话', icon: 'chat' },
    { id: 'continuity', label: '查看连续性', icon: 'continuity' },
    { id: 'device', label: '打开设备', icon: 'plug' },
    { id: 'capability', label: '添加能力', icon: 'plus' },
  ] satisfies QuickAction[],
}
