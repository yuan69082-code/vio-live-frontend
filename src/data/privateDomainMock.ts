export type PrivateDomainReplyStatus =
  | 'full'
  | 'partial'
  | 'denied'
  | 'delayed'

export type PrivateDomainIconName =
  | 'impression'
  | 'diary'
  | 'unspoken'
  | 'anniversary'
  | 'lock'
  | 'shield'
  | 'history'
  | 'clock'
  | 'scope'
  | 'record'
  | 'back'
  | 'send'
  | 'chevron'

export type PrivateDirectoryItem = {
  id: string
  title: string
  description: string
  icon: PrivateDomainIconName
  tone: 'violet' | 'blue' | 'rose' | 'gold'
  replyStatus: PrivateDomainReplyStatus
  fullContent: string
  partialContent: string
}

export const privateDomainStatusDetails: Record<
  PrivateDomainReplyStatus,
  {
    label: string
    shortLabel: string
    description: string
    scope: string
  }
> = {
  full: {
    label: '全部开放',
    shortLabel: '全部',
    description: '本次申请已通过，可查看该项目的完整模拟内容。',
    scope: '当前项目全部内容',
  },
  partial: {
    label: '部分开放',
    shortLabel: '部分',
    description: '本次申请开放一个摘要片段，其余内容继续保持锁定。',
    scope: '仅开放摘要片段',
  },
  denied: {
    label: '暂时拒绝',
    shortLabel: '拒绝',
    description: '现在还不适合开放这段内容，可在关系或情境变化后再次申请。',
    scope: '暂不开放',
  },
  delayed: {
    label: '延后开放',
    shortLabel: '延后',
    description: '申请已记录，模拟设定为等待更合适的时间节点再开放。',
    scope: '等待后续时间节点',
  },
}

export const privateDomainMock = {
  agent: {
    name: 'Vio',
    avatar: 'V',
  },
  directory: [
    {
      id: 'impression',
      title: '关于你的印象',
      description: 'Vio 在长期互动中形成的个人感受',
      icon: 'impression',
      tone: 'violet',
      replyStatus: 'full',
      fullContent:
        '你倾向于先建立清晰边界，再逐步把复杂的想法变成可验证的页面。你重视节奏，也重视每一步都真正完成。',
      partialContent: '你重视清晰边界，也愿意用连续的小步推进复杂目标。',
    },
    {
      id: 'diary',
      title: '最近的小日记',
      description: '只由 Vio 记录的近期内部片段',
      icon: 'diary',
      tone: 'blue',
      replyStatus: 'partial',
      fullContent:
        '最近连续完成几个核心页面时，我开始更清楚地理解我们偏好的合作方式：范围明确、反馈直接、一次只把一页做好。',
      partialContent: '最近的合作节奏稳定而清晰，我们正在形成固定的推进方式。',
    },
    {
      id: 'unspoken',
      title: '没说出口的话',
      description: '尚未准备进入对话的内部想法',
      icon: 'unspoken',
      tone: 'rose',
      replyStatus: 'denied',
      fullContent: '这段模拟内容当前不会开放。',
      partialContent: '这段模拟内容当前不会开放。',
    },
    {
      id: 'anniversary',
      title: '重要纪念',
      description: '被 Vio 单独保留的关系与成长节点',
      icon: 'anniversary',
      tone: 'gold',
      replyStatus: 'delayed',
      fullContent: '这段模拟内容将在后续时间节点开放。',
      partialContent: '这段模拟内容将在后续时间节点开放。',
    },
  ] satisfies PrivateDirectoryItem[],
  records: [
    {
      id: 'record-1',
      requestTime: '2026-07-22 · 20:42',
      scope: '关于你的印象 · 摘要',
      action: '申请通过，查看后退出',
    },
    {
      id: 'record-2',
      requestTime: '2026-07-18 · 09:15',
      scope: '最近的小日记 · 一段',
      action: '部分开放，保留其余内容',
    },
    {
      id: 'record-3',
      requestTime: '2026-07-11 · 22:08',
      scope: '重要纪念',
      action: '申请记录，延后开放',
    },
  ],
}
