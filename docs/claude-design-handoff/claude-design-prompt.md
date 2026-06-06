# Prompt For Claude Design

请基于我提供的 `frontend-requirements.md` 和 `multi-ai-mate-prototype.html`，对 Multi AI Mate 的前端界面做二次设计。

目标是做一个 Mac 桌面端多 AI 工作台原型，而不是营销页面。

我希望它明显比普通 HTML 原型更有 Mac 软件质感。请使用克制的毛玻璃、半透明侧边栏、细腻阴影、轻微背景模糊、macOS segmented control、vibrancy 风格 titlebar/composer。阅读和输入区域要保持清晰，不要为了玻璃效果牺牲可读性。

请保留这些产品逻辑:

- 顶部有 `1 AI / 2 AI / 3 AI / 4 AI` 独立模式按钮
- `1 AI` 时主栏 A 最大化
- `2 AI` 时 A/B 两个主栏左右并排
- `3 AI` 时 A/B 是主栏，C 是右侧较窄副栏
- `4 AI` 时 A/B 是主栏，右侧 C/D 上下双副栏
- 左侧 AI logo 是 AI 库，点击不替换面板，拖拽到面板才加载
- 不需要“范围”按钮
- 默认发送给当前模式下所有已打开 AI 面板
- 面板头部不要显示“刷新 / 放大 / 关闭”文字按钮
- 空槽位保留原始分栏身份，不自动挪动其他面板

请重点优化:

- 视觉层级
- 面板比例
- 左侧 dock 的图标质感
- Mac 毛玻璃和桌面软件质感
- sidebar / titlebar / composer 的半透明材质
- 顶部模式按钮
- 底部输入区
- 空槽位状态
- 拖拽目标状态
- 长时间使用时的低干扰感

请避免:

- 营销落地页风格
- 大 hero
- 夸张渐变
- 过度圆角
- 大量解释性文字
- 单一紫色或深蓝色主题

请输出:

1. 一个完整的单文件 HTML 原型，包含 CSS 和必要 JavaScript
2. 简短说明你做了哪些设计调整
3. 给工程实现的组件拆分建议
4. 需要 Codex 实现时注意的交互状态清单
