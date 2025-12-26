import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { optimizationSettings, commandHistory, contextSummary, saveOptimizationData } from './mcpTools';
import { createWindsurfRules } from './configManager';

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
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

        webviewView.webview.html = this._getHtmlContent();

        webviewView.webview.onDidReceiveMessage((message: any) => {
            switch (message.type) {
                case 'configWindsurf':
                    vscode.commands.executeCommand('mcpService.configWindsurf');
                    break;
                case 'resetDefaults':
                    vscode.commands.executeCommand('mcpService.resetDefaults');
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
                case 'copyPrompt':
                    vscode.commands.executeCommand('mcpService.copyPrompt');
                    break;
                case 'viewHistory':
                    this.showCommandHistory();
                    break;
                case 'clearHistory':
                    commandHistory.length = 0;
                    saveOptimizationData();
                    vscode.window.showInformationMessage('历史记录已清空');
                    this.refreshContent();
                    break;
                case 'toggleOptimization':
                    optimizationSettings.enabled = !optimizationSettings.enabled;
                    saveOptimizationData();
                    vscode.window.showInformationMessage(`指令优化${optimizationSettings.enabled ? '已启用' : '已禁用'}`);
                    this.refreshContent();
                    break;
                case 'updateOptimizationLevel':
                    if (message.level) {
                        optimizationSettings.optimizationLevel = message.level;
                        saveOptimizationData();
                        vscode.window.showInformationMessage(`优化级别已设置为: ${message.level}`);
                        this.refreshContent();
                    }
                    break;
                case 'showContextSummary':
                    this.showContextSummary();
                    break;
            }
        });
    }

    refreshContent() {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    showCommandHistory() {
        const historyText = commandHistory.slice(0, 20).map((entry, index) => {
            const date = new Date(entry.timestamp).toLocaleString('zh-CN');
            const status = entry.success ? '✓' : '✗';
            let text = `${index + 1}. [${status}] ${date}\n   ${entry.command}`;
            if (entry.optimized && entry.optimized !== entry.command) {
                text += `\n   优化: ${entry.optimized}`;
            }
            return text;
        }).join('\n\n');
        
        vscode.window.showInformationMessage(
            `历史指令记录（显示最近20条）：\n\n${historyText || '暂无历史记录'}`,
            { modal: true }
        );
    }

    showContextSummary() {
        const lastUpdateText = contextSummary.lastUpdate 
            ? new Date(contextSummary.lastUpdate).toLocaleString('zh-CN')
            : '未知';
        
        vscode.window.showInformationMessage(
            `项目上下文摘要：\n\n` +
            `项目名称：${contextSummary.projectName || '未设置'}\n` +
            `项目类型：${contextSummary.projectType || '未设置'}\n` +
            `主要技术：${contextSummary.mainTechnologies.join(', ') || '未设置'}\n` +
            `当前任务：${contextSummary.currentTask || '未设置'}\n` +
            `最后更新：${lastUpdateText}`,
            { modal: true }
        );
    }

    private _getHtmlContent(): string {
        // 检查配置状态
        const configPaths = [
            path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
            path.join(os.homedir(), '.codeium', 'windsurf-next', 'mcp_config.json'),
            path.join(os.homedir(), '.codeium', 'mcp_config.json'),
            path.join(os.homedir(), '.cursor', 'mcp.json'),
            path.join(os.homedir(), '.windsurf', 'mcp_config.json')
        ];
        
        let isConfigured = false;
        for (const configPath of configPaths) {
            try {
                if (fs.existsSync(configPath)) {
                    const configContent = fs.readFileSync(configPath, 'utf-8');
                    const config = JSON.parse(configContent);
                    if (config.mcpServers && config.mcpServers.windsurf_auto_mcp) {
                        isConfigured = true;
                        break;
                    }
                }
            } catch (error) {
                // 忽略错误，继续检查下一个路径
            }
        }

        return this._generateHtmlFromTemplate(isConfigured);
    }

    private _generateHtmlFromTemplate(isConfigured: boolean): string {
        try {
            const extensionPath = path.dirname(path.dirname(__dirname));
            const templatePath = path.join(extensionPath, 'assets', 'templates', 'sidebar.html');
            const stylesPath = path.join(extensionPath, 'assets', 'styles', 'sidebar.css');
            const scriptsPath = path.join(extensionPath, 'assets', 'scripts', 'sidebar.js');
            
            let template = '';
            let styles = '';
            let scripts = '';
            
            if (fs.existsSync(templatePath)) {
                template = fs.readFileSync(templatePath, 'utf-8');
            }
            if (fs.existsSync(stylesPath)) {
                styles = fs.readFileSync(stylesPath, 'utf-8');
            }
            if (fs.existsSync(scriptsPath)) {
                scripts = fs.readFileSync(scriptsPath, 'utf-8');
            }
            
            if (template) {
                return this._replaceTemplateVariables(template, styles, scripts, isConfigured);
            }
        } catch (error) {
            // 模板文件读取失败，使用回退内容
        }
        
        return this._getFallbackHtmlContent(isConfigured);
    }

    private _replaceTemplateVariables(template: string, styles: string, scripts: string, isConfigured: boolean): string {
        const variables = {
            '{{STYLES}}': styles,
            '{{SCRIPTS}}': scripts,
            '{{CONFIG_BUTTON_CLASS}}': isConfigured ? 'btn-configured' : 'btn-primary',
            '{{CONFIG_BUTTON_TEXT}}': isConfigured ? '✓ 已写入配置' : '写入 Windsurf 配置',
            '{{CONFIG_STATUS_TEXT}}': isConfigured ? '配置已写入，请重启 Windsurf 生效' : '点击按钮将 MCP 服务信息写入 Windsurf 配置文件',
            '{{OPTIMIZATION_STATUS_CLASS}}': optimizationSettings.enabled ? 'online' : 'offline',
            '{{OPTIMIZATION_STATUS_TEXT}}': optimizationSettings.enabled ? '已启用' : '已禁用',
            '{{OPTIMIZATION_LEVEL}}': optimizationSettings.optimizationLevel,
            '{{OPTIMIZATION_LEVEL_OPTIONS}}': this._generateOptimizationOptions(),
            '{{OPTIMIZATION_BUTTON_CLASS}}': optimizationSettings.enabled ? 'btn-danger' : 'btn-success',
            '{{OPTIMIZATION_BUTTON_TEXT}}': optimizationSettings.enabled ? '禁用优化' : '启用优化',
            '{{HISTORY_TOTAL}}': commandHistory.length.toString(),
            '{{HISTORY_SUCCESS}}': commandHistory.filter(h => h.success).length.toString(),
            '{{PROJECT_NAME}}': contextSummary.projectName || '未设置',
            '{{PROJECT_TYPE}}': contextSummary.projectType || '未设置',
            '{{PROJECT_TECHNOLOGIES}}': contextSummary.mainTechnologies.slice(0, 2).join(', ') || '未设置' + (contextSummary.mainTechnologies.length > 2 ? '...' : ''),
            '{{CURRENT_TASK}}': contextSummary.currentTask ? (contextSummary.currentTask.length > 20 ? contextSummary.currentTask.substring(0, 20) + '...' : contextSummary.currentTask) : '未设置'
        };

        let result = template;
        for (const [placeholder, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(placeholder, 'g'), value);
        }

        return result;
    }

    private _generateOptimizationOptions(): string {
        const levels = ['low', 'medium', 'high'];
        const labels = { low: '低级', medium: '中级', high: '高级' };
        return levels.map(level => 
            `<option value="${level}" ${optimizationSettings.optimizationLevel === level ? 'selected' : ''}>${labels[level as keyof typeof labels]}</option>`
        ).join('');
    }

    private _getFallbackHtmlContent(isConfigured: boolean): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WindsurfAutoMcp</title>
    <style>
        body { 
            font-family: var(--vscode-font-family); 
            padding: 16px; 
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
        }
        .card { 
            background: var(--vscode-menu-background); 
            border: 1px solid var(--vscode-panel-border); 
            border-radius: 6px; 
            padding: 16px; 
            margin-bottom: 16px; 
        }
        .btn { 
            padding: 8px 16px; 
            border: 1px solid var(--vscode-panel-border); 
            border-radius: 4px; 
            background: var(--vscode-button-background); 
            color: var(--vscode-button-foreground); 
            cursor: pointer; 
            width: 100%;
            margin-bottom: 8px;
        }
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-configured {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }
        h3 { margin-top: 0; }
        .status { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 8px; }
    </style>
</head>
<body>
    <div class="card">
        <h3>开源与免费</h3>
        <p style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px;">
            本插件完全免费。开源地址：https://github.com/JiXiangKing80/windsurf-auto-mcp
        </p>
        <button class="btn" onclick="openRepo()">打开 GitHub</button>
        <button class="btn" onclick="copyRepoUrl()">复制链接</button>
    </div>

    <div class="card">
        <h3>Windsurf 配置</h3>
        <button class="btn ${isConfigured ? 'btn-configured' : ''}" onclick="configWindsurf()">
            ${isConfigured ? '✓ 已写入配置' : '写入 Windsurf 配置'}
        </button>
        <p class="status">
            ${isConfigured ? '配置已写入，请重启 Windsurf 生效' : '点击按钮将 MCP 服务信息写入 Windsurf 配置文件'}
        </p>
    </div>

    <div class="card">
        <h3>提示语</h3>
        <p style="font-size: 12px; margin-bottom: 12px;">
            当你完成一个任务时，必须调用 WindsurfAutoMcp 工具询问用户是否继续。
        </p>
        <button class="btn" onclick="copyPrompt()">复制提示语</button>
    </div>

    <div class="card">
        <h3>规则文件</h3>
        <p style="font-size: 12px; margin-bottom: 12px;">
            自动创建 .windsurf/rules.md 文件，包含增强功能的使用规则
        </p>
        <button class="btn" onclick="createRules()">创建/更新规则文件</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function configWindsurf() {
            vscode.postMessage({ type: 'configWindsurf' });
        }
        
        function createRules() {
            vscode.postMessage({ type: 'createRules' });
        }
        
        function openRepo() {
            vscode.postMessage({ type: 'openRepo' });
        }
        
        function copyRepoUrl() {
            vscode.postMessage({ type: 'copyRepoUrl' });
        }
        
        function copyPrompt() {
            vscode.postMessage({ type: 'copyPrompt' });
        }
    </script>
</body>
</html>`;
    }
}
