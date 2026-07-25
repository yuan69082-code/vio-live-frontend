# 后端源码目录

本目录预留给未来平台后端源码。当前只记录结构，不包含可执行代码。

规划依赖方向：

```text
interfaces / transport（技术栈确定后建立）
                ↓
             modules
                ↓
              core

integrations 通过 modules 定义的端口接入外部系统
```

- `core/`：跨模块稳定类型、标识和规则边界。
- `modules/`：平台业务能力及用例边界。
- `integrations/`：数据库、认证、模型、continuity-engine、MCP、Tool 和设备等适配边界。

具体文件组织、构建方式和依赖注入方案等待后端技术栈 ADR。
