# Windsurf Rules - WindsurfAutoMcp Enhanced

## 全局规则
当你完成一个任务时，必须调用 WindsurfAutoMcp 工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。

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
6. 调用 `ask_continue` 询问用户是否继续

## 使用示例
- 完成代码修改后，调用 ask_continue
- 完成文件创建后，调用 ask_continue
- 完成调试分析后，调用 ask_continue
- 完成项目配置后，调用 ask_continue

## 上下文管理
- 在开始新项目时，使用 `update_context_summary` 设置项目信息
- 在切换任务时，更新 currentTask 字段
- 定期使用 `get_context_summary` 获取项目状态

## 注意事项
- 不要在中途频繁询问，只在任务完成时询问
- 提供清晰的任务完成原因
- 等待用户确认后再继续下一个任务
- 充分利用指令优化和历史管理功能提高效率
