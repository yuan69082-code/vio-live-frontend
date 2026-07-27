# 平台业务模块边界

未来业务模块按规划逐步建立，初始优先级如下：

1. 账号与身份
2. 智能体主体与归属
3. 会话、消息和版本
4. 软件事件
5. 权限、确认、撤销和审计
6. 上下文装配与连续性协调
7. 模型与扩展能力管理
8. 设备、AI 私域、生活模块和数据治理

模块负责业务规则和用例，不直接依赖具体数据库、模型服务、continuity-engine 或设备 SDK。当前实现 User、Subject、Event、APIProvider、Model、Model Router、Permission、Security、SensitiveData 分类、Confirmation 与 AuditLog。Security 只返回安全资格并标记未执行；Permission Checker 不执行资源操作，Router 也不调用真实模型。

安全模块保持以下边界：Permission 决定基础权限，Security 只能收紧；SensitiveData 只定义分类元数据并提供只读查询；Confirmation 不代表执行；AuditLog 与 Event 分离且只记录最小字段。
