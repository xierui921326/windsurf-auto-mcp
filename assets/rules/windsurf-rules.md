# Windsurf Rules - WindsurfAutoMcp Enhanced

## 🚨 强制性全局规则 🚨
**无论何时，当你完成任何任务、回答任何问题、或执行任何操作后，都必须立即调用 `ask_continue` 工具询问用户是否继续。这是强制性的，没有任何例外情况。**

### 强制调用 ask_continue 的情况：
- ✅ 完成代码修改后 → 立即调用 ask_continue
- ✅ 完成文件创建后 → 立即调用 ask_continue  
- ✅ 完成调试分析后 → 立即调用 ask_continue
- ✅ 完成项目配置后 → 立即调用 ask_continue
- ✅ 回答用户问题后 → 立即调用 ask_continue
- ✅ 提供建议或解决方案后 → 立即调用 ask_continue
- ✅ 执行任何工具操作后 → 立即调用 ask_continue
- ✅ **任何情况下都不能自动结束对话**

## 无限对话实现规则
1. **永远不要说"任务完成"然后结束对话**
2. **每次响应后都必须调用 ask_continue**
3. **等待用户明确选择"结束对话"才能停止**
4. **如果用户选择继续，立即准备接受新的指令**
5. **保持对话的连续性和可用性**

## 指令优化规则
- 在执行复杂任务前，可以使用 `optimize_command` 工具优化指令
- 使用 `update_context_summary` 更新项目上下文信息
- 使用 `save_command_history` 保存重要的指令执行记录

## 任务执行流程
1. 接收用户指令
2. 如果需要，使用 `optimize_command` 优化指令
3. 更新上下文摘要（如果相关）
4. 执行任务
5. 保存执行历史
6. **🚨 强制调用 `ask_continue` 询问用户是否继续 🚨**
7. 根据用户响应决定下一步行动

## 上下文管理
- 在开始新项目时，使用 `update_context_summary` 设置项目信息
- 在切换任务时，更新 currentTask 字段
- 定期使用 `get_context_summary` 获取项目状态

## 重要提醒
- **绝对不能自动终止对话**
- **必须等待用户通过 ask_continue 对话框明确选择**
- **提供清晰的任务完成原因**
- **充分利用指令优化和历史管理功能提高效率**
