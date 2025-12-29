import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let outputChannel: vscode.OutputChannel;

export function initializeConfigManager(channel: vscode.OutputChannel) {
    outputChannel = channel;
}

// 创建 Windsurf 规则文件
export async function createWindsurfRules(autoCreate: boolean = false) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        if (!autoCreate) {
            vscode.window.showErrorMessage('请先打开一个工作区');
        }
        return false;
    }

    // 从 assets/rules 目录读取规则模板
    const extensionPath = path.dirname(path.dirname(__dirname));
    const rulesTemplatePath = path.join(extensionPath, 'assets', 'rules', 'windsurf-rules.md');

    let rulesContent: string;
    try {
        if (fs.existsSync(rulesTemplatePath)) {
            rulesContent = fs.readFileSync(rulesTemplatePath, 'utf-8');
        } else {
            // 如果模板文件不存在，使用默认内容
            rulesContent = `<!-- WINDSURF_AUTO_MCP_V1 -->
# WINDSURF AUTO MCP - 对话流程控制规则

## 核心规则

**每次回复结束前，必须调用 \`windsurf_auto_mcp\` MCP 工具。**

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

\`\`\`json
{
  "reason": "简短说明暂停原因",
  "workspace": "当前工作区的完整路径（必填）"
}
\`\`\`

### 示例

\`\`\`json
{ "reason": "任务完成，等待下一步指令", "workspace": "/Users/xxx/project" }
\`\`\`

**重要**：\`workspace\` 参数是**必填**的，必须传递当前工作区的完整路径，否则多窗口功能无法正常工作。

## 禁止行为

调用 windsurf_auto_mcp 之前，不要：

- 说"如果有其他问题请告诉我"
- 说"祝编程愉快"
- 说"再见"或类似结束语
- 假设对话已结束

## 响应结构

\`\`\`
[完成任务或回答问题]

[简要总结]

[调用 windsurf_auto_mcp 工具]
\`\`\`

## 处理用户响应

当 windsurf_auto_mcp 返回：

- \`should_continue = true\`：继续工作，读取用户新指令
- \`should_continue = false\`：用户选择结束，可以道别

---

**记住：用户控制对话何时结束，不是 AI。**

IMPORTANT GUIDELINES:
1. Read the relevant files first before making any changes
2. Only modify what is necessary, do not refactor other parts
3. Keep the existing code style and naming conventions
4. Do not delete existing functions or comments
5. Ask before modifying if unsure
6. Verify the code after changes to ensure no syntax errors
`;
        }
    } catch (error) {
        if (!autoCreate) {
            vscode.window.showErrorMessage(`读取规则模板失败: ${error} `);
        }
        return false;
    }

    const rulesDir = path.join(workspaceFolders[0].uri.fsPath, '.windsurf', 'rules');
    const rulesPath = path.join(rulesDir, 'rules.md');

    try {
        // 检查文件是否已存在
        if (fs.existsSync(rulesPath) && !autoCreate) {
            const choice = await vscode.window.showInformationMessage(
                '规则文件已存在，是否覆盖？',
                '覆盖', '取消'
            );
            if (choice !== '覆盖') {
                return false;
            }
        }

        // 确保.windsurf目录存在
        if (!fs.existsSync(rulesDir)) {
            fs.mkdirSync(rulesDir, { recursive: true });
        }

        fs.writeFileSync(rulesPath, rulesContent, 'utf-8');

        if (!autoCreate) {
            vscode.window.showInformationMessage(`规则文件已创建: ${rulesPath} `);
            // 打开文件
            const doc = await vscode.workspace.openTextDocument(rulesPath);
            await vscode.window.showTextDocument(doc);
        }

        return true;
    } catch (error) {
        if (!autoCreate) {
            vscode.window.showErrorMessage(`创建规则文件失败: ${error} `);
        }
        return false;
    }
}

// 自动创建规则文件（在打开工作区时）
export async function autoCreateRulesIfNeeded() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const rulesDir = path.join(workspaceFolders[0].uri.fsPath, '.windsurf', 'rules');
    const rulesPath = path.join(rulesDir, 'rules.md');

    // 如果规则文件不存在，自动创建
    if (!fs.existsSync(rulesPath)) {
        const success = await createWindsurfRules(true);
        if (success && outputChannel) {
            outputChannel.appendLine('已自动创建 .windsurf/rules/rules.md 文件');
        }
    }
}

// 配置 Windsurf MCP
export async function configureWindsurf() {
    try {
        const homeDir = os.homedir();

        // 获取配置的端口号
        const config = vscode.workspace.getConfiguration('mcpService');
        const port = config.get<number>('port', 3456);

        // 支持多个配置路径，兼容不同版本的编辑器
        const configPaths = [
            path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
            path.join(homeDir, '.codeium', 'windsurf-next', 'mcp_config.json'),
            path.join(homeDir, '.codeium', 'mcp_config.json'),
            path.join(homeDir, '.windsurf', 'mcp_config.json'), // 可能的新路径
        ];

        let configFound = false;
        let updatedPaths: string[] = [];

        // HTTP 模式配置 - 使用本地 HTTP 服务器
        const httpServerUrl = `http://localhost:${port}`;

        for (const configPath of configPaths) {
            const configDir = path.dirname(configPath);

            try {
                let mcpConfig: any = {};

                // 如果配置文件存在，读取现有配置
                if (fs.existsSync(configPath)) {
                    const content = fs.readFileSync(configPath, 'utf-8');
                    try {
                        mcpConfig = JSON.parse(content);
                        configFound = true;
                    } catch (error) {
                        outputChannel.appendLine(`配置文件解析失败 ${configPath}: ${error}`);
                        mcpConfig = {};
                    }
                } else {
                    // 如果配置文件不存在，但目录存在，则可以创建配置文件
                    if (fs.existsSync(configDir)) {
                        configFound = true;
                    } else {
                        // 尝试创建目录
                        try {
                            fs.mkdirSync(configDir, { recursive: true });
                            configFound = true;
                            outputChannel.appendLine(`已创建配置目录: ${configDir}`);
                        } catch (error) {
                            outputChannel.appendLine(`无法创建配置目录 ${configDir}: ${error}`);
                            continue;
                        }
                    }
                }

                if (!mcpConfig.mcpServers) {
                    mcpConfig.mcpServers = {};
                }

                // 检查是否已经存在正确的 HTTP 模式配置
                const existingConfig = mcpConfig.mcpServers['windsurf_auto_mcp'];
                if (existingConfig &&
                    existingConfig.serverUrl === httpServerUrl) {
                    // 配置已存在且正确，跳过此文件
                    outputChannel.appendLine(`配置文件 ${configPath} 中已存在正确的 HTTP 模式配置，跳过更新`);
                    continue;
                }

                // 添加或更新 windsurf_auto_mcp 配置（使用 HTTP 模式）
                // 同时删除旧的 stdio 模式配置（如果存在 command 字段）
                mcpConfig.mcpServers['windsurf_auto_mcp'] = {
                    serverUrl: httpServerUrl
                };

                // 写入配置文件
                fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
                updatedPaths.push(configPath);

                outputChannel.appendLine(`已更新配置文件 (HTTP模式): ${configPath}`);

            } catch (error) {
                outputChannel.appendLine(`更新配置文件失败 ${configPath}: ${error}`);
            }
        }

        if (updatedPaths.length > 0) {
            vscode.window.showInformationMessage(
                `Windsurf 配置已更新为 HTTP 模式！\n服务器地址: ${httpServerUrl}\n已更新 ${updatedPaths.length} 个配置文件\n请重启 Windsurf 以生效。`
            );
        } else if (!configFound) {
            // 如果没有找到任何配置文件，创建默认配置
            const defaultConfigPath = path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json');
            const configDir = path.dirname(defaultConfigPath);

            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            const defaultConfig = {
                mcpServers: {
                    windsurf_auto_mcp: {
                        serverUrl: httpServerUrl
                    }
                }
            };

            fs.writeFileSync(defaultConfigPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');

            vscode.window.showInformationMessage(
                `已创建默认 Windsurf 配置 (HTTP模式)！\n服务器地址: ${httpServerUrl}\n配置文件: ${defaultConfigPath}\n请重启 Windsurf 以生效。`
            );

            outputChannel.appendLine(`已创建默认配置文件 (HTTP模式): ${defaultConfigPath}`);
        } else {
            outputChannel.appendLine('所有配置文件已是最新状态');
        }

    } catch (error) {
        const errorMsg = `配置 Windsurf 失败: ${error}`;
        outputChannel.appendLine(errorMsg);
        vscode.window.showErrorMessage(errorMsg);
        return false;
    }
}


// 重置默认设置
export function resetDefaults() {
    const config = vscode.workspace.getConfiguration('mcpService');
    config.update('port', 3456, vscode.ConfigurationTarget.Global);
    config.update('autoStart', true, vscode.ConfigurationTarget.Global);
    config.update('defaultReason', '任务已完成', vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage('已恢复默认设置');
}
