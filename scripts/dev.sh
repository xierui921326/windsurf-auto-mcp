#!/bin/bash

# 开发环境快速启动脚本
# 提供一键式开发环境设置

set -e

echo "🚀 WindsurfAutoMcp 开发环境启动"
echo "==============================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"

# 检查项目文件
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 请在项目根目录运行此脚本"
    exit 1
fi

echo "✅ 项目目录正确"

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "📦 安装项目依赖..."
    npm install
else
    echo "✅ 依赖已安装"
fi

# 编译项目
echo "🔨 编译 TypeScript 代码..."
npm run compile

# 检查编译结果
if [ ! -d "out" ]; then
    echo "❌ 编译失败"
    exit 1
fi

echo "✅ 编译成功"

# 显示开发选项
echo ""
echo "🛠️  开发选项:"
echo "  1. 启动监听模式 (自动重编译)"
echo "  2. 测试 MCP 服务器"
echo "  3. 配置 Windsurf MCP"
echo "  4. 打包扩展"
echo "  5. 查看帮助"
echo ""

read -p "请选择选项 (1-5): " choice

case $choice in
    1)
        echo ""
        echo "👀 启动监听模式..."
        echo "文件变化时将自动重新编译"
        echo "按 Ctrl+C 退出"
        npm run watch
        ;;
    2)
        echo ""
        echo "🧪 测试 MCP 服务器..."
        ./scripts/test-mcp.sh
        ;;
    3)
        echo ""
        echo "⚙️  配置 Windsurf MCP..."
        make config
        ;;
    4)
        echo ""
        echo "📦 打包扩展..."
        make package
        ;;
    5)
        echo ""
        echo "📚 查看所有可用命令..."
        make help
        ;;
    *)
        echo "❌ 无效选项"
        exit 1
        ;;
esac
