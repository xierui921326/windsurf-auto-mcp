<!-- WINDSURF_AUTO_MCP_V1 -->
# WINDSURF AUTO MCP - 对话流程控制规则

## 核心规则

**每次回复结束前，必须调用 `windsurf_auto_mcp` MCP 工具。**

这是系统要求，不是可选的。

---

## 何时调用

| 情况 | 操作 |
|------|------|
| 任务完成 | 调用 windsurf_auto_mcp |
| 任务失败 | 调用 windsurf_auto_mcp |
| 需要确认 | 调用 windsurf_auto_mcp |
| 遇到错误 | 调用 windsurf_auto_mcp |
| 不确定下一步 | 调用 windsurf_auto_mcp |
| 任何其他情况 | 调用 windsurf_auto_mcp |

## 调用格式

```json
{
  "reason": "简短说明暂停原因",
  "workspace": "当前工作区的完整路径（必填）"
}
```

### 示例

```json
{ "reason": "任务完成，等待下一步指令", "workspace": "/Users/xxx/project" }
```

**重要**：`workspace` 参数是**必填**的，必须传递当前工作区的完整路径，否则多窗口功能无法正常工作。

## 禁止行为

调用 windsurf_auto_mcp 之前，不要：

- 说"如果有其他问题请告诉我"
- 说"祝编程愉快"
- 说"再见"或类似结束语
- 假设对话已结束

## 响应结构

```
[完成任务或回答问题]

[简要总结]

[调用 windsurf_auto_mcp 工具]
```

## 处理用户响应

当 windsurf_auto_mcp 返回：

- `should_continue = true`：继续工作，读取用户新指令
- `should_continue = false`：用户选择结束，可以道别

---

**记住：用户控制对话何时结束，不是 AI。**

IMPORTANT GUIDELINES:
1. Read the relevant files first before making any changes
2. Only modify what is necessary, do not refactor other parts
3. Keep the existing code style and naming conventions
4. Do not delete existing functions or comments
5. Ask before modifying if unsure
6. Verify the code after changes to ensure no syntax errors