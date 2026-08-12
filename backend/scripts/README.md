# 后端工程脚本

本目录用于放置可复现的开发、检查、迁移和运维脚本。

脚本必须有明确输入、失败行为和适用环境；涉及数据迁移、恢复或删除时必须提供额外保护。`pnpm run prepare:local-chat` 调用 `prepare-local-chat-profile.js`，幂等准备 V5 固定本地用户、助手、会话和 SubjectBinding；已有数据与固定值冲突时 fail closed。该脚本不启动 HTTP、不连接 Engine 或 Provider，也不保存密钥。
