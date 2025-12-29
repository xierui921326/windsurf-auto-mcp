import * as vscode from 'vscode';
import * as path from 'path';
import { handleChatResponse, getCurrentPort } from './serverManager';

interface ChatMessage {
    id: string;
    type: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    attachments?: Array<{
        type: 'image' | 'file';
        name: string;
        path: string;
        size: number;
    }>;
}

interface ProcessingState {
    isProcessing: boolean;
    currentTask: string;
    progress: number;
}

interface OptimizationSettings {
    apiKey: string;
    model: string;
    optimizationRules: string;
    autoAddRules: boolean;
    autoSummary: boolean;
    autoOptimize: boolean;
}

interface PendingRequest {
    id: string;
    type: 'input' | 'confirm' | 'continue';
    message: string;
    title?: string;
    allowImage?: boolean;
    resolve: (value: any) => void;
}

export class ChatProvider {
    public static readonly viewType = 'infiniteAsk';
    private static _instance: ChatProvider | undefined;

    private _panel?: vscode.WebviewPanel;
    private _extensionUri: vscode.Uri;
    private _messages: ChatMessage[] = [];
    private _pendingRequest?: PendingRequest;
    private _processingState: ProcessingState = {
        isProcessing: false,
        currentTask: '',
        progress: 0
    };
    private _optimizationSettings: OptimizationSettings = {
        apiKey: '',
        model: 'glm-4-flash (免费)',
        optimizationRules: '',
        autoAddRules: true,
        autoSummary: true,
        autoOptimize: true
    };
    private _showOptimizationResult: boolean = false;
    private _isSettingsExpanded: boolean = false;
    private _currentDraft: string = ''; // 保存当前输入框草稿
    private _commandHistory: string[] = [];
    private _contextSummary: string = '';
    private _context?: vscode.ExtensionContext;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        ChatProvider._instance = this;
        this.loadChatHistory();
        this.loadCommandHistory();
        this.loadOptimizationSettings();
    }

    // 获取单例实例
    public static getInstance(): ChatProvider | undefined {
        return ChatProvider._instance;
    }

    public setContext(context: vscode.ExtensionContext) {
        this._context = context;
    }

    public openChatPanel() {
        if (this._panel) {
            // 如果面板已存在，则显示它
            this._panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        // 创建新的webview面板，固定在右侧
        this._panel = vscode.window.createWebviewPanel(
            'infiniteAsk',
            'Infinite Ask',
            { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true
            }
        );

        this._panel.webview.html = this._getHtmlContent();

        this._panel.webview.onDidReceiveMessage((message: any) => {
            switch (message.type) {
                case 'toggleOptimizationSettings':
                    this.handleToggleOptimizationSettings();
                    break;
                case 'addCommand':
                    this.handleAddCommand();
                    break;
                case 'startTask':
                    this.handleStartTask(message.content, message.addRules, message.autoSummary);
                    break;
                case 'continueResponse':
                    this.handleContinueResponse(message.requestId, message.continue, message.newInstruction);
                    break;
                case 'optimizeCommand':
                    this.handleOptimizeCommand(message.content, message.addRules, message.autoSummary);
                    break;
                case 'endSession':
                    this.handleEndSession();
                    break;
                case 'clearContext':
                    this.handleClearContext();
                    break;
                case 'clearHistory':
                    this.handleClearHistory();
                    break;
                case 'deleteHistoryItem':
                    this.handleDeleteHistoryItem(message.index);
                    break;
                case 'updateApiKey':
                    this.updateOptimizationSettings({ apiKey: message.value });
                    break;
                case 'updateModel':
                    this.updateOptimizationSettings({ model: message.value });
                    break;
                case 'updateDraft':
                    this._currentDraft = message.content;
                    break;
                case 'showErrorMessage':
                    vscode.window.showErrorMessage(message.message);
                    break;
                case 'updateOptimizationRules':
                    this.updateOptimizationSettings({ optimizationRules: message.value });
                    break;
                case 'updateAutoAddRules':
                    this.updateOptimizationSettings({ autoAddRules: message.value });
                    break;
                case 'updateAutoSummary':
                    this.updateOptimizationSettings({ autoSummary: message.value });
                    break;
                case 'updateAutoOptimize':
                    this.updateOptimizationSettings({ autoOptimize: message.value });
                    break;
                case 'sendMessage':
                    this.handleUserMessage(message.content, message.attachments);
                    break;
                case 'uploadFile':
                    this.handleFileUpload();
                    break;
                case 'endChat':
                    this.handleEndChat();
                    break;
                case 'respond':
                    this.handleUserResponse(message.response);
                    break;
            }
        });

        // 当面板被关闭时清理引用
        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });
    }

    // 显示用户询问
    public showUserRequest(requestId: string, title: string, message: string, type: 'input' | 'confirm' | 'continue', allowImage: boolean = false): Promise<any> {
        return new Promise((resolve) => {
            this._pendingRequest = {
                id: requestId,
                type,
                message,
                title,
                allowImage,
                resolve
            };

            // 设置处理状态 - 所有类型都显示处理中
            this._processingState.isProcessing = true;

            if (type === 'continue') {
                this._processingState.currentTask = 'AI任务已完成，等待您的确认...';
                this.addMessage('system', `🤖 AI完成任务: ${message}`, []);
                this.addMessage('system', '💡 请选择继续对话或结束，也可以输入新的指令', []);
            } else if (type === 'input') {
                this._processingState.currentTask = 'AI正在等待您的输入...';
                this.addMessage('system', `❓ ${title}: ${message}`, []);
                this.addMessage('system', '💡 请在下方输入您的回复', []);
            } else {
                this._processingState.currentTask = 'AI正在等待您的确认...';
                this.addMessage('system', message, []);
            }

            this.updateView();
        });
    }

    private handleUserMessage(content: string, attachments: any[] = []) {
        if (!content.trim() && (!attachments || attachments.length === 0)) {
            this.addMessage('system', '请输入消息内容或上传文件', []);
            return;
        }

        try {
            // 添加用户消息
            this.addMessage('user', content, attachments);

            // 如果有待处理的请求，处理响应
            if (this._pendingRequest) {
                this.handleUserResponse(content);
            } else {
                // 设置处理中状态
                this._processingState.isProcessing = true;
                this._processingState.currentTask = '处理用户消息';
                this.updateView();

                // 模拟AI响应并保持对话活跃
                setTimeout(() => {
                    this.addMessage('assistant', '收到您的消息，正在处理中...', []);
                    this._processingState.isProcessing = false;
                    this._processingState.currentTask = '';
                    this.updateView();

                    // 添加提示消息，鼓励用户继续对话
                    setTimeout(() => {
                        this.addMessage('system', '有什么其他问题需要帮助吗？', []);
                        this.updateView();
                    }, 500);
                }, 1000);
            }
        } catch (error) {
            this.addMessage('system', `处理消息时出错: ${error}`, []);
            this._processingState.isProcessing = false;
            this._processingState.currentTask = '';
            this.updateView();
        }
    }

    private handleUserResponse(response: string) {
        if (this._pendingRequest) {
            const request = this._pendingRequest;
            this._pendingRequest = undefined;

            // 使用 serverManager 中的响应处理函数
            handleChatResponse(request.id, response, request.type);
            this.updateView();

            // 在处理完响应后，添加提示消息保持对话活跃
            setTimeout(() => {
                this.addMessage('system', '还有其他需要帮助的吗？请继续提问。', []);
                this.updateView();
            }, 1000);
        }
    }

    private async handleFileUpload() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            openLabel: '选择文件',
            filters: {
                '图片文件': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'],
                '文档文件': ['txt', 'md', 'json', 'xml', 'csv'],
                '所有文件': ['*']
            }
        };

        const fileUris = await vscode.window.showOpenDialog(options);
        if (fileUris && fileUris.length > 0) {
            const attachments = fileUris.map(uri => ({
                type: this.getFileType(uri.fsPath),
                name: path.basename(uri.fsPath),
                path: uri.fsPath,
                size: 0 // 实际应用中需要获取文件大小
            }));

            // 发送带附件的消息
            this.handleUserMessage('', attachments);
        }
    }

    private getFileType(filePath: string): 'image' | 'file' {
        const ext = path.extname(filePath).toLowerCase();
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
        return imageExts.includes(ext) ? 'image' : 'file';
    }

    private handleEndChat() {
        // 重置对话状态但不关闭界面
        this._pendingRequest = undefined;
        this._processingState.isProcessing = false;
        this._processingState.currentTask = '';

        // 添加重置消息，但保持界面活跃
        this.addMessage('system', '对话已重置，请继续提问', []);
        this.updateView();

        vscode.window.showInformationMessage('对话已重置，可以开始新的对话');
    }


    private updateView() {
        if (this._panel) {
            this._panel.webview.html = this._getHtmlContent();
        }
    }

    private _getHtmlContent(): string {
        const inputDisabled = '';
        // 根据状态显示不同的按钮文本
        let processingText = '启动无限对话';
        if (this._processingState.isProcessing) {
            if (this._pendingRequest) {
                processingText = '发送回复';
            } else {
                processingText = '处理中...';
            }
        }
        const optimizationExpanded = this._isSettingsExpanded;

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Infinite Ask</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 16px;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            font-size: 13px;
            line-height: 1.4;
        }
        
        .container {
            max-width: 100%;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        .ai-status-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 4px;
            padding-left: 2px;
        }
        
        .ai-status {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-focusBorder);
            padding: 12px 16px;
            border-radius: 0 4px 4px 0;
        }
        
        .ai-status p {
            margin: 0;
            color: var(--vscode-foreground);
            font-size: 13px;
            line-height: 1.5;
        }
        
        .optimization-settings {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 12px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .optimization-settings:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .optimization-settings span {
            color: var(--vscode-foreground);
        }
        
        .optimization-settings .arrow {
            color: var(--vscode-icon-foreground);
        }
        
        .command-input {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 12px;
        }
        
        .command-input textarea {
            width: 100%;
            min-height: 80px;
            background: transparent;
            border: none;
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: 13px;
            resize: vertical;
            outline: none;
        }
        
        .command-input textarea::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        
        .button-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
        }
        
        .button-left {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        
        .button-right {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        
        .btn {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-family: inherit;
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        
        .btn-primary:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .btn-danger {
            background: var(--vscode-testing-iconFailed);
            color: white;
            border-color: var(--vscode-testing-iconFailed);
        }
        
        .btn-danger:hover {
            opacity: 0.8;
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .add-btn {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: bold;
        }
        
        .options-row {
            display: flex;
            gap: 16px;
            align-items: center;
            font-size: 12px;
        }
        
        .checkbox-option {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }
        
        .checkbox-option input[type="checkbox"] {
            margin: 0;
        }
        
        .section {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
        }
        
        .section-header {
            padding: 8px 12px;
            background: var(--vscode-titleBar-inactiveBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            font-weight: 600;
        }
        
        .section-content {
            padding: 12px;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .context-item {
            margin-bottom: 8px;
            font-size: 12px;
            line-height: 1.3;
        }
        
        .context-item:last-child {
            margin-bottom: 0;
        }
        
        .history-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 12px;
        }
        
        .history-item:last-child {
            border-bottom: none;
        }
        
        .history-text {
            flex: 1;
            margin-right: 8px;
            color: var(--vscode-foreground);
        }
        
        .history-time {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
        
        .history-actions {
            display: flex;
            gap: 4px;
        }
        
        .history-action {
            padding: 2px 6px;
            font-size: 10px;
            border-radius: 3px;
            cursor: pointer;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .history-action:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .clear-btn {
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 11px;
        }
        
        .clear-btn:hover {
            color: var(--vscode-foreground);
        }
        
        .processing-status {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
            margin: 12px 0;
        }
        
        .processing-indicator {
            width: 12px;
            height: 12px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top: 2px solid var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .optimization-panel {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 16px;
            margin: 12px 0;
        }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 6px;
            font-size: 12px;
            color: var(--vscode-foreground);
        }
        
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: 13px;
        }

        .hidden {
            display: none !important;
        }
        
        .form-group textarea {
            min-height: 80px;
            resize: vertical;
        }
        
        .checkbox-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }
        
        .empty-state {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
        }
        
        .chat-message {
            margin-bottom: 12px;
            padding: 8px;
            border-radius: 4px;
            border-left: 3px solid var(--vscode-textBlockQuote-border);
        }
        
        .chat-message.user {
            background: var(--vscode-textBlockQuote-background);
            border-left-color: var(--vscode-button-background);
        }
        
        .chat-message.assistant {
            background: var(--vscode-input-background);
            border-left-color: var(--success);
        }
        
        .chat-message.system {
            background: var(--vscode-menu-background);
            border-left-color: var(--warning);
        }
        
        .message-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
            font-size: 11px;
        }
        
        .message-type {
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        
        .message-time {
            color: var(--vscode-descriptionForeground);
        }
        
        .separator {
            height: 1px;
            background-color: var(--vscode-panel-border);
            margin: 4px 0 12px 0;
        }

        .optimization-result-bar {
            background-color: var(--vscode-titleBar-inactiveBackground);
            padding: 8px 12px;
            border-radius: 4px;
            display: flex;
            gap: 16px;
            align-items: center;
            font-size: 12px;
            margin-bottom: 8px;
            border: 1px solid var(--vscode-panel-border);
        }

        .message-content {
            font-size: 12px;
            line-height: 1.4;
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- AI暂停原因 -->
        <div class="ai-status-title">AI 暂停原因</div>
        <div class="ai-status">
            <p>${this._processingState.isProcessing ? this._processingState.currentTask : 'AI 正在处理你的请求...'}</p>
        </div>

        
        <!-- 指令优化设置 -->
        <div class="optimization-settings" onclick="toggleOptimizationSettings()">
            <span>指令优化设置</span>
            <span class="arrow">${optimizationExpanded ? '▼' : '▶'}</span>
        </div>
        
        ${optimizationExpanded ? `
        <div class="optimization-panel">
            <div class="form-group">
                <label>API Key (智谱 AI)</label>
                <input type="password" id="apiKey" value="${this._optimizationSettings.apiKey}" placeholder="请输入 API Key" onchange="updateApiKey()">
            </div>
            
            <div class="form-group">
                <label>模型选择</label>
                <select id="modelSelect" onchange="updateModel()">
                    <option value="glm-4-flash (免费)" ${this._optimizationSettings.model === 'glm-4-flash (免费)' ? 'selected' : ''}>glm-4-flash (免费)</option>
                    <option value="glm-4-plus" ${this._optimizationSettings.model === 'glm-4-plus' ? 'selected' : ''}>glm-4-plus</option>
                    <option value="glm-4-0520" ${this._optimizationSettings.model === 'glm-4-0520' ? 'selected' : ''}>glm-4-0520</option>
                    <option value="glm-4-long" ${this._optimizationSettings.model === 'glm-4-long' ? 'selected' : ''}>glm-4-long</option>
                    <option value="glm-4-air" ${this._optimizationSettings.model === 'glm-4-air' ? 'selected' : ''}>glm-4-air</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>优化规则 (使用 {instruction} 表示原始指令)</label>
                <textarea id="optimizationRules" placeholder="请优化以下指令，使其更加准确明确，但保持原意不变：\n\n要求：\n1. 保持语言简洁\n2. 明确具体目标\n\n原始指令：{instruction}\n\n请直接输出优化后的指令，不要解释：" onchange="updateOptimizationRules()">${this._optimizationSettings.optimizationRules}</textarea>
            </div>
            
            <div class="form-group">
                <label>执行追加规则 (发送指令时自动追加)</label>
                <textarea id="executionRules" placeholder="IMPORTANT GUIDELINES:\n1. Read the relevant files first before making any changes\n2. Only modify what is necessary, do not refactor other parts\n3. Keep the existing code style and naming conventions\n4. Do not delete existing functions or comments" onchange="updateExecutionRules()">${this._optimizationSettings.optimizationRules}</textarea>
            </div>
            
            <div class="checkbox-group">
                <label><input type="checkbox" id="autoAddRules" ${this._optimizationSettings.autoAddRules ? 'checked' : ''} onchange="updateAutoAddRules()"> 启用追加规则</label>
                <label><input type="checkbox" id="autoSummary" ${this._optimizationSettings.autoSummary ? 'checked' : ''} onchange="updateAutoSummary()"> 自动优化对话 (发送时自动对话 API)</label>
                <label><input type="checkbox" id="autoOptimize" ${this._optimizationSettings.autoOptimize ? 'checked' : ''} onchange="updateAutoOptimize()"> 自动摘要上下文 (内容较多时自动精简)</label>
            </div>
        </div>` : ''}
        
        <div class="separator"></div>
        
        <!-- 输入指令 -->
        <div class="command-input">
            <textarea id="inputText" placeholder="输入指令（可选，将复制到剪贴板方便在原生编辑器中使用）..." oninput="updateDraft()" ${inputDisabled}>${this.escapeHtml(this._currentDraft)}</textarea>
        </div>
        
        <!-- 功能按钮 -->
        <div class="button-row">
            <div class="button-left">
                <button class="btn btn-secondary add-btn" onclick="addCommand()" title="添加">+</button>
                <button class="btn btn-secondary" onclick="optimizeCommand()" ${inputDisabled}>优化</button>
            </div>
            <div class="button-right">
                <button class="btn btn-danger" onclick="endSession()">结束</button>
                <button class="btn btn-primary" onclick="startTask()" ${inputDisabled}>${processingText}</button>
            </div>
        </div>
        
        <!-- 优化结果栏 (选项) -->
        <div class="optimization-result-bar ${this._showOptimizationResult ? '' : 'hidden'}">
            <label class="checkbox-option">
                <input type="checkbox" id="addRules" ${this._optimizationSettings.autoAddRules ? 'checked' : ''} onchange="updateAutoAddRulesFromMain()">
                <span>追加规则</span>
            </label>
            <span>|</span>
            <label class="checkbox-option">
                <input type="checkbox" id="autoSummaryMain" ${this._optimizationSettings.autoSummary ? 'checked' : ''} onchange="updateAutoSummaryFromMain()">
                <span>自动摘要</span>
            </label>
        </div>
        
        <!-- 聊天记录 -->
        <div class="section">
            <div class="section-header">
                <span>对话记录</span>
                <span class="clear-btn" onclick="clearChatHistory()">清空</span>
            </div>
            <div class="section-content">
                ${this._messages.length > 0 ? this._messages.slice(-10).map(msg => `
                <div class="chat-message ${msg.type}">
                    <div class="message-header">
                        <span class="message-type">${this.getMessageTypeLabel(msg.type)}</span>
                        <span class="message-time">${this.getRelativeTime(msg.timestamp)}</span>
                    </div>
                    <div class="message-content">${this.escapeHtml(msg.content)}</div>
                </div>`).join('') : '<div class="empty-state">暂无对话记录</div>'}
            </div>
        </div>

        <!-- 上下文摘要 -->
        <div class="section ${this._showOptimizationResult ? '' : 'hidden'}">
            <div class="section-header">
                <span>上下文摘要</span>
                <span class="clear-btn" onclick="clearContext()">×</span>
            </div>
            <div class="section-content">
                <div class="context-item">
                    ${this._contextSummary || '当前正在使用Infinite Ask与Windsurf进行交互，等待用户输入指令...'}
                </div>
            </div>
        </div>
        
        <!-- 历史指令 -->
        <div class="section">
            <div class="section-header">
                <span>历史指令</span>
                <span class="clear-btn" onclick="clearHistory()">全部删除</span>
            </div>
            <div class="section-content">
                ${this._commandHistory.map((cmd, index) => `
                <div class="history-item">
                    <div class="history-text">${cmd}</div>
                    <div class="history-time">${this.getRelativeTime(Date.now() - (index * 60000))}</div>
                    <div class="history-actions">
                        <span class="history-action" onclick="deleteHistoryItem(${index})">×</span>
                    </div>
                </div>`).join('')}
                ${this._commandHistory.length === 0 ? '<div class="empty-state">暂无历史记录</div>' : ''}
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function toggleOptimizationSettings() {
            vscode.postMessage({
                type: 'toggleOptimizationSettings'
            });
        }
        
        function addCommand() {
            vscode.postMessage({
                type: 'addCommand'
            });
        }
        
        function startTask() {
            const input = document.getElementById('inputText');
            const content = input.value.trim();
            
            if (content) {
                vscode.postMessage({
                    type: 'startTask',
                    content: content,
                    addRules: document.getElementById('addRules').checked,
                    autoSummary: document.getElementById('autoSummaryMain').checked
                });
            } else {
                vscode.postMessage({
                    type: 'startTask',
                    content: '',
                    addRules: false,
                    autoSummary: false
                });
            }
        }
        
        function optimizeCommand() {
            const input = document.getElementById('inputText');
            const content = input.value.trim();
            const addRulesEl = document.getElementById('addRules');
            const autoSummaryEl = document.getElementById('autoSummaryMain');
            
            if (content) {
                vscode.postMessage({
                    type: 'optimizeCommand',
                    content: content,
                    addRules: addRulesEl ? addRulesEl.checked : false,
                    autoSummary: autoSummaryEl ? autoSummaryEl.checked : false
                });
            } else {
                vscode.postMessage({
                    type: 'showErrorMessage',
                    message: '请输入需要优化的指令'
                });
            }
        }
        
        function endSession() {
            vscode.postMessage({
                type: 'endSession'
            });
        }
        
        function clearContext() {
            vscode.postMessage({
                type: 'clearContext'
            });
        }
        
        function clearHistory() {
            vscode.postMessage({
                type: 'clearHistory'
            });
        }
        
        function deleteHistoryItem(index) {
            vscode.postMessage({
                type: 'deleteHistoryItem',
                index: index
            });
        }
        
        let draftTimeout;
        function updateDraft() {
            const value = document.getElementById('inputText').value;
            if (draftTimeout) clearTimeout(draftTimeout);
            draftTimeout = setTimeout(() => {
                vscode.postMessage({
                    type: 'updateDraft',
                    content: value
                });
            }, 300);
        }

        function updateApiKey() {
            const value = document.getElementById('apiKey').value;
            vscode.postMessage({
                type: 'updateApiKey',
                value: value
            });
        }
        
        function updateModel() {
            const value = document.getElementById('modelSelect').value;
            vscode.postMessage({
                type: 'updateModel',
                value: value
            });
        }
        
        function updateOptimizationRules() {
            const value = document.getElementById('optimizationRules').value;
            vscode.postMessage({
                type: 'updateOptimizationRules',
                value: value
            });
        }
        
        function updateExecutionRules() {
            const value = document.getElementById('executionRules').value;
            vscode.postMessage({
                type: 'updateOptimizationRules',
                value: value
            });
        }
        
        function updateAutoAddRules() {
            const value = document.getElementById('autoAddRules').checked;
            vscode.postMessage({
                type: 'updateAutoAddRules',
                value: value
            });
        }
        
        function updateAutoSummary() {
            const value = document.getElementById('autoSummary').checked;
            vscode.postMessage({
                type: 'updateAutoSummary',
                value: value
            });
        }
        
        function updateAutoOptimize() {
            const value = document.getElementById('autoOptimize').checked;
            vscode.postMessage({
                type: 'updateAutoOptimize',
                value: value
            });
        }
        
        // 从主界面复选框更新设置
        function updateAutoAddRulesFromMain() {
            const value = document.getElementById('addRules').checked;
            vscode.postMessage({
                type: 'updateAutoAddRules',
                value: value
            });
        }
        
        function updateAutoSummaryFromMain() {
            const value = document.getElementById('autoSummaryMain').checked;
            vscode.postMessage({
                type: 'updateAutoSummary',
                value: value
            });
        }

        
        // 自动调整文本框高度
        const commandInput = document.getElementById('inputText');
        if (commandInput) {
            commandInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 200) + 'px';
            });
            
            // Ctrl+Enter 发送指令
            commandInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    startTask();
                }
            });
        }
    </script>
</body>
</html>`;
    }

    private renderMessage(message: ChatMessage): string {
        const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });

        const attachmentsHtml = message.attachments && message.attachments.length > 0
            ? `<div class="attachments">
                ${message.attachments.map(att =>
                `<div class="attachment">
                        <span>${att.type === 'image' ? '🖼️' : '📄'}</span>
                        <span>${att.name}</span>
                    </div>`
            ).join('')}
            </div>`
            : '';

        return `
            <div class="message ${message.type}">
                <div>${message.content}</div>
                ${attachmentsHtml}
                <div class="message-time">${time}</div>
            </div>
        `;
    }

    private renderPendingRequest(): string {
        if (!this._pendingRequest) return '';

        const quickResponses = this.getQuickResponses(this._pendingRequest.type);
        const quickResponsesHtml = quickResponses.length > 0
            ? `<div class="quick-responses">
                ${quickResponses.map(response =>
                `<button class="quick-response" onclick="respondQuick('${response}')">${response}</button>`
            ).join('')}
            </div>`
            : '';

        return `
            <div class="pending-request">
                <div class="pending-title">${this._pendingRequest.title || '请回复'}</div>
                <div>${this._pendingRequest.message}</div>
                ${quickResponsesHtml}
            </div>
        `;
    }

    private getQuickResponses(type: string): string[] {
        switch (type) {
            case 'confirm':
                return ['是', '否', '确认', '取消'];
            case 'continue':
                return ['继续', '结束', '是', '否'];
            default:
                return [];
        }
    }

    // 加载聊天历史记录
    private loadChatHistory() {
        if (this._context) {
            const savedMessages = this._context.globalState.get<ChatMessage[]>('chatHistory');
            if (savedMessages && Array.isArray(savedMessages)) {
                this._messages = savedMessages.slice(-50); // 只保留最近50条消息
            }
        }
    }

    // 保存聊天历史记录
    private saveChatHistory() {
        if (this._context) {
            this._context.globalState.update('chatHistory', this._messages);
        }
    }

    // 添加消息到聊天记录
    private addMessage(type: 'user' | 'assistant' | 'system', content: string, attachments: any[] = []) {
        const message: ChatMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            content,
            timestamp: Date.now(),
            attachments: attachments.map(att => ({
                type: att.type || 'file',
                name: att.name || 'unknown',
                path: att.path || '',
                size: att.size || 0
            }))
        };

        this._messages.push(message);

        // 限制消息数量，避免占用过多存储空间
        if (this._messages.length > 100) {
            this._messages = this._messages.slice(-100);
        }

        this.saveChatHistory();
        this.updateView();
    }

    // 添加指令到历史记录
    private addCommandToHistory(command: string) {
        this._commandHistory.unshift(command);
        // 限制历史记录数量
        if (this._commandHistory.length > 50) {
            this._commandHistory = this._commandHistory.slice(0, 50);
        }
        this.saveCommandHistory();
    }

    // 清空聊天历史
    public clearChatHistory() {
        this._messages = [];
        this.saveChatHistory();
        this.updateView();
        vscode.window.showInformationMessage('聊天记录已清空');
    }

    // 获取相对时间
    private getRelativeTime(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        return `${days}天前`;
    }

    // 保存指令历史
    private saveCommandHistory() {
        if (this._context) {
            this._context.globalState.update('commandHistory', this._commandHistory);
        }
    }

    // 加载指令历史
    private loadCommandHistory() {
        if (this._context) {
            const saved = this._context.globalState.get<string[]>('commandHistory');
            if (saved && Array.isArray(saved)) {
                this._commandHistory = saved;
            }
        }
    }

    // 更新优化设置
    public updateOptimizationSettings(settings: Partial<OptimizationSettings>) {
        this._optimizationSettings = { ...this._optimizationSettings, ...settings };
        this.saveOptimizationSettings();
        this.updateView();
    }

    // 保存优化设置
    private saveOptimizationSettings() {
        if (this._context) {
            this._context.globalState.update('optimizationSettings', this._optimizationSettings);
        }
    }

    // 加载优化设置
    private loadOptimizationSettings() {
        if (this._context) {
            const saved = this._context.globalState.get<OptimizationSettings>('optimizationSettings');
            if (saved) {
                this._optimizationSettings = { ...this._optimizationSettings, ...saved };
            }
        }
    }

    // 新界面功能处理方法
    private handleToggleOptimizationSettings() {
        this._isSettingsExpanded = !this._isSettingsExpanded;
        this.updateView();
    }

    private handleAddCommand() {
        const input = vscode.window.showInputBox({
            prompt: '请输入要添加的指令',
            placeHolder: '输入指令内容...'
        });
        input.then(command => {
            if (command && command.trim()) {
                this.addCommandToHistory(command.trim());
                vscode.window.showInformationMessage('指令已添加到历史记录');
            }
        });
    }

    // 处理windsurf_auto_mcp工具的响应
    private handleContinueResponse(requestId: string, continueChat: boolean, newInstruction?: string) {
        // 清除待处理请求
        this._pendingRequest = undefined;

        // 结束处理状态
        this._processingState.isProcessing = false;
        this._processingState.currentTask = '';

        if (continueChat) {
            if (newInstruction && newInstruction.trim()) {
                this.addMessage('system', `✅ AI处理完成！收到新指令: ${newInstruction}`, []);
                this.addMessage('system', '🚀 正在执行新指令...', []);
                this.updateView();
                // 自动处理新指令
                this.handleStartTask(newInstruction, false, false);
            } else {
                this.addMessage('system', '✅ AI处理完成！', []);
                this.addMessage('system', '💬 无限对话模式仍在运行，请在原生编辑器中继续输入指令', []);
                this.addMessage('system', '或在下方输入框输入新的指令', []);
                this.updateView();
            }
        } else {
            this.addMessage('system', '✅ AI处理完成', []);
            this.addMessage('system', '🔚 无限对话模式已结束', []);
            this.updateView();
        }

        // 通知服务器管理器处理响应
        const { handleWebviewResponse } = require('./serverManager');
        handleWebviewResponse(requestId, {
            continue: continueChat,
            newInstruction: newInstruction
        });
    }

    private async handleStartTask(content: string, addRules: boolean, autoSummary: boolean) {
        // 如果有待处理的请求，将输入作为响应发送
        if (this._pendingRequest) {
            const request = this._pendingRequest;
            this._pendingRequest = undefined;

            // 添加用户消息到聊天记录
            if (content.trim()) {
                this.addMessage('user', content.trim(), []);
            }

            // 根据请求类型处理响应
            if (request.type === 'continue') {
                // 处理继续对话的响应
                const { handleWebviewResponse } = require('./serverManager');
                handleWebviewResponse(request.id, {
                    continue: true,
                    newInstruction: content.trim()
                });

                this.addMessage('system', '✅ 已发送响应，AI将继续处理...', []);
            } else {
                // 处理普通输入请求的响应
                const { handleWebviewResponse } = require('./serverManager');
                handleWebviewResponse(request.id, content.trim() || '用户未输入');

                this.addMessage('system', '✅ 已发送响应', []);
            }

            // 重置处理状态
            this._processingState.isProcessing = false;
            this._processingState.currentTask = '';
            this._currentDraft = ''; // 清空输入框
            this.updateView();
            return;
        }

        // 设置处理状态
        this._processingState.isProcessing = true;
        this._processingState.currentTask = '启动无限对话模式';
        this.updateView();

        try {
            if (content.trim()) {
                // 添加到历史记录
                this.addCommandToHistory(content.trim());

                // 添加用户消息到聊天记录
                this.addMessage('user', content.trim(), []);

                // 显示启动无限对话模式的消息
                this.addMessage('system', '正在启动无限对话模式...', []);
                this.addMessage('system', '请直接在原生Windsurf编辑器中输入您的指令', []);
                this.addMessage('system', 'AI处理完成后会自动调用windsurf_auto_mcp工具，确保对话不会结束', []);
                this.addMessage('system', '您可以在此界面监控对话状态和输入后续指令', []);

                // 将指令复制到剪贴板，方便用户在原生编辑器中使用
                try {
                    await vscode.env.clipboard.writeText(content.trim());
                    this.addMessage('system', `指令已复制到剪贴板: "${content.trim()}"`, []);
                    vscode.window.showInformationMessage(`无限对话模式已启动，指令已复制到剪贴板，请在原生Windsurf编辑器中粘贴使用`);
                } catch (error) {
                    this.addMessage('system', `无法复制到剪贴板，请手动在原生编辑器中输入: "${content.trim()}"`, []);
                }

            } else {
                // 如果没有输入内容，启动一般性无限对话模式
                this.addMessage('system', '无限对话模式已启动', []);
                this.addMessage('system', '请直接在原生Windsurf编辑器中输入您的指令', []);
                this.addMessage('system', 'AI处理完成后会自动调用ask_continue工具，确保对话不会结束', []);
                vscode.window.showInformationMessage('无限对话模式已启动，请在原生Windsurf编辑器中输入指令');
            }

            // 结束启动状态
            this._processingState.isProcessing = false;
            this._processingState.currentTask = '等待原生编辑器中的AI处理';
            this._currentDraft = ''; // 清空输入框
            this.updateView();

        } catch (error) {
            this._processingState.isProcessing = false;
            this._processingState.currentTask = '';
            this.updateView();
            this.addMessage('system', `启动无限对话模式失败: ${error}`, []);
        }
    }

    // 发送指令到Windsurf聊天输入框
    private async sendCommandToWindsurfChat(command: string) {
        try {
            // 将指令复制到剪贴板
            await vscode.env.clipboard.writeText(command);

            // 尝试打开聊天面板
            try {
                // 尝试不同的聊天面板命令
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
            } catch {
                try {
                    await vscode.commands.executeCommand('workbench.view.extension.github-copilot-chat');
                } catch {
                    try {
                        await vscode.commands.executeCommand('workbench.action.chat.open');
                    } catch {
                        // 如果都失败了，显示提示
                        vscode.window.showInformationMessage(
                            `指令已复制到剪贴板，请手动粘贴到Windsurf聊天中: ${command}`,
                            '打开聊天面板'
                        ).then(selection => {
                            if (selection === '打开聊天面板') {
                                vscode.commands.executeCommand('workbench.action.togglePanel');
                            }
                        });
                        return;
                    }
                }
            }

            // 显示成功消息
            vscode.window.showInformationMessage(
                `指令已复制到剪贴板并尝试打开聊天面板，请粘贴发送: ${command}`,
                '确定'
            );

        } catch (error) {
            // 如果完全失败，至少复制到剪贴板
            try {
                await vscode.env.clipboard.writeText(command);
                vscode.window.showWarningMessage(`无法自动发送指令，已复制到剪贴板，请手动粘贴到Windsurf聊天中: ${command}`);
            } catch (clipboardError) {
                vscode.window.showErrorMessage(`发送指令失败，请手动输入到Windsurf聊天中: ${command}`);
                throw new Error(`无法发送指令到聊天: ${error}`);
            }
        }
    }

    // 发送指令到Windsurf编辑器（保留原方法作为备用）
    private async sendCommandToWindsurf(command: string) {
        // 通过VSCode API将指令发送到编辑器
        try {
            // 获取当前活动的编辑器
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                // 在当前光标位置插入注释形式的指令
                const position = activeEditor.selection.active;
                const commentPrefix = this.getCommentPrefix(activeEditor.document.languageId);
                const commandText = `${commentPrefix} Infinite Ask指令: ${command}\n`;

                await activeEditor.edit(editBuilder => {
                    editBuilder.insert(position, commandText);
                });

                // 显示信息提示
                vscode.window.showInformationMessage(`指令已插入到编辑器: ${command}`);
            } else {
                // 如果没有活动编辑器，创建一个新文件
                const document = await vscode.workspace.openTextDocument({
                    content: `# Infinite Ask指令\n\n${command}\n\n请AI处理上述指令。`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(document);
                vscode.window.showInformationMessage('已创建新文档并插入指令');
            }
        } catch (error) {
            throw new Error(`无法发送指令到编辑器: ${error}`);
        }
    }

    // 根据语言获取注释前缀
    private getCommentPrefix(languageId: string): string {
        const commentPrefixes: { [key: string]: string } = {
            'javascript': '//',
            'typescript': '//',
            'python': '#',
            'java': '//',
            'cpp': '//',
            'c': '//',
            'csharp': '//',
            'go': '//',
            'rust': '//',
            'php': '//',
            'ruby': '#',
            'shell': '#',
            'bash': '#',
            'powershell': '#',
            'sql': '--',
            'html': '<!--',
            'css': '/*',
            'markdown': '<!--',
            'yaml': '#',
            'json': '//',
            'xml': '<!--'
        };

        return commentPrefixes[languageId] || '//';
    }

    // 获取消息类型标签
    private getMessageTypeLabel(type: 'user' | 'assistant' | 'system'): string {
        const labels = {
            'user': '用户',
            'assistant': 'AI',
            'system': '系统'
        };
        return labels[type] || type;
    }

    // HTML转义
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/\n/g, '<br>');
    }

    // 调用MCP工具的辅助方法
    private async callMCPTool(toolName: string, args: any): Promise<string> {
        return new Promise((resolve, reject) => {
            // 通过HTTP请求调用本地MCP服务器
            const http = require('http');

            const requestData = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: args
                }
            };

            const postData = JSON.stringify(requestData);

            const options = {
                hostname: 'localhost',
                port: getCurrentPort(), // 使用当前MCP服务器端口
                path: '/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.error) {
                            reject(new Error(response.error.message));
                        } else if (response.result && response.result.content) {
                            const content = response.result.content[0];
                            resolve(content.text || '无响应内容');
                        } else {
                            resolve('操作完成');
                        }
                    } catch (parseError) {
                        reject(new Error(`解析响应失败: ${parseError}`));
                    }
                });
            });

            req.on('error', (error: any) => {
                reject(new Error(`MCP请求失败: ${error.message}`));
            });

            req.write(postData);
            req.end();
        });
    }

    private async handleOptimizeCommand(content: string, addRules: boolean, autoSummary: boolean) {
        // 保存最新的草稿内容
        this._currentDraft = content;

        if (!content.trim()) {
            vscode.window.showErrorMessage('请输入指令内容'); // Changed to showErrorMessage
            return;
        }

        // 检查 API Key
        if (!this._optimizationSettings.apiKey) {
            vscode.window.showErrorMessage('请先在"指令优化设置"中配置 API Key (智谱 AI)，才能执行优化指令。');
            this._isSettingsExpanded = true;
            this.updateView();
            return;
        }

        this._processingState.isProcessing = true;
        this._processingState.currentTask = '优化指令';
        this.updateView();

        // 显示进度条
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在优化指令...",
            cancellable: false
        }, async (progress) => {
            try {
                // 调用MCP优化工具 (这里应该替换为实际的 API 调用)
                const context = addRules ? '追加规则已启用' : '';
                vscode.window.showInformationMessage(`正在优化指令: ${content}`);

                // 模拟 API 调用延迟
                await new Promise(resolve => setTimeout(resolve, 2000));

                this._processingState.isProcessing = false;
                this._processingState.currentTask = '';
                this._showOptimizationResult = true; // 显示优化结果区域
                this.updateView();

                vscode.window.showInformationMessage('指令优化完成');
            } catch (error) {
                this._processingState.isProcessing = false;
                this.updateView();
                vscode.window.showErrorMessage(`优化失败: ${error}`);
            }
        });
    }

    private handleEndSession() {
        vscode.window.showInformationMessage('会话已结束');
        // 重置状态
        this._processingState.isProcessing = false;
        this._processingState.currentTask = '';
        this._pendingRequest = undefined;
        this.updateView();
    }

    private handleClearContext() {
        vscode.window.showInformationMessage('上下文摘要已清空');
        this.updateView();
    }

    private handleClearHistory() {
        this._commandHistory = [];
        this.saveCommandHistory();
        this.updateView();
        vscode.window.showInformationMessage('历史指令已清空');
    }

    private handleDeleteHistoryItem(index: number) {
        if (index >= 0 && index < this._commandHistory.length) {
            const deleted = this._commandHistory.splice(index, 1)[0];
            this.saveCommandHistory();
            this.updateView();
            vscode.window.showInformationMessage(`已删除历史指令: ${deleted.substring(0, 20)}...`);
        }
    }
}
