# Multi AI Mate Claude Design Handoff

这个目录用于把前端设计需求交付给 Claude Design 做二次视觉和交互修改。

## Files

- `frontend-requirements.md`: 产品和前端需求说明，适合先发给 Claude Design 作为上下文。
- `multi-ai-mate-prototype.html`: 可直接打开的单文件 HTML 原型，适合作为 Claude Design 的初稿输入。
- `claude-design-prompt.md`: 建议复制到 Claude Design 的提示词。

## Suggested Workflow

1. 先打开 `multi-ai-mate-prototype.html`，确认原型表达的布局方向没有偏。
2. 打开 Claude Design，新建一个设计会话。
3. 上传或粘贴 `frontend-requirements.md` 的内容。
4. 再上传或粘贴 `multi-ai-mate-prototype.html`。
5. 使用 `claude-design-prompt.md` 里的提示词，让 Claude Design 只做设计细化，不改产品逻辑。
6. 在 Claude Design 中二次修改到满意后，导出 HTML。
7. 回到 Codex，把导出的 HTML 和修改说明交给 Codex，实现成真实前端界面。

## Design Boundary

Claude Design 阶段只负责:

- 布局比例
- 视觉风格
- 颜色和字体
- 交互状态
- 空槽位和拖拽反馈
- 1/2/3/4 AI 模式切换体验

暂时不要让 Claude Design 处理:

- Electron/Tauri 技术选型
- WebView 注入
- 自动发送到第三方 AI 网站
- 登录态和 Cookie 隔离
- 打包、权限、性能优化

这些工程实现问题应该回到 Codex 处理。
