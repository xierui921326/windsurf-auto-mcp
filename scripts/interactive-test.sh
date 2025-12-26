#!/bin/bash

# MCP 服务器交互式测试脚本
# 提供简单的命令行界面来测试各种 MCP 工具

set -e

echo "🎮 WindsurfAutoMcp 交互式测试"
echo "============================"

MCP_SERVER="assets/mcp-server/index.js"

# 检查 MCP 服务器文件
if [ ! -f "$MCP_SERVER" ]; then
    echo "❌ 错误: MCP 服务器文件不存在: $MCP_SERVER"
    exit 1
fi

# 发送 MCP 请求的函数
send_mcp_request() {
    local request="$1"
    echo "$request" | node "$MCP_SERVER" 2>/dev/null | head -1
}

# 初始化 MCP 服务器
echo "🔧 初始化 MCP 服务器..."
init_response=$(send_mcp_request '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0.0"}}}')
echo "✅ 初始化完成"

# 获取工具列表
echo ""
echo "🛠️  获取可用工具..."
tools_response=$(send_mcp_request '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
echo "✅ 工具列表获取完成"

# 显示菜单
while true; do
    echo ""
    echo "📋 可用的测试选项:"
    echo "  1. 测试通知 (notify)"
    echo "  2. 测试指令优化 (optimize_command)"
    echo "  3. 测试保存指令历史 (save_command_history)"
    echo "  4. 测试获取指令历史 (get_command_history)"
    echo "  5. 测试更新上下文 (update_context_summary)"
    echo "  6. 测试获取上下文 (get_context_summary)"
    echo "  7. 测试用户询问 (ask_user) - 会弹出对话框"
    echo "  8. 测试继续询问 (ask_continue) - 会弹出对话框"
    echo "  9. 查看工具列表"
    echo "  0. 退出"
    echo ""
    
    read -p "请选择测试选项 (0-9): " choice
    
    case $choice in
        1)
            echo ""
            echo "📢 测试通知工具..."
            response=$(send_mcp_request '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"notify","arguments":{"message":"这是一个测试通知","level":"info"}}}')
            echo "响应: $response"
            ;;
        2)
            echo ""
            read -p "输入要优化的指令: " command
            echo "🔧 测试指令优化..."
            response=$(send_mcp_request "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"optimize_command\",\"arguments\":{\"command\":\"$command\",\"level\":\"medium\"}}}")
            echo "响应: $response"
            ;;
        3)
            echo ""
            read -p "输入指令内容: " command
            read -p "是否成功 (true/false): " success
            echo "💾 测试保存指令历史..."
            response=$(send_mcp_request "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"save_command_history\",\"arguments\":{\"command\":\"$command\",\"success\":$success}}}")
            echo "响应: $response"
            ;;
        4)
            echo ""
            echo "📜 测试获取指令历史..."
            response=$(send_mcp_request '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_command_history","arguments":{"limit":5}}}')
            echo "响应: $response"
            ;;
        5)
            echo ""
            read -p "项目名称: " project_name
            read -p "项目类型: " project_type
            read -p "当前任务: " current_task
            echo "📝 测试更新上下文..."
            response=$(send_mcp_request "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"update_context_summary\",\"arguments\":{\"projectName\":\"$project_name\",\"projectType\":\"$project_type\",\"currentTask\":\"$current_task\",\"technologies\":[\"Node.js\",\"TypeScript\"]}}}")
            echo "响应: $response"
            ;;
        6)
            echo ""
            echo "📊 测试获取上下文..."
            response=$(send_mcp_request '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"get_context_summary","arguments":{}}}')
            echo "响应: $response"
            ;;
        7)
            echo ""
            read -p "对话框标题: " title
            read -p "消息内容: " message
            echo "💬 测试用户询问 (将弹出对话框)..."
            response=$(send_mcp_request "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"ask_user\",\"arguments\":{\"title\":\"$title\",\"message\":\"$message\",\"type\":\"input\"}}}")
            echo "响应: $response"
            ;;
        8)
            echo ""
            read -p "结束原因: " reason
            echo "🔄 测试继续询问 (将弹出对话框)..."
            response=$(send_mcp_request "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"ask_continue\",\"arguments\":{\"reason\":\"$reason\"}}}")
            echo "响应: $response"
            ;;
        9)
            echo ""
            echo "🛠️  可用工具列表:"
            echo "$tools_response" | jq '.result.tools[].name' 2>/dev/null || echo "$tools_response"
            ;;
        0)
            echo ""
            echo "👋 测试结束，再见！"
            break
            ;;
        *)
            echo "❌ 无效选项，请重新选择"
            ;;
    esac
done
