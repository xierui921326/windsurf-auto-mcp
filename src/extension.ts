import * as vscode from 'vscode';
import { initializeMcpTools } from './mcpTools';
import { initializeConfigManager, autoCreateRulesIfNeeded, configureWindsurf, resetDefaults } from './configManager';
import { ChatProvider } from './chatProvider';
import { initializeServerManager, startServer, stopServer } from './serverManager';

let outputChannel: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;
let chatProvider: ChatProvider;

// ==================== 扩展激活 ====================

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel('WindsurfAutoMcp');
    outputChannel.appendLine('WindsurfAutoMcp 扩展正在激活...');

    // 初始化各个模块
    initializeMcpTools(context);
    initializeConfigManager(outputChannel);
    initializeServerManager(context, outputChannel);

    // 初始化聊天提供者
    chatProvider = new ChatProvider(context.extensionUri);
    chatProvider.setContext(context);
    
    // 注册聊天视图提供者
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('infiniteAsk.chatView', chatProvider)
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
            const prompt = '当你完成一个任务时，必须调用 WindsurfAutoMcp 工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。';
            vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage('提示语已复制到剪贴板');
        }),
        vscode.commands.registerCommand('mcpService.showInputDialog', (requestId: string, title: string, message: string, allowImage: boolean = false) => {
            chatProvider.showUserRequest(requestId, title, message, 'input', allowImage);
        }),
        vscode.commands.registerCommand('mcpService.showContinueDialog', (requestId: string, reason: string) => {
            chatProvider.showUserRequest(requestId, '继续对话', reason, 'continue', false);
        }),
        vscode.commands.registerCommand('mcpService.startServer', () => {
            const config = vscode.workspace.getConfiguration('mcpService');
            const port = config.get<number>('port', 3456);
            startServer(port);
        }),
        vscode.commands.registerCommand('mcpService.stopServer', () => {
            stopServer();
        }),
        vscode.commands.registerCommand('mcpService.showStats', () => {
            // 显示统计信息的逻辑可以后续添加
            vscode.window.showInformationMessage('统计功能开发中...');
        }),
        vscode.commands.registerCommand('mcpService.toggleDialog', () => {
            // 现在使用聊天界面，不需要打开面板
            vscode.window.showInformationMessage('请在侧边栏的 Infinite Ask 视图中进行对话');
        }),
        vscode.commands.registerCommand('mcpService.clearChatHistory', () => {
            if (chatProvider) {
                chatProvider.clearChatHistory();
            }
        })
    );

    // 自动创建规则文件（如果需要）
    autoCreateRulesIfNeeded();

    // 聊天界面已在侧边栏中可用
    outputChannel.appendLine('Infinite Ask 聊天界面已在侧边栏中可用');

    outputChannel.appendLine('WindsurfAutoMcp 扩展激活完成');
}

// ==================== 扩展停用 ====================

export function deactivate() {
    outputChannel.appendLine('WindsurfAutoMcp 扩展正在停用...');
    outputChannel.dispose();
}
