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
            rulesContent = `# Windsurf Rules - WindsurfAutoMcp Enhanced

## 全局规则
当你完成一个任务时，必须调用 WindsurfAutoMcp 工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。

## 指令优化规则
- 在执行复杂任务前，可以使用 \`optimize_command\` 工具优化指令
- 使用 \`update_context_summary\` 更新项目上下文信息
- 使用 \`save_command_history\` 保存重要的指令执行记录

## 任务执行流程
1. 接收用户指令
2. 如果需要，使用 \`optimize_command\` 优化指令
3. 更新上下文摘要（如果相关）
4. 执行任务
5. 保存执行历史
6. 调用 \`ask_continue\` 询问用户是否继续

## 使用示例
- 完成代码修改后，调用 ask_continue
- 完成文件创建后，调用 ask_continue
- 完成调试分析后，调用 ask_continue
- 完成项目配置后，调用 ask_continue

## 上下文管理
- 在开始新项目时，使用 \`update_context_summary\` 设置项目信息
- 在切换任务时，更新 currentTask 字段
- 定期使用 \`get_context_summary\` 获取项目状态

## 注意事项
- 不要在中途频繁询问，只在任务完成时询问
- 提供清晰的任务完成原因
- 等待用户确认后再继续下一个任务
- 充分利用指令优化和历史管理功能提高效率`;
        }
    } catch (error) {
        if (!autoCreate) {
            vscode.window.showErrorMessage(`读取规则模板失败: ${error}`);
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
            vscode.window.showInformationMessage(`规则文件已创建: ${rulesPath}`);
            // 打开文件
            const doc = await vscode.workspace.openTextDocument(rulesPath);
            await vscode.window.showTextDocument(doc);
        }

        return true;
    } catch (error) {
        if (!autoCreate) {
            vscode.window.showErrorMessage(`创建规则文件失败: ${error}`);
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
            path.join(homeDir, '.windsurf', 'mcp_config.json'), // 可能的新路径
            path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
            path.join(homeDir, '.codeium', 'windsurf-next', 'mcp_config.json'),
            path.join(homeDir, '.codeium', 'mcp_config.json'),
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
