export type ProfileIconName =
  | 'profile'
  | 'account'
  | 'login'
  | 'link'
  | 'agent'
  | 'spark'
  | 'persona'
  | 'rule'
  | 'appearance'
  | 'theme'
  | 'background'
  | 'bubble'
  | 'decoration'
  | 'data'
  | 'export'
  | 'trash'
  | 'backup'
  | 'shield'
  | 'permission'
  | 'question'
  | 'tool'
  | 'privacy'
  | 'document'
  | 'lock'
  | 'chevron'
  | 'check'

export const profileMock = {
  account: {
    displayName: 'Vio Live User',
    userId: 'vio_user_08',
    plan: '本地演示账号',
    email: 'vio@example.test',
    loginMethod: 'Google · 模拟登录',
    bindings: '邮箱已绑定 · 手机未绑定',
  },
  agent: {
    name: 'Vio',
    avatar: 'V',
    personality: ['冷静', '温柔', '主动但克制'],
    persona: '长期协作的智能生活伙伴',
    requirements: ['重要操作前先确认', '明确区分事实、推测与建议'],
  },
  appearance: {
    themes: ['暮紫', '雾蓝', '跟随系统'],
    backgrounds: ['柔光玻璃', '纯色留白', '低对比渐变'],
    bubbles: ['圆润气泡', '简洁卡片', '极简文本'],
  },
  safety: {
    askModes: ['每次询问', '高风险询问', '按规则执行'],
    permissionRule: '重要操作每次确认',
    toolPermission: '3 项已授权 · 1 项高风险',
  },
  privacy: [
    { id: 'policy', title: '隐私政策', description: '查看当前演示政策说明', icon: 'document' as ProfileIconName },
    { id: 'data-note', title: '数据说明', description: '了解模拟数据如何展示', icon: 'data' as ProfileIconName },
    { id: 'private-domain', title: 'AI 私域设置', description: '查看访问与开放偏好', icon: 'lock' as ProfileIconName },
  ],
}
