import * as vscode from 'vscode';
import { initializeMcpTools } from './mcpTools';
import { initializeConfigManager, autoCreateRulesIfNeeded, configureWindsurf, resetDefaults, notifyWindsurfRefresh } from './configManager';
import { initializeServerManager, startServer, stopServer, restartServer } from './serverManager';
import { SidebarProvider } from './sidebarProvider';

let outputChannel: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;
let sidebarProvider: SidebarProvider;

// ==================== 扩展激活 ====================

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel('WindsurfAutoMcp');
    outputChannel.appendLine('WindsurfAutoMcp 扩展正在激活...');

    // 初始化各个模块
    initializeMcpTools(context);
    initializeConfigManager(outputChannel);
    initializeServerManager(context, outputChannel);


    // 初始化侧边栏提供者
    sidebarProvider = new SidebarProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider)
    );

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpService.configWindsurf', async () => {
            await configureWindsurf();
            vscode.window.showInformationMessage('Windsurf配置已更新');
        }),
        vscode.commands.registerCommand('mcpService.resetDefaults', () => {
            resetDefaults();
            vscode.window.showInformationMessage('设置已重置为默认值');
        }),
        vscode.commands.registerCommand('mcpService.createRules', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                await autoCreateRulesIfNeeded();
                vscode.window.showInformationMessage('规则文件已创建/更新');
            } else {
                vscode.window.showWarningMessage('请先打开一个工作区');
            }
        }),
        vscode.commands.registerCommand('mcpService.openRepo', () => {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/xierui921326/windsurf-auto-mcp'));
        }),
        vscode.commands.registerCommand('mcpService.copyRepoUrl', () => {
            vscode.env.clipboard.writeText('https://github.com/xierui921326/windsurf-auto-mcp');
            vscode.window.showInformationMessage('GitHub 链接已复制到剪贴板');
        }),
        vscode.commands.registerCommand('mcpService.copyPrompt', () => {
            const prompt = '当你完成一个任务时，必须调用 windsurf_auto_mcp 工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。';
            vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage('提示语已复制到剪贴板');
        }),
        vscode.commands.registerCommand('mcpService.showInputDialog', (requestId: string, title: string, message: string, allowImage: boolean = false) => {
            // 显示用户请求到侧边栏
            sidebarProvider.showUserRequest(requestId, title, message, 'input');
        }),
        vscode.commands.registerCommand('mcpService.showContinueDialog', (requestId: string, reason: string) => {
            // 显示继续对话请求到侧边栏
            sidebarProvider.showUserRequest(requestId, '继续对话', reason, 'continue');
        }),
        vscode.commands.registerCommand('mcpService.recordCascadeCommand', (command: string) => {
            // 记录Cascade执行的指令到历史
            sidebarProvider.recordCascadeCommandToHistory(command);
            return { success: true };
        }),
        vscode.commands.registerCommand('mcpService.startServer', () => {
            const config = vscode.workspace.getConfiguration('mcpService');
            const port = config.get<number>('port', 3456);
            startServer(port);
        }),
        vscode.commands.registerCommand('mcpService.stopServer', () => {
            stopServer();
        }),
        vscode.commands.registerCommand('mcpService.restartServer', () => {
            restartServer();
        }),
        vscode.commands.registerCommand('mcpService.toggleDialog', () => {
            // 显示侧边栏面板
            vscode.commands.executeCommand('workbench.view.extension.mcpServicePanel');
        }),
        vscode.commands.registerCommand('mcpService.optimizeCommand', async (requestId: string, command: string, context?: string) => {
            // 使用sidebarProvider的优化功能
            return await sidebarProvider.optimizeCommandExternally(requestId, command, context);
        })
    );

    // 自动创建规则文件（如果需要）
    autoCreateRulesIfNeeded();

    // 改进的启动序列：先配置，再启动服务器，最后通知Windsurf刷新
    const config = vscode.workspace.getConfiguration('mcpService');
    const autoStart = config.get<boolean>('autoStart', true);

    if (autoStart) {
        // 延迟启动，确保扩展完全加载
        setTimeout(async () => {
            try {
                // 1. 先配置 Windsurf MCP
                await configureWindsurf();
                outputChannel.appendLine('Windsurf MCP 配置完成');

                // 2. 启动服务器
                const port = config.get<number>('port', 3456);
                await startServer(port);
                outputChannel.appendLine('MCP 服务器已启动');

                // 3. 等待服务器完全启动后，通知Windsurf刷新MCP配置
                setTimeout(async () => {
                    await notifyWindsurfRefresh();
                    outputChannel.appendLine('已通知Windsurf刷新MCP配置');
                }, 2000);

            } catch (error) {
                outputChannel.appendLine(`自动启动失败: ${error}`);
            }
        }, 1000);
    } else {
        // 即使不自动启动服务器，也要检查配置
        setTimeout(async () => {
            try {
                await configureWindsurf();
                outputChannel.appendLine('Windsurf MCP 配置检查完成');
            } catch (error) {
                outputChannel.appendLine(`Windsurf MCP 配置检查失败: ${error}`);
            }
        }, 500);
    }

    // 检查是否需要自动显示界面
    const autoShowChat = config.get<boolean>('autoShowChat', false);

    if (autoShowChat) {
        // 延迟一秒后自动打开侧边栏界面
        setTimeout(() => {
            vscode.commands.executeCommand('workbench.view.extension.mcpServicePanel');
        }, 2000);
        outputChannel.appendLine('WindsurfAutoMcp 界面已自动打开');
    } else {
        outputChannel.appendLine('WindsurfAutoMcp 界面可通过 Ctrl+M 或命令面板打开');
    }

    outputChannel.appendLine('WindsurfAutoMcp 扩展激活完成');
}

// ==================== 扩展停用 ====================

export function deactivate() {
    outputChannel.appendLine('WindsurfAutoMcp 扩展正在停用...');
    outputChannel.dispose();
}
