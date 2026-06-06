![Multi AI Mate cover](docs/multi-ai-mate-readme-hero.jpg)

# Multi AI Mate

[English](README.md) | **中文**

Multi AI Mate 是一个面向 macOS 和 Windows 的多 AI 桌面工作台，基于 React、Vite 和 Tauri 构建。

它可以把多个 AI 网页应用并排放在同一个桌面空间里。你可以把左侧的 AI 服务拖到指定分栏中，用同一个输入框向当前模式下已打开的面板发送提示词，方便对照、筛选和综合不同模型的回答。

## 下载

macOS 和 Windows 桌面安装包会一起发布在 [GitHub Releases 页面](https://github.com/ZhiPengH/multi-ai-mate/releases)。

## 功能

- 支持 1 AI / 2 AI / 3 AI / 4 AI 工作区模式
- 从左侧 Dock 拖拽 AI 服务到 A/B/C/D 分栏
- 使用 Tauri 原生子 WebView 打开真实 AI 网页
- 退出应用后记住当前工作区，下次启动自动恢复
- 支持自定义 AI 服务，并可上传自定义图标
- macOS 风格毛玻璃界面、透明窗口和标题栏融合
- 底部统一输入框，支持向多个面板广播发送
- 支持刷新全部已打开面板

## 内置 AI 服务

- ChatGPT
- Claude
- Gemini
- Doubao
- DeepSeek
- Kimi
- Grok
- 自定义服务

## 技术栈

- React 19
- TypeScript
- Vite
- Tauri 2
- Rust
- Vitest
- Lucide React

## 开发

安装依赖：

```bash
npm install
```

运行网页预览：

```bash
npm run dev
```

运行桌面应用：

```bash
npm run dev:desktop
```

构建前端：

```bash
npm run build
```

构建桌面应用：

```bash
npm run build:desktop
```

运行测试：

```bash
npm test
```

## 本地测试页

项目内置了一个本地 AI 测试页，可以在不登录真实 AI 账号的情况下验证 WebView 消息注入：

```text
http://localhost:5173/test-ai.html
```

开发时可以把它添加为自定义 AI 服务，拖入某个分栏，然后从底部输入框发送消息进行验证。

## 说明

应用使用 Tauri 原生子 WebView。部分 AI 服务可能需要登录、地区访问条件，或针对具体网页结构做额外选择器适配，登录后才能完整支持自动输入和发送。
