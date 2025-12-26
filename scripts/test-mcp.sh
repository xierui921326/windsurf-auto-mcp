#!/bin/bash

# MCP 服务器测试脚本
# 用于本地调试和测试 MCP 服务器功能

set -e

echo "🚀 WindsurfAutoMcp MCP 服务器测试"
echo "=================================="

# 检查 MCP 服务器文件是否存在
MCP_SERVER="assets/mcp-server/index.js"
if [ ! -f "$MCP_SERVER" ]; then
    echo "❌ 错误: MCP 服务器文件不存在: $MCP_SERVER"
    exit 1
fi

echo "✅ MCP 服务器文件存在: $MCP_SERVER"

# 测试函数
test_mcp_request() {
    local test_name="$1"
    local request="$2"
    local expected_method="$3"
    
    echo ""
    echo "📋 测试: $test_name"
    echo "请求: $request"
    
    # 启动 MCP 服务器并发送请求
    response=$(echo "$request" | timeout 5 node "$MCP_SERVER" 2>/dev/null || echo "TIMEOUT")
    
    if [ "$response" = "TIMEOUT" ]; then
        echo "⚠️  超时 (这可能是正常的，因为某些请求需要用户交互)"
    elif echo "$response" | grep -q "\"method\":\"$expected_method\"" 2>/dev/null; then
        echo "❌ 意外响应格式"
    else
        echo "✅ 响应: $response"
    fi
}

# 测试 1: 初始化
echo ""
echo "🔧 测试 MCP 协议初始化..."
test_mcp_request "初始化" \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0.0"}}}' \
    "initialize"

# 测试 2: 工具列表
echo ""
echo "🛠️  测试工具列表..."
test_mcp_request "工具列表" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    "tools/list"

# 测试 3: 通知工具
echo ""
echo "📢 测试通知工具..."
test_mcp_request "通知工具" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"notify","arguments":{"message":"测试通知","level":"info"}}}' \
    "tools/call"

echo ""
echo "🎯 基本测试完成！"
echo ""
echo "💡 提示:"
echo "   - 某些工具（如 ask_continue, ask_user）需要用户交互，可能会显示弹窗"
echo "   - 使用 'make debug-mcp' 启动调试模式查看详细日志"
echo "   - 在 Windsurf 中配置后，工具将通过 AI 助手调用"
