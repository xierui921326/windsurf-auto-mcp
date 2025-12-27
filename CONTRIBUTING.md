# 贡献指南

感谢您对 WindsurfAutoMcp 的关注！这是一个**完全免费的开源项目**，欢迎提交 Issue 和 Pull Request。

## 开发环境设置

### 前置要求

- Node.js 16+
- VS Code 或 Windsurf

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/xierui921326/windsurf-auto-mcp.git
cd windsurf-auto-mcp

# 安装依赖
npm install

# 编译
npm run compile

# 监听模式（自动编译）
npm run watch
```

### 调试

1. 在 VS Code 中打开项目
2. 按 `F5` 启动调试
3. 会打开一个新的扩展开发窗口

## 提交 Issue

提交 Issue 时请包含：

- 问题描述
- 复现步骤
- 预期行为 vs 实际行为
- 环境信息（OS、Windsurf/VS Code 版本）

## 提交 Pull Request

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

### 代码规范

- 使用 TypeScript
- 保持代码风格一致
- 添加必要的注释
- 更新相关文档

## 项目结构

```
windsurf-auto-mcp/
├── src/
│   └── extension.ts    # 主要源代码
├── out/                 # 编译输出
├── package.json         # 扩展配置
├── tsconfig.json        # TypeScript 配置
└── README.md            # 说明文档
```

## 许可证

MIT License
