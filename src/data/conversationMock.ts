export type MessageSender = 'user' | 'assistant'

export type MessageAction =
  | 'edit'
  | 'regenerate'
  | 'delete'
  | 'branch'

export type ConversationMessage = {
  id: string
  sender: MessageSender
  content: string
  time: string
  actions: MessageAction[]
}

export const conversationMock = {
  agent: {
    name: 'Vio',
    avatar: 'V',
  },
  session: {
    name: '产品打磨',
  },
  models: ['Vio 通用模型', 'Vio 快速模型', 'Vio 深度模型'],
  contextModes: ['精简', '标准', '完整', '自定义'],
  contextEntries: [
    { id: 'memory', label: '本次使用记忆', value: '3 条' },
    { id: 'state', label: '当前状态', value: '专注' },
    { id: 'tool', label: '使用工具', value: '1 项' },
  ],
  messages: [
    {
      id: 'message-1',
      sender: 'assistant',
      content:
        '早上好。我把工作台第一屏的反馈整理好了，今天想先从哪一项开始？',
      time: '09:32',
      actions: ['regenerate', 'delete', 'branch'],
    },
    {
      id: 'message-2',
      sender: 'user',
      content: '先帮我梳理对话页应该保留的核心信息，界面尽量轻一些。',
      time: '09:34',
      actions: ['edit', 'delete', 'branch'],
    },
    {
      id: 'message-3',
      sender: 'assistant',
      content:
        '可以。第一屏只保留会话标题、消息流、上下文控制和输入区；记忆、状态与工具做成轻量入口，需要时再展开。',
      time: '09:34',
      actions: ['regenerate', 'delete', 'branch'],
    },
    {
      id: 'message-4',
      sender: 'user',
      content: '很好，把重要操作也放在消息下方，先做成静态原型。',
      time: '09:35',
      actions: ['edit', 'delete', 'branch'],
    },
    {
      id: 'message-5',
      sender: 'assistant',
      content:
        '收到。消息下方会提供编辑或重新生成、删除和创建新分支入口，目前仅作为界面示意。',
      time: '09:35',
      actions: ['regenerate', 'delete', 'branch'],
    },
  ] satisfies ConversationMessage[],
}
