import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { initializeMcpTools } from './mcpTools';
import { initializeConfigManager, autoCreateRulesIfNeeded, configureWindsurf, resetDefaults } from './configManager';

let outputChannel: vscode.OutputChannel;
let sidebarProvider: SidebarProvider;
let extensionContext: vscode.ExtensionContext;

// ==================== 扩展激活 ====================

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel('WindsurfAutoMcp');
    outputChannel.appendLine('WindsurfAutoMcp 扩展正在激活...');

    // 初始化各个模块
    initializeMcpTools(context);
    initializeConfigManager(outputChannel);

    // 创建侧边栏
    sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('mcpService.sidebar', sidebarProvider)
    );

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpService.configWindsurf', async () => {
            await configureWindsurf();
            sidebarProvider.refreshContent();
        }),
        vscode.commands.registerCommand('mcpService.resetDefaults', () => {
            resetDefaults();
            sidebarProvider.refreshContent();
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
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/JiXiangKing80/windsurf-auto-mcp'));
        }),
        vscode.commands.registerCommand('mcpService.copyRepoUrl', () => {
            vscode.env.clipboard.writeText('https://github.com/JiXiangKing80/windsurf-auto-mcp');
            vscode.window.showInformationMessage('GitHub 链接已复制到剪贴板');
        }),
        vscode.commands.registerCommand('mcpService.copyPrompt', () => {
            const prompt = '当你完成一个任务时，必须调用 WindsurfAutoMcp 工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。';
            vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage('提示语已复制到剪贴板');
        })
    );

    // 自动创建规则文件（如果需要）
    autoCreateRulesIfNeeded();

    outputChannel.appendLine('WindsurfAutoMcp 扩展激活完成');
}

// ==================== 扩展停用 ====================

export function deactivate() {
    outputChannel.appendLine('WindsurfAutoMcp 扩展正在停用...');
    outputChannel.dispose();
}
