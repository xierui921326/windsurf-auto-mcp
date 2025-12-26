#!/bin/bash

# MCP 服务器调试脚本
# 提供交互式调试环境

set -e

echo "🔍 WindsurfAutoMcp MCP 服务器调试模式"
echo "====================================="

# 检查 MCP 服务器文件
MCP_SERVER="assets/mcp-server/index.js"
if [ ! -f "$MCP_SERVER" ]; then
    echo "❌ 错误: MCP 服务器文件不存在: $MCP_SERVER"
    exit 1
fi

echo "✅ MCP 服务器文件: $MCP_SERVER"
echo ""

# 显示可用的调试选项
echo "📋 调试选项:"
echo "  1. 启动调试模式 (显示详细日志)"
echo "  2. 测试工具调用"
echo "  3. 交互式测试"
echo "  4. 查看 MCP 配置"
echo "  5. 退出"
echo ""

read -p "请选择选项 (1-5): " choice

case $choice in
    1)
        echo ""
        echo "🚀 启动 MCP 服务器调试模式..."
        echo "按 Ctrl+C 退出"
        echo ""
        DEBUG_MCP=1 node "$MCP_SERVER"
        ;;
    2)
        echo ""
        echo "🧪 运行工具测试..."
        ./scripts/test-mcp.sh
        ;;
    3)
        echo ""
        echo "💬 交互式测试模式"
        echo "输入 JSON-RPC 请求，按回车发送，输入 'quit' 退出"
        echo ""
        echo "示例请求:"
        echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0.0"}}}'
        echo ""
        
        # 启动 MCP 服务器作为后台进程
        DEBUG_MCP=1 node "$MCP_SERVER" &
        MCP_PID=$!
        
        # 确保退出时杀死后台进程
        trap "kill $MCP_PID 2>/dev/null || true" EXIT
        
        while true; do
            read -p "MCP> " input
            if [ "$input" = "quit" ]; then
                break
            fi
            if [ -n "$input" ]; then
                echo "$input" | nc -w 1 localhost 8080 2>/dev/null || echo "请求已发送到 MCP 服务器"
            fi
        done
        ;;
    4)
        echo ""
        echo "⚙️  检查 MCP 配置..."
        
        # 检查各个可能的配置路径
        config_paths=(
            "$HOME/.codeium/windsurf/mcp_config.json"
            "$HOME/.codeium/windsurf-next/mcp_config.json"
            "$HOME/.codeium/mcp_config.json"
            "$HOME/.cursor/mcp.json"
            "$HOME/.windsurf/mcp_config.json"
        )
        
        found_config=false
        for config_path in "${config_paths[@]}"; do
            if [ -f "$config_path" ]; then
                echo "✅ 找到配置文件: $config_path"
                if grep -q "windsurf_auto_mcp" "$config_path" 2>/dev/null; then
                    echo "   ✅ 包含 windsurf_auto_mcp 配置"
                else
                    echo "   ⚠️  未包含 windsurf_auto_mcp 配置"
                fi
                found_config=true
            fi
        done
        
        if [ "$found_config" = false ]; then
            echo "❌ 未找到任何 MCP 配置文件"
            echo "运行 'make config' 创建配置"
        fi
        ;;
    5)
        echo "👋 再见！"
        exit 0
        ;;
    *)
        echo "❌ 无效选项"
        exit 1
        ;;
esac
