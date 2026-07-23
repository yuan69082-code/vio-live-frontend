export type CalendarEventType = 'anniversary' | 'period' | 'intimacy'

export type CalendarEvent = {
  id: string
  type: CalendarEventType
  title: string
  detail: string
}

export type CalendarIconName =
  | 'calendar'
  | 'back'
  | 'previous'
  | 'next'
  | 'anniversary'
  | 'period'
  | 'intimacy'
  | 'note'
  | 'plus'
  | 'chat'
  | 'analysis'
  | 'reminder'
  | 'close'
  | 'check'

export const calendarEventLabels: Record<CalendarEventType, string> = {
  anniversary: '纪念日',
  period: '生理期',
  intimacy: '亲密记录',
}

export const calendarMockEvents: Record<string, CalendarEvent[]> = {
  '2026-06-18': [
    { id: 'jun-anniversary', type: 'anniversary', title: '第一次长谈', detail: '记录一次重要的深夜交流。' },
  ],
  '2026-07-06': [
    { id: 'jul-anniversary', type: 'anniversary', title: '相识纪念日', detail: '一起吃晚餐，留一点不被打扰的时间。' },
  ],
  '2026-07-09': [
    { id: 'jul-intimacy-1', type: 'intimacy', title: '亲密记录', detail: '状态放松，沟通感受很好。' },
  ],
  '2026-07-13': [
    { id: 'jul-period-start', type: 'period', title: '周期开始', detail: '第 1 天 · 轻微不适。' },
  ],
  '2026-07-14': [
    { id: 'jul-period-2', type: 'period', title: '生理期记录', detail: '第 2 天 · 注意休息。' },
  ],
  '2026-07-15': [
    { id: 'jul-period-3', type: 'period', title: '生理期记录', detail: '第 3 天 · 状态平稳。' },
  ],
  '2026-07-16': [
    { id: 'jul-period-4', type: 'period', title: '生理期记录', detail: '第 4 天 · 状态平稳。' },
  ],
  '2026-07-22': [
    { id: 'jul-intimacy-2', type: 'intimacy', title: '亲密记录', detail: '彼此都更愿意表达真实感受。' },
    { id: 'jul-small-date', type: 'anniversary', title: '小约会', detail: '下班后散步四十分钟。' },
  ],
  '2026-07-23': [
    { id: 'jul-today-note', type: 'anniversary', title: '共同计划日', detail: '确认下个月想一起完成的三件事。' },
  ],
  '2026-08-02': [
    { id: 'aug-intimacy', type: 'intimacy', title: '亲密记录', detail: '一次温和、充分沟通的相处。' },
  ],
  '2026-08-08': [
    { id: 'aug-anniversary', type: 'anniversary', title: '重要纪念', detail: '为彼此准备一份小礼物。' },
  ],
}

export const calendarMockNotes: Record<string, string> = {
  '2026-07-06': '提前订一家安静的小店。',
  '2026-07-13': '今天减少高强度安排，多喝温水。',
  '2026-07-22': '这次沟通比以往更自然，值得记住。',
  '2026-07-23': '晚上一起把旅行清单做完。',
}
