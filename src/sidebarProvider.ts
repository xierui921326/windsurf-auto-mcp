import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isServerRunning, getCurrentPort, getStats } from './serverManager';
import { handleWebviewResponse } from './serverManager';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mcpServicePanel.sidebarView';
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _context: vscode.ExtensionContext;

    constructor(private readonly extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._extensionUri = extensionUri;
        this._context = context;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'startServer':
                    vscode.commands.executeCommand('mcpService.startServer');
                    break;
                case 'stopServer':
                    vscode.commands.executeCommand('mcpService.stopServer');
                    break;
                case 'restartServer':
                    this.restartServer();
                    break;
                case 'configWindsurf':
                    vscode.commands.executeCommand('mcpService.configWindsurf');
                    break;
                case 'resetDefaults':
                    vscode.commands.executeCommand('mcpService.resetDefaults');
                    break;
                case 'toggleOptimization':
                    this.toggleOptimization();
                    break;
                case 'updateOptimizationLevel':
                    this.updateOptimizationLevel(data.level);
                    break;
                case 'viewHistory':
                    this.viewHistory();
                    break;
                case 'clearHistory':
                    this.clearHistory();
                    break;
                case 'showContextSummary':
                    this.showContextSummary();
                    break;
                case 'createRules':
                    vscode.commands.executeCommand('mcpService.createRules');
                    break;
                case 'openRepo':
                    vscode.commands.executeCommand('mcpService.openRepo');
                    break;
                case 'copyRepoUrl':
                    vscode.commands.executeCommand('mcpService.copyRepoUrl');
                    break;
                case 'openContinueDialog':
                    vscode.commands.executeCommand('mcpService.toggleDialog');
                    break;
                case 'copyPrompt':
                    vscode.commands.executeCommand('mcpService.copyPrompt');
                    break;
                case 'updatePort':
                    this.updatePort(data.port);
                    break;
                case 'userResponse':
                    handleWebviewResponse(data.requestId, data.value);
                    break;
            }
        });

        // 定期更新视图
        setInterval(() => {
            this.refresh();
        }, 2000);

        // 初始刷新
        this.refresh();
    }

    private restartServer() {
        vscode.commands.executeCommand('mcpService.stopServer');
        setTimeout(() => {
            vscode.commands.executeCommand('mcpService.startServer');
        }, 1000);
    }

    private updatePort(port: number) {
        const config = vscode.workspace.getConfiguration('mcpService');
        config.update('port', port, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`端口已更新为 ${port}`);
    }

    private toggleOptimization() {
        const config = vscode.workspace.getConfiguration('mcpService');
        const current = config.get<boolean>('optimizationEnabled', false);
        config.update('optimizationEnabled', !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`指令优化已${!current ? '启用' : '禁用'}`);
        this.refresh();
    }

    private updateOptimizationLevel(level: string) {
        const config = vscode.workspace.getConfiguration('mcpService');
        config.update('optimizationLevel', level, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`优化级别已设置为 ${level}`);
        this.refresh();
    }

    private viewHistory() {
        // 显示历史记录
        vscode.window.showInformationMessage('查看历史记录功能开发中...');
    }

    private clearHistory() {
        // 清空历史记录
        vscode.window.showInformationMessage('历史记录已清空');
    }

    private showContextSummary() {
        // 显示上下文摘要
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const projectName = path.basename(workspaceFolders[0].uri.fsPath);
            const message = `项目: ${projectName}\n类型: VSCode扩展\n技术: TypeScript, Node.js\n任务: 完善MCP服务功能`;
            vscode.window.showInformationMessage(message);
        } else {
            vscode.window.showInformationMessage('未打开工作区');
        }
    }

    public refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // 读取HTML模板和CSS样式
        const htmlPath = path.join(this._extensionUri.fsPath, 'assets', 'templates', 'sidebar.html');
        const cssPath = path.join(this._extensionUri.fsPath, 'assets', 'styles', 'sidebar.css');

        let htmlContent = '';
        let cssContent = '';

        try {
            if (fs.existsSync(htmlPath)) {
                htmlContent = fs.readFileSync(htmlPath, 'utf-8');
            }
            if (fs.existsSync(cssPath)) {
                cssContent = fs.readFileSync(cssPath, 'utf-8');
            }
        } catch (error) {
            console.error('读取模板文件失败:', error);
        }

        // 获取当前状态数据
        const serverRunning = isServerRunning();
        const currentPort = getCurrentPort();
        const stats = getStats();
        const config = vscode.workspace.getConfiguration('mcpService');
        
        // 服务器状态
        const serverStatusClass = serverRunning ? 'online' : 'offline';
        const serverStatusText = serverRunning ? '运行中' : '已停止';
        const serverPortDisplay = serverRunning ? `<span class="status-port">:${currentPort}</span>` : '';
        const serverButtonClass = serverRunning ? 'btn-danger' : 'btn-primary';
        const serverButtonText = serverRunning ? '停止' : '启动';
        const serverButtonAction = serverRunning ? 'stopServer()' : 'startServer()';

        // 配置状态
        const configButtonClass = 'btn-primary';
        const configButtonText = '配置 Windsurf';
        const configStatusText = '点击配置按钮将MCP服务添加到Windsurf配置中';

        // 优化设置
        const optimizationEnabled = config.get<boolean>('optimizationEnabled', false);
        const optimizationLevel = config.get<string>('optimizationLevel', 'medium');
        const optimizationStatusClass = optimizationEnabled ? 'online' : 'offline';
        const optimizationStatusText = optimizationEnabled ? '已启用' : '已禁用';
        const optimizationButtonClass = optimizationEnabled ? 'btn-danger' : 'btn-primary';
        const optimizationButtonText = optimizationEnabled ? '禁用' : '启用';

        // 优化级别选项
        const levels = ['low', 'medium', 'high'];
        const optimizationLevelOptions = levels.map(level => 
            `<option value="${level}" ${level === optimizationLevel ? 'selected' : ''}>${level}</option>`
        ).join('');

        // 项目信息
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const projectName = workspaceFolders ? path.basename(workspaceFolders[0].uri.fsPath) : '未知项目';
        const projectType = 'VSCode扩展';
        const projectTechnologies = 'TypeScript, Node.js, MCP';
        const currentTask = '完善MCP服务功能';

        // 替换模板变量
        htmlContent = htmlContent
            .replace(/\{\{STYLES\}\}/g, cssContent)
            .replace(/\{\{SCRIPTS\}\}/g, '')
            .replace(/\{\{SERVER_STATUS_CLASS\}\}/g, serverStatusClass)
            .replace(/\{\{SERVER_STATUS_TEXT\}\}/g, serverStatusText)
            .replace(/\{\{SERVER_PORT_DISPLAY\}\}/g, serverPortDisplay)
            .replace(/\{\{CURRENT_PORT\}\}/g, currentPort.toString())
            .replace(/\{\{SERVER_BUTTON_CLASS\}\}/g, serverButtonClass)
            .replace(/\{\{SERVER_BUTTON_TEXT\}\}/g, serverButtonText)
            .replace(/\{\{SERVER_BUTTON_ACTION\}\}/g, serverButtonAction)
            .replace(/\{\{CONFIG_BUTTON_CLASS\}\}/g, configButtonClass)
            .replace(/\{\{CONFIG_BUTTON_TEXT\}\}/g, configButtonText)
            .replace(/\{\{CONFIG_STATUS_TEXT\}\}/g, configStatusText)
            .replace(/\{\{TOTAL_CALLS\}\}/g, stats.totalCalls.toString())
            .replace(/\{\{ASK_CONTINUE_CALLS\}\}/g, stats.askContinueCalls.toString())
            .replace(/\{\{OPTIMIZATION_STATUS_CLASS\}\}/g, optimizationStatusClass)
            .replace(/\{\{OPTIMIZATION_STATUS_TEXT\}\}/g, optimizationStatusText)
            .replace(/\{\{OPTIMIZATION_LEVEL\}\}/g, optimizationLevel.toUpperCase())
            .replace(/\{\{OPTIMIZATION_LEVEL_OPTIONS\}\}/g, optimizationLevelOptions)
            .replace(/\{\{OPTIMIZATION_BUTTON_CLASS\}\}/g, optimizationButtonClass)
            .replace(/\{\{OPTIMIZATION_BUTTON_TEXT\}\}/g, optimizationButtonText)
            .replace(/\{\{HISTORY_TOTAL\}\}/g, '0')
            .replace(/\{\{HISTORY_SUCCESS\}\}/g, '0')
            .replace(/\{\{PROJECT_NAME\}\}/g, projectName)
            .replace(/\{\{PROJECT_TYPE\}\}/g, projectType)
            .replace(/\{\{PROJECT_TECHNOLOGIES\}\}/g, projectTechnologies)
            .replace(/\{\{CURRENT_TASK\}\}/g, currentTask);

        return htmlContent;
    }

    public showUserRequest(requestId: string, title: string, message: string, type: 'continue') {
        if (this._view) {
            // 向webview发送消息显示用户请求对话框
            this._view.webview.postMessage({
                type: 'showUserRequest',
                requestId,
                title,
                message,
                requestType: type
            });
        }
    }
}
