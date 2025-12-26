# WindsurfAutoMcp Makefile
# 提供常用的开发、构建和调试命令

.PHONY: help install build clean dev test debug-mcp package lint format

# 默认目标
help:
	@echo "WindsurfAutoMcp 开发工具"
	@echo ""
	@echo "可用命令:"
	@echo "  install     - 安装项目依赖"
	@echo "  build       - 编译 TypeScript 代码"
	@echo "  clean       - 清理构建文件"
	@echo "  dev         - 开发模式（监听文件变化）"
	@echo "  test        - 运行测试"
	@echo "  debug-mcp   - 启动 MCP 服务器调试模式"
	@echo "  test-mcp    - 测试 MCP 服务器功能"
	@echo "  package     - 打包扩展"
	@echo "  lint        - 代码检查"
	@echo "  format      - 代码格式化"
	@echo "  config      - 配置 Windsurf MCP"
	@echo "  clean-all   - 完全清理（包括 node_modules）"

# 安装依赖
install:
	@echo "安装项目依赖..."
	npm install

# 编译 TypeScript
build:
	@echo "编译 TypeScript 代码..."
	npm run compile

# 清理构建文件
clean:
	@echo "清理构建文件..."
	rm -rf out/
	rm -rf *.vsix

# 开发模式
dev:
	@echo "启动开发模式（监听文件变化）..."
	npm run watch

# 运行测试
test:
	@echo "运行测试..."
	npm test

# MCP 服务器调试模式
debug-mcp:
	@echo "启动 MCP 服务器调试模式..."
	DEBUG_MCP=1 node assets/mcp-server/index.js

# 测试 MCP 服务器功能
test-mcp:
	@echo "测试 MCP 服务器功能..."
	./scripts/test-mcp.sh

# 打包扩展
package: build
	@echo "打包 VS Code 扩展..."
	npx vsce package

# 代码检查
lint:
	@echo "运行代码检查..."
	npx eslint src/ --ext .ts

# 代码格式化
format:
	@echo "格式化代码..."
	npx prettier --write "src/**/*.ts"

# 配置 Windsurf MCP
config:
	@echo "配置 Windsurf MCP..."
	node -e "const path = require('path'); const fs = require('fs'); const os = require('os'); \
	const configPath = path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'); \
	const mcpServerPath = path.resolve('assets/mcp-server/index.js'); \
	let config = {}; \
	if (fs.existsSync(configPath)) { \
		config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); \
	} else { \
		fs.mkdirSync(path.dirname(configPath), { recursive: true }); \
	} \
	if (!config.mcpServers) config.mcpServers = {}; \
	config.mcpServers['windsurf_auto_mcp'] = { \
		command: 'node', \
		args: [mcpServerPath], \
		env: {} \
	}; \
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); \
	console.log('✅ Windsurf MCP 配置已更新:', configPath);"

# 完全清理
clean-all: clean
	@echo "完全清理项目..."
	rm -rf node_modules/
	rm -rf package-lock.json

# 快速开始
start: install build
	@echo "项目已准备就绪！"
	@echo "运行 'make config' 配置 Windsurf MCP"
	@echo "运行 'make debug-mcp' 测试 MCP 服务器"

# 发布准备
release: clean install build test package
	@echo "发布包已准备完成！"
	@ls -la *.vsix
