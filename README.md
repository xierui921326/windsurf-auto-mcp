# WindsurfAutoMcp

<p align="center">
  <strong>Windsurf MCP 自动化工具</strong><br>
  任务完成确认 · 用户交互 · 一键配置<br><br>
  🆓 <strong>完全免费 · 开源项目</strong><br>
  💎 <strong>通过 MCP 协议优化交互，让你的 Windsurf 积分发挥数倍价值</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#安装方法">安装</a> •
  <a href="#使用方法">使用</a> •
  <a href="#常见问题">FAQ</a> •
  <a href="#贡献">贡献</a>
</p>

---

## 为什么使用 WindsurfAutoMcp？

传统方式下，AI 完成一个任务后会等待你的下一条指令，而你可能还在查看结果。这期间 **Windsurf 积分在持续消耗**。

WindsurfAutoMcp 通过 MCP 协议实现：
- ✅ **任务完成后自动暂停** - AI 主动询问是否继续，不再空转消耗积分
- ✅ **批量任务连续执行** - 一次指令完成多个任务，减少交互次数
- ✅ **精准控制工作流** - 随时可以介入、修改方向或结束任务

**让你的 Windsurf 积分发挥 2-5 倍价值！**

## 功能特性

- 💎 **节约积分** - 任务完成后自动暂停，避免空转消耗
- 🔌 **HTTP 模式 MCP 服务器** - 稳定可靠的连接方式
- ✅ **任务完成确认** - AI 完成任务后自动询问用户是否继续
- 🖼️ **图片上传支持** - 在对话中上传图片给 AI
- ⚙️ **一键配置 Windsurf** - 自动写入 MCP 配置文件
- 🎨 **可视化控制面板** - 侧边栏管理界面
- ⌨️ **快捷键支持** - `Ctrl+M` 快速切换对话框
- 📊 **使用统计** - 记录调用次数

## 系统要求

| 要求 | 说明 |
|------|------|
| Windsurf / VS Code | 1.80.0 或更高版本 |
| Node.js | **不需要** - 扩展已打包，开箱即用 |

## 安装方法

### 方法一：从 Release 下载（推荐）

1. 从 [Releases](https://github.com/JiXiangKing80/windsurf-auto-mcp/releases) 下载最新的 `.vsix` 文件
2. 打开 Windsurf/VS Code
3. 按 `Ctrl+Shift+P` 打开命令面板
4. 输入 `Extensions: Install from VSIX...`
5. 选择下载的 `.vsix` 文件
6. **重启 Windsurf/VS Code**

### 方法二：拖拽安装

1. 打开 Windsurf/VS Code 的扩展面板（`Ctrl+Shift+X`）
2. 将 `.vsix` 文件直接拖入扩展面板
3. **重启 Windsurf/VS Code**

## 使用方法

### 快速开始

1. 安装扩展后，点击侧边栏的 **WindsurfAutoMcp** 图标
2. 点击 **写入 Windsurf 配置** 按钮
3. **重启 Windsurf**
4. **重要：首次对话前，复制以下提示语发送给 AI：**

```
当你完成一个任务时，必须调用 WindsurfAutoMcp 工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。
```

5. 开始使用！AI 完成任务后会自动弹出确认对话框

> ⚠️ **提示**：每次新对话都需要发送上述提示语，或将其添加到 Windsurf 的全局规则中。

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+M` | 切换对话框显示/隐藏 |

### MCP 工具

| 工具 | 说明 |
|------|------|
| `ask_continue` | 任务完成后询问用户是否继续 |
| `ask_user` | 请求用户输入，支持图片上传 |
| `notify` | 发送通知消息 |

### 配置选项

在设置中搜索 `mcpService`:

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `mcpService.port` | 3456 | MCP 服务器端口 |
| `mcpService.autoStart` | true | 启动时自动运行服务器 |

## 工作原理

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Windsurf AI   │ ──── │  WindsurfAutoMcp │ ──── │    用户界面     │
│  (Cascade)      │ MCP  │   (HTTP Server)  │      │  (对话框/面板)  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
```

1. AI 完成任务后调用 `ask_continue` 工具
2. 扩展弹出对话框询问用户
3. 用户可以选择继续并提供新指令
4. 响应返回给 AI 继续工作

## 常见问题

<details>
<summary><strong>安装后没有看到 WindsurfAutoMcp 图标？</strong></summary>

1. 确保已完全重启 Windsurf/VS Code
2. 检查扩展是否已启用：`Ctrl+Shift+X` → 搜索 "WindsurfAutoMcp"
3. 尝试禁用后重新启用扩展
</details>

<details>
<summary><strong>提示"端口被占用"？</strong></summary>

1. 扩展会自动尝试下一个可用端口
2. 或在设置中修改 `mcpService.port` 为其他端口（如 3457）
</details>

<details>
<summary><strong>Windsurf 中 AI 无法调用 MCP 工具？</strong></summary>

1. 确保点击了 **写入 Windsurf 配置** 按钮
2. **必须重启 Windsurf** 才能生效
3. 检查状态栏是否显示 `MCP: 3456`（服务器运行中）
4. 查看输出面板确认无错误：`Ctrl+Shift+U` → 选择 "WindsurfAutoMcp"
</details>

<details>
<summary><strong>对话框不弹出？</strong></summary>

1. 按 `Ctrl+M` 手动打开对话框
2. 确保 AI 确实调用了 `ask_continue` 工具
</details>

<details>
<summary><strong>如何修改快捷键？</strong></summary>

默认快捷键是 `Ctrl+M`，如需修改：
1. 打开 VS Code 设置 → 键盘快捷方式
2. 搜索 `mcpService.toggleDialog`
3. 修改为您喜欢的快捷键
</details>

<details>
<summary><strong>如何查看服务器日志？</strong></summary>

1. 按 `Ctrl+Shift+U` 打开输出面板
2. 在下拉菜单中选择 **WindsurfAutoMcp**
</details>

<details>
<summary><strong>如何完全卸载？</strong></summary>

1. `Ctrl+Shift+X` → 搜索 "WindsurfAutoMcp" → 卸载
2. 删除配置文件（可选）：
   - Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
   - macOS/Linux: `~/.codeium/windsurf/mcp_config.json`
</details>

## 从源码构建

```bash
# 克隆仓库
git clone https://github.com/JiXiangKing80/windsurf-auto-mcp.git
cd windsurf-auto-mcp

# 安装依赖（需要 Node.js 16+）
npm install

# 编译
npm run compile

# 打包
npm run package
```

## 贡献

欢迎提交 Issue 和 Pull Request！详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目采用 [MIT License](LICENSE) 开源协议，**完全免费**，可自由使用、修改和分发。

## 版本历史

### v1.0.0
- 🎉 初始版本发布
- HTTP 模式 MCP 服务器
- 任务完成确认功能
- 图片上传支持
- 快捷键切换对话框（Ctrl+M）
- 一键配置 Windsurf
