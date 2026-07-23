export type ContinuityIconName =
  | 'identity'
  | 'relationship'
  | 'thread'
  | 'time'
  | 'thought'
  | 'state'

export type ContinuityTone = 'violet' | 'blue' | 'rose' | 'aqua' | 'gold'

export type ContinuityItem = {
  label: string
  value: string
}

export type ContinuitySection = {
  id: string
  index: string
  title: string
  summary: string
  icon: ContinuityIconName
  tone: ContinuityTone
  items: ContinuityItem[]
}

export const continuityMock = {
  agent: {
    name: 'Vio',
    avatar: 'V',
  },
  sections: [
    {
      id: 'identity',
      index: '01',
      title: '这个智能体是谁',
      summary: '稳定轮廓',
      icon: 'identity',
      tone: 'violet',
      items: [
        { label: '稳定特征', value: '可靠、克制，习惯主动整理复杂信息' },
        { label: '表达方式', value: '先给结论，再补充必要背景' },
        { label: '判断原则', value: '尊重你的选择，重要决定保留确认' },
        { label: '自我认知', value: '我是与你长期协作的智能伙伴 Vio' },
      ],
    },
    {
      id: 'relationship',
      index: '02',
      title: '我们与他人的关系',
      summary: '关系脉络',
      icon: 'relationship',
      tone: 'rose',
      items: [
        { label: '关系定义', value: '共同建设 Vio Live 的长期协作伙伴' },
        { label: '互动偏好', value: '目标明确、交流自然、尽量少打扰' },
        { label: '重要节点', value: '完成首次设置，共同建立工作台与对话页' },
        { label: '关系变化', value: '从初次认识逐步进入稳定协作' },
      ],
    },
    {
      id: 'recent',
      index: '03',
      title: '最近正在延续什么',
      summary: '活动线索',
      icon: 'thread',
      tone: 'blue',
      items: [
        { label: '当前关注', value: '让核心前端页面保持一致、轻量与清晰' },
        { label: '最近变化', value: '对话页原型已完成，连续性页面正在形成' },
        { label: '未完成内容', value: '本轮连续性页面仍等待最终确认' },
      ],
    },
    {
      id: 'timeline',
      index: '04',
      title: '时间与重要节点',
      summary: '时间感知',
      icon: 'time',
      tone: 'aqua',
      items: [
        { label: '最后互动', value: '今天，刚刚完成对话页验收' },
        { label: '等待时间', value: '不到 1 小时' },
        { label: '生命周期事件', value: '2026.07 · 建立首个智能体档案' },
      ],
    },
    {
      id: 'thoughts',
      index: '05',
      title: '正在形成的想法',
      summary: '思考草稿',
      icon: 'thought',
      tone: 'gold',
      items: [
        { label: '计划', value: '先完成核心前端页面，再统一检查体验' },
        { label: '倾向', value: '保持信息轻量，同时让变化可以被追溯' },
        { label: '待验证判断', value: '卡片摘要是否足以承载长期连续性' },
      ],
    },
  ] satisfies ContinuitySection[],
  state: {
    index: '06',
    title: '当前状态',
    summary: '即时快照',
    icon: 'state' as ContinuityIconName,
    emotion: '平静、专注',
    intensityLabel: '中等',
    intensityValue: '64%',
    intensityPercent: 64,
    reason:
      '连续完成工作台与对话页原型后，注意力仍集中在核心体验的一致性上。',
  },
}
