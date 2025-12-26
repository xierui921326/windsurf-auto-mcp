import * as vscode from 'vscode';
import { handleWebviewResponse, isServerRunning, getCurrentPort, startServer, stopServer, getStats } from './serverManager';
import { optimizationSettings, saveOptimizationData, commandHistory, contextSummary } from './mcpTools';
import { configureWindsurf } from './configManager';

export class SplitPanelProvider {
    private static _instance: SplitPanelProvider;
    private _extensionUri: vscode.Uri;
    private _panel?: vscode.WebviewPanel;
    private _currentRequestId?: string;
    private _isWaitingForResponse = false;

    private constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    public static getInstance(extensionUri?: vscode.Uri): SplitPanelProvider {
        if (!SplitPanelProvider._instance && extensionUri) {
            SplitPanelProvider._instance = new SplitPanelProvider(extensionUri);
        }
        return SplitPanelProvider._instance;
    }

    public createOrShowPanel() {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'mcpSplitPanel',
            'Infinite Ask - MCP 交互面板',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true
            }
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
            this._currentRequestId = undefined;
            this._isWaitingForResponse = false;
        });

        this._panel.webview.onDidReceiveMessage((message: any) => {
            this._handleMessage(message);
        });

        this._updateContent();
    }

    public showInputDialog(requestId: string, title: string, message: string, allowImage: boolean = false) {
        this.createOrShowPanel();
        this._currentRequestId = requestId;
        this._isWaitingForResponse = true;
        
        if (this._panel) {
            this._panel.title = title;
            this._panel.webview.html = this._getInputDialogHtml(requestId, title, message, allowImage);
        }
    }

    public showContinueDialog(requestId: string, reason: string) {
        this.createOrShowPanel();
        this._currentRequestId = requestId;
        this._isWaitingForResponse = true;
        
        if (this._panel) {
            this._panel.title = '继续对话 - Infinite Ask';
            this._panel.webview.html = this._getContinueDialogHtml(requestId, reason);
        }
    }

    private _handleMessage(message: any) {
        switch (message.type) {
            case 'response':
                if (this._currentRequestId) {
                    handleWebviewResponse(this._currentRequestId, message.value);
                    this._isWaitingForResponse = false;
                    this._updateContent();
                }
                break;
            case 'cancel':
                if (this._currentRequestId) {
                    handleWebviewResponse(this._currentRequestId, null);
                    this._isWaitingForResponse = false;
                    this._updateContent();
                }
                break;
            case 'refresh':
                this._updateContent();
                break;
            case 'updateOptimization':
                this._handleOptimizationUpdate(message);
                break;
            case 'startServer':
                startServer();
                this._updateContent();
                break;
            case 'stopServer':
                stopServer();
                this._updateContent();
                break;
            case 'configWindsurf':
                this._handleConfigWindsurf();
                break;
        }
    }

    private _handleOptimizationUpdate(message: any) {
        const { field, value } = message;
        
        switch (field) {
            case 'enabled':
                optimizationSettings.enabled = value;
                break;
            case 'autoOptimize':
                optimizationSettings.autoOptimize = value;
                break;
            case 'optimizationLevel':
                optimizationSettings.optimizationLevel = value;
                break;
            case 'contextLength':
                optimizationSettings.contextLength = parseInt(value) || 1000;
                break;
            case 'includeProjectInfo':
                optimizationSettings.includeProjectInfo = value;
                break;
            case 'executionRules':
                optimizationSettings.executionRules = value;
                break;
            case 'apiKey':
                optimizationSettings.apiKey = value;
                break;
            case 'model':
                optimizationSettings.model = value;
                break;
            case 'optimizationRules':
                optimizationSettings.optimizationRules = value;
                break;
        }
        
        saveOptimizationData();
        this._updateContent();
        
        vscode.window.showInformationMessage('优化设置已更新');
    }

    private async _handleConfigWindsurf() {
        try {
            await configureWindsurf();
            vscode.window.showInformationMessage('Windsurf配置已更新');
            this._updateContent();
        } catch (error) {
            vscode.window.showErrorMessage(`配置失败: ${error}`);
        }
    }

    private _updateContent() {
        if (!this._panel) return;

        if (this._isWaitingForResponse) {
            return;
        }

        this._panel.title = 'Infinite Ask - MCP 交互面板';
        this._panel.webview.html = this._getDefaultHtml();
    }

    private _getDefaultHtml(): string {
        const serverRunning = isServerRunning();
        const currentPort = getCurrentPort();
        const stats = getStats();
        
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Infinite Ask - MCP 交互面板</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
            line-height: 1.6;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 8px;
            border-left: 4px solid var(--vscode-textBlockQuote-border);
        }
        .header h1 {
            margin: 0 0 10px 0;
            color: var(--vscode-textLink-foreground);
            font-size: 24px;
        }
        .card {
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .card h3 {
            margin: 0 0 15px 0;
            color: var(--vscode-textLink-foreground);
        }
        .status-indicator {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
        }
        .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }
        .status-dot.online {
            background: var(--vscode-testing-iconPassed);
        }
        .status-dot.offline {
            background: var(--vscode-testing-iconFailed);
        }
        .feature-list {
            list-style: none;
            padding: 0;
            margin: 15px 0;
        }
        .feature-list li {
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .feature-icon {
            color: var(--vscode-testing-iconPassed);
            font-weight: bold;
        }
        .btn {
            padding: 10px 20px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            cursor: pointer;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin: 10px 10px 10px 0;
        }
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-success {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }
        .btn-danger {
            background: var(--vscode-testing-iconFailed);
            color: white;
        }
        .btn-configured {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            box-sizing: border-box;
        }
        .form-group textarea {
            min-height: 80px;
            resize: vertical;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
        }
        .checkbox-group input[type="checkbox"] {
            width: auto;
        }
        .optimization-status {
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 15px;
            font-weight: bold;
        }
        .optimization-enabled {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }
        .optimization-disabled {
            background: var(--vscode-testing-iconFailed);
            color: white;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px;
            margin: 15px 0;
        }
        .stat-item {
            text-align: center;
            padding: 10px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
        }
        .stat-value {
            font-size: 18px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Infinite Ask</h1>
        <p>MCP 交互面板 - 无限续杯功能已就绪</p>
    </div>

    <div class="card">
        <h3>🖥️ 服务器状态</h3>
        <div class="status-indicator">
            <div class="status-dot ${serverRunning ? 'online' : 'offline'}"></div>
            <strong>${serverRunning ? '运行中' : '已停止'}</strong>
            ${serverRunning ? `<span style="margin-left: 10px;">端口: ${currentPort}</span>` : ''}
        </div>
        
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">${stats.totalCalls}</div>
                <div class="stat-label">总调用</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.askUserCalls}</div>
                <div class="stat-label">用户交互</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.askContinueCalls}</div>
                <div class="stat-label">续杯次数</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${Math.floor((Date.now() - stats.startTime) / 1000)}s</div>
                <div class="stat-label">运行时间</div>
            </div>
        </div>
        
        <button class="btn ${serverRunning ? 'btn-danger' : 'btn-success'}" onclick="${serverRunning ? 'stopServer()' : 'startServer()'}">
            ${serverRunning ? '停止服务器' : '启动服务器'}
        </button>
        <button class="btn" onclick="refresh()">🔄 刷新状态</button>
    </div>

    <div class="card">
        <h3>⚙️ Windsurf 配置</h3>
        <p style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 15px;">
            点击按钮将 MCP 服务信息写入 Windsurf 配置文件
        </p>
        <button class="btn btn-configured" onclick="configWindsurf()">
            ✓ 写入 Windsurf 配置
        </button>
    </div>

    <div class="card">
        <div class="card-header" onclick="toggleOptimizationSettings()">
            <h3>⚙️ 指令优化设置</h3>
            <span class="toggle-icon" id="optimizationToggle">▼</span>
        </div>
        
        <div class="card-content" id="optimizationContent">
            <div class="form-group">
                <label for="apiKey">API Key (智谱 AI)</label>
                <input type="password" id="apiKey" placeholder="请输入智谱 API Key" value="${optimizationSettings.apiKey || ''}" onchange="updateOptimization('apiKey', this.value)">
            </div>

            <div class="form-group">
                <label for="model">模型选择</label>
                <select id="model" onchange="updateOptimization('model', this.value)">
                    <option value="glm-4-flash" ${optimizationSettings.model === 'glm-4-flash' ? 'selected' : ''}>glm-4-flash (免费)</option>
                    <option value="glm-4" ${optimizationSettings.model === 'glm-4' ? 'selected' : ''}>glm-4</option>
                    <option value="glm-4-plus" ${optimizationSettings.model === 'glm-4-plus' ? 'selected' : ''}>glm-4-plus</option>
                </select>
            </div>

            <div class="form-group">
                <label for="optimizationRules">优化规则（使用 {instruction} 表示原始指令）</label>
                <textarea id="optimizationRules" placeholder="你的思考过程...
</thinking>
[英文指令]
[中文指令]

请直接输出优化后的指令，不要解释。" onchange="updateOptimization('optimizationRules', this.value)">${optimizationSettings.optimizationRules || ''}</textarea>
            </div>

            <div class="form-group">
                <label for="executionRules">执行添加规则（发送指令时自动添加）</label>
                <textarea id="executionRules" placeholder="IMPORTANT GUIDELINES:
1. Read the relevant files first before making any changes
2. Only modify what is necessary, do not refactor other parts
3. Keep the existing code style and naming conventions
4. Do not delete existing functions or comments" onchange="updateOptimization('executionRules', this.value)">${optimizationSettings.executionRules || ''}</textarea>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="enableOptimization" ${optimizationSettings.enabled ? 'checked' : ''} onchange="updateOptimization('enabled', this.checked)">
                <label for="enableOptimization">启用指令规则</label>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="autoOptimize" ${optimizationSettings.autoOptimize ? 'checked' : ''} onchange="updateOptimization('autoOptimize', this.checked)">
                <label for="autoOptimize">自动优化指令（发送时自动调用 API）</label>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="includeProjectInfo" ${optimizationSettings.includeProjectInfo ? 'checked' : ''} onchange="updateOptimization('includeProjectInfo', this.checked)">
                <label for="includeProjectInfo">自动提取上下文（内容较多时自动精简）</label>
            </div>
        </div>
    </div>


    <script>
        const vscode = acquireVsCodeApi();
        
        function refresh() {
            vscode.postMessage({ type: 'refresh' });
        }
        
        function startServer() {
            vscode.postMessage({ type: 'startServer' });
        }
        
        function stopServer() {
            vscode.postMessage({ type: 'stopServer' });
        }
        
        function configWindsurf() {
            vscode.postMessage({ type: 'configWindsurf' });
        }
        
        function updateOptimization(field, value) {
            vscode.postMessage({
                type: 'updateOptimization',
                field: field,
                value: value
            });
        }
        
        function toggleOptimizationSettings() {
            const content = document.getElementById('optimizationContent');
            const toggle = document.getElementById('optimizationToggle');
            
            if (content.style.display === 'none') {
                content.style.display = 'block';
                toggle.textContent = '▼';
            } else {
                content.style.display = 'none';
                toggle.textContent = '▶';
            }
        }
    </script>
</body>
</html>`;
    }

    private _getInputDialogHtml(requestId: string, title: string, message: string, allowImage: boolean): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
        }
        .message {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 20px;
            margin-bottom: 25px;
            border-radius: 8px;
            white-space: pre-wrap;
        }
        textarea {
            width: 100%;
            padding: 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            min-height: 120px;
            box-sizing: border-box;
        }
        .btn {
            padding: 12px 24px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 6px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            margin: 10px 5px;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
    </style>
</head>
<body>
    <h2>${title}</h2>
    <div class="message">${message}</div>
    <textarea id="userInput" placeholder="在此输入您的回复..."></textarea>
    <div>
        <button class="btn btn-secondary" onclick="cancel()">取消</button>
        <button class="btn btn-primary" onclick="submit()">提交回复</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const requestId = '${requestId}';
        
        document.getElementById('userInput').focus();
        
        function submit() {
            const input = document.getElementById('userInput').value.trim();
            if (!input) {
                alert('请输入回复内容');
                return;
            }
            vscode.postMessage({
                type: 'response',
                requestId: requestId,
                value: input
            });
        }
        
        function cancel() {
            vscode.postMessage({
                type: 'cancel',
                requestId: requestId
            });
        }
    </script>
</body>
</html>`;
    }

    private _getContinueDialogHtml(requestId: string, reason: string): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>继续对话</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
        }
        .reason {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 20px;
            margin-bottom: 25px;
            border-radius: 8px;
            white-space: pre-wrap;
        }
        .question {
            font-size: 18px;
            font-weight: bold;
            margin: 25px 0;
            text-align: center;
            color: var(--vscode-textLink-foreground);
        }
        textarea {
            width: 100%;
            padding: 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            min-height: 100px;
            box-sizing: border-box;
        }
        .btn {
            padding: 12px 24px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 6px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            margin: 10px 5px;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .continue-section {
            display: none;
            margin-top: 25px;
            padding: 20px;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
        }
        .continue-section.show {
            display: block;
        }
    </style>
</head>
<body>
    <h2>🔄 继续对话确认</h2>
    <div class="reason">
        <strong>AI 想要结束对话的原因：</strong><br>
        ${reason}
    </div>
    
    <div class="question">是否继续对话？</div>
    
    <div style="text-align: center;">
        <button class="btn btn-secondary" onclick="endConversation()">结束对话</button>
        <button class="btn btn-primary" onclick="showContinueOptions()">继续对话</button>
    </div>
    
    <div class="continue-section" id="continueSection">
        <label for="newInstruction">请输入新的指令或任务（可选）：</label>
        <textarea id="newInstruction" placeholder="输入新的任务、问题或指令..."></textarea>
        
        <div style="text-align: center;">
            <button class="btn btn-secondary" onclick="hideOptions()">返回</button>
            <button class="btn btn-primary" onclick="continueWithInstruction()">确定继续</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const requestId = '${requestId}';
        
        function showContinueOptions() {
            document.getElementById('continueSection').classList.add('show');
            document.getElementById('newInstruction').focus();
        }
        
        function hideOptions() {
            document.getElementById('continueSection').classList.remove('show');
        }
        
        function endConversation() {
            vscode.postMessage({
                type: 'response',
                requestId: requestId,
                value: { continue: false }
            });
        }
        
        function continueWithInstruction() {
            const instruction = document.getElementById('newInstruction').value.trim();
            vscode.postMessage({
                type: 'response',
                requestId: requestId,
                value: { 
                    continue: true, 
                    newInstruction: instruction || '用户选择继续'
                }
            });
        }
    </script>
</body>
</html>`;
    }
}
