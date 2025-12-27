import * as vscode from 'vscode';
import * as path from 'path';
import { handleChatResponse } from './serverManager';

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

interface PendingRequest {
    id: string;
    type: 'input' | 'confirm' | 'continue';
    message: string;
    title?: string;
    allowImage?: boolean;
    resolve: (value: any) => void;
}

export class ChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _messages: ChatMessage[] = [];
    private _pendingRequest?: PendingRequest;
    private _isProcessing: boolean = false;
    private static _instance?: ChatProvider;
    private _context?: vscode.ExtensionContext;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        ChatProvider._instance = this;
        this.loadChatHistory();
    }

    public static getInstance(): ChatProvider | undefined {
        return ChatProvider._instance;
    }

    public setContext(context: vscode.ExtensionContext) {
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

        webviewView.webview.html = this._getHtmlContent();

        webviewView.webview.onDidReceiveMessage((message: any) => {
            switch (message.type) {
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

            // 添加系统消息
            this.addMessage('system', message, []);
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
                this._isProcessing = true;
                this.updateView();
                
                // 模拟AI响应（这里可以集成实际的AI处理逻辑）
                setTimeout(() => {
                    this.addMessage('assistant', '收到您的消息，正在处理中...', []);
                    this._isProcessing = false;
                    this.updateView();
                }, 1000);
            }
        } catch (error) {
            this.addMessage('system', `处理消息时出错: ${error}`, []);
            this._isProcessing = false;
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
        // 清空对话历史
        this._messages = [];
        this._pendingRequest = undefined;
        this._isProcessing = false;
        
        // 添加结束消息
        this.addMessage('system', '对话已结束', []);
        this.updateView();
        
        vscode.window.showInformationMessage('对话已结束');
    }


    private updateView() {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    private _getHtmlContent(): string {
        const messagesHtml = this._messages.map(msg => this.renderMessage(msg)).join('');
        const inputDisabled = this._isProcessing ? 'disabled' : '';
        const processingIndicator = this._isProcessing ? '<div class="processing">正在处理中...</div>' : '';
        const pendingRequestHtml = this._pendingRequest ? this.renderPendingRequest() : '';

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
            padding: 0;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        
        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .message {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 12px;
            word-wrap: break-word;
            position: relative;
            margin-bottom: 4px;
            animation: fadeIn 0.3s ease-in;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .message.user {
            align-self: flex-end;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 18px 18px 4px 18px;
        }
        
        .message.assistant {
            align-self: flex-start;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 18px 18px 18px 4px;
        }
        
        .message.system {
            align-self: center;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 12px;
            max-width: 90%;
            border-radius: 16px;
            text-align: center;
        }
        
        .message-time {
            font-size: 10px;
            opacity: 0.7;
            margin-top: 4px;
        }
        
        .attachments {
            margin-top: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        
        .attachment {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .input-container {
            border-top: 1px solid var(--vscode-panel-border);
            padding: 16px;
            background: var(--vscode-menu-background);
        }
        
        .input-row {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }
        
        .input-wrapper {
            flex: 1;
            position: relative;
        }
        
        .message-input {
            width: 100%;
            min-height: 36px;
            max-height: 120px;
            padding: 8px 40px 8px 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 18px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            resize: none;
            font-family: inherit;
            font-size: 14px;
            line-height: 1.4;
        }
        
        .message-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .upload-btn {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--vscode-icon-foreground);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .upload-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        
        .send-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 18px;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            min-width: 60px;
        }
        
        .send-btn:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
        }
        
        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .end-btn {
            background: var(--vscode-testing-iconFailed);
            color: white;
            border: none;
            border-radius: 18px;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
        }
        
        .end-btn:hover {
            opacity: 0.8;
        }
        
        .processing {
            text-align: center;
            padding: 8px;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
            animation: pulse 1.5s ease-in-out infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
        
        .pending-request {
            background: var(--vscode-notifications-background);
            border: 1px solid var(--vscode-notifications-border);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 12px;
        }
        
        .pending-title {
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--vscode-notifications-foreground);
        }
        
        .quick-responses {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            flex-wrap: wrap;
        }
        
        .quick-response {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border);
            border-radius: 12px;
            padding: 4px 12px;
            cursor: pointer;
            font-size: 12px;
        }
        
        .quick-response:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="chat-container" id="chatContainer">
        ${pendingRequestHtml}
        ${messagesHtml}
        ${processingIndicator}
    </div>
    
    <div class="input-container">
        <div class="input-row">
            <div class="input-wrapper">
                <textarea 
                    class="message-input" 
                    id="messageInput" 
                    placeholder="输入消息..." 
                    ${inputDisabled}
                    rows="1"
                ></textarea>
                <button class="upload-btn" onclick="uploadFile()" title="上传文件">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1L3 6h2v5h6V6h2L8 1zM2 13h12v1H2v-1z"/>
                    </svg>
                </button>
            </div>
            <button class="send-btn" onclick="sendMessage()" ${inputDisabled}>发送</button>
            <button class="end-btn" onclick="endChat()">结束</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // 自动调整输入框高度
        const messageInput = document.getElementById('messageInput');
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
        
        // 回车发送消息
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        function sendMessage() {
            const input = document.getElementById('messageInput');
            const content = input.value.trim();
            
            if (content) {
                vscode.postMessage({
                    type: 'sendMessage',
                    content: content,
                    attachments: []
                });
                input.value = '';
                input.style.height = 'auto';
            }
        }
        
        function uploadFile() {
            vscode.postMessage({ type: 'uploadFile' });
        }
        
        function endChat() {
            vscode.postMessage({ type: 'endChat' });
        }
        
        function respondQuick(response) {
            vscode.postMessage({
                type: 'respond',
                response: response
            });
        }
        
        // 自动滚动到底部
        function scrollToBottom() {
            const container = document.getElementById('chatContainer');
            container.scrollTop = container.scrollHeight;
        }
        
        // 页面加载完成后滚动到底部
        window.addEventListener('load', scrollToBottom);
        
        // 监听DOM变化，自动滚动
        const observer = new MutationObserver(scrollToBottom);
        observer.observe(document.getElementById('chatContainer'), {
            childList: true,
            subtree: true
        });
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

    // 重写 addMessage 方法以包含自动保存
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

    // 清空聊天历史
    public clearChatHistory() {
        this._messages = [];
        this.saveChatHistory();
        this.updateView();
        vscode.window.showInformationMessage('聊天记录已清空');
    }
}
