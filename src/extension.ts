/**
 * WindsurfAutoMcp 扩展主入口
 * Windsurf MCP 自动化工具 - 任务完成确认、用户交互、一键配置
 */

import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ==================== 全局变量 ====================

let outputChannel: vscode.OutputChannel;
let mcpServer: http.Server | null = null;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: SidebarProvider;
let currentPort = 3456;
let dialogPanel: vscode.WebviewPanel | null = null;
let currentDialogRequestId: string | null = null;
let lastDialogReason: string = '';
let extensionContext: vscode.ExtensionContext;

// 统计数据
let stats = {
    totalCalls: 0,
    askUserCalls: 0,
    askContinueCalls: 0,
    notifyCalls: 0,
    imageUploads: 0,
    startTime: Date.now()
};

// 待处理请求
const pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timestamp: number;
}>();

// ==================== 工具定义 ====================

const TOOLS = [
    {
        name: 'ask_user',
        description: '请求用户输入或确认。会弹出对话框让用户输入内容或做出选择。支持图片上传。',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: '对话框标题' },
                message: { type: 'string', description: '显示给用户的消息' },
                type: { 
                    type: 'string', 
                    enum: ['input', 'confirm', 'info'],
                    description: '对话框类型：input=输入框，confirm=确认框，info=信息提示'
                },
                allowImage: { type: 'boolean', description: '是否允许上传图片' }
            },
            required: ['message']
        }
    },
    {
        name: 'notify',
        description: '向用户发送通知消息。',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '通知内容' },
                level: { type: 'string', enum: ['info', 'warning', 'error'], description: '通知级别' }
            },
            required: ['message']
        }
    },
    {
        name: 'ask_continue',
        description: '当完成任务时，必须调用此工具询问用户是否继续。用户可以选择继续并提供新的指令。',
        inputSchema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: '任务完成的原因或说明' }
            },
            required: ['reason']
        }
    }
];

// ==================== 扩展激活 ====================

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel('WindsurfAutoMcp');
    outputChannel.appendLine('WindsurfAutoMcp 扩展正在激活...');

    // 加载统计数据
    loadStats(context);

    // 创建状态栏
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'mcpService.showStats';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // 创建侧边栏
    sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('mcpServicePanel.sidebarView', sidebarProvider)
    );

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpService.startServer', () => startServer()),
        vscode.commands.registerCommand('mcpService.stopServer', () => stopServer()),
        vscode.commands.registerCommand('mcpService.configWindsurf', () => configureWindsurf()),
        vscode.commands.registerCommand('mcpService.showStats', () => showStats()),
        vscode.commands.registerCommand('mcpService.toggleDialog', () => toggleDialog())
    );

    // 自动启动服务器
    const config = vscode.workspace.getConfiguration('mcpService');
    if (config.get('autoStart', true)) {
        startServer();
    }

    outputChannel.appendLine('WindsurfAutoMcp 扩展激活完成');
}

export function deactivate() {
    stopServer();
    outputChannel?.appendLine('WindsurfAutoMcp 扩展已停用');
}

// ==================== 服务器管理 ====================

async function startServer() {
    if (mcpServer) {
        outputChannel.appendLine('服务器已在运行');
        return;
    }

    const config = vscode.workspace.getConfiguration('mcpService');
    currentPort = config.get('port', 3456);

    mcpServer = http.createServer(handleRequest);

    await new Promise<void>((resolve, reject) => {
        mcpServer!.listen(currentPort, 'localhost', () => {
            outputChannel.appendLine(`MCP服务器已启动，端口: ${currentPort}`);
            resolve();
        });

        mcpServer!.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                currentPort++;
                outputChannel.appendLine(`端口被占用，尝试端口: ${currentPort}`);
                mcpServer!.listen(currentPort, 'localhost');
            } else {
                reject(err);
            }
        });
    });

    updateStatusBar();
    sidebarProvider?.updateStatus(true, currentPort);
    writePortFile();
    
    // 自动配置Windsurf
    configureWindsurf();
}

function stopServer() {
    if (mcpServer) {
        mcpServer.close();
        mcpServer = null;
        deletePortFile();
        updateStatusBar();
        sidebarProvider?.updateStatus(false, 0);
        outputChannel.appendLine('MCP服务器已停止');
    }
}

function writePortFile() {
    try {
        const homeDir = os.homedir();
        const portFile = path.join(homeDir, '.windsurf_auto_mcp_port');
        fs.writeFileSync(portFile, currentPort.toString());
    } catch (e) {
        // ignore
    }
}

function deletePortFile() {
    try {
        const homeDir = os.homedir();
        const portFile = path.join(homeDir, '.windsurf_auto_mcp_port');
        if (fs.existsSync(portFile)) {
            fs.unlinkSync(portFile);
        }
    } catch (e) {
        // ignore
    }
}

// ==================== HTTP请求处理 ====================

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === '/health' || req.url === '/') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ service: 'windsurf_auto_mcp', status: 'ok', port: currentPort }));
            return;
        }
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => handleJSONRPC(body, res));
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
}

async function handleJSONRPC(body: string, res: http.ServerResponse) {
    try {
        const request = JSON.parse(body);
        const { method, id, params } = request;

        outputChannel.appendLine(`收到请求: ${method}`);

        let result: any;

        switch (method) {
            case 'initialize':
                result = {
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'windsurf_auto_mcp', version: '1.0.0' },
                    capabilities: { tools: {} }
                };
                break;

            case 'initialized':
                res.writeHead(200);
                res.end();
                return;

            case 'tools/list':
                result = { tools: TOOLS };
                break;

            case 'tools/call':
                result = await handleToolCall(params.name, params.arguments || {});
                break;

            default:
                if (id !== undefined) {
                    sendError(res, id, -32601, `Unknown method: ${method}`);
                    return;
                }
                res.writeHead(200);
                res.end();
                return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));

    } catch (error: any) {
        outputChannel.appendLine(`错误: ${error.message}`);
        sendError(res, null, -32603, error.message);
    }
}

function sendError(res: http.ServerResponse, id: any, code: number, message: string) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

// ==================== 工具处理 ====================

async function handleToolCall(name: string, args: any): Promise<any> {
    stats.totalCalls++;

    let result;
    switch (name) {
        case 'ask_user':
            stats.askUserCalls++;
            result = await handleAskUser(args);
            break;
        case 'notify':
            stats.notifyCalls++;
            result = await handleNotify(args);
            break;
        case 'ask_continue':
            stats.askContinueCalls++;
            result = await handleAskContinue(args);
            break;
        default:
            throw new Error(`未知工具: ${name}`);
    }
    
    // 保存统计数据并刷新界面
    saveStats();
    updateStatusBar();
    sidebarProvider?.refreshContent();
    
    return result;
}

async function handleAskUser(args: any): Promise<any> {
    const { title, message, type = 'input', allowImage } = args;

    if (type === 'confirm') {
        const result = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            '是', '否'
        );
        return { content: [{ type: 'text', text: `用户选择: ${result === '是' ? '是' : '否'}` }] };
    }

    if (type === 'info') {
        await vscode.window.showInformationMessage(message);
        return { content: [{ type: 'text', text: '用户已确认' }] };
    }

    // input type - 使用webview获取更丰富的输入
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve) => {
        // 发送到webview
        sidebarProvider?.showInputDialog(requestId, title || 'WindsurfAutoMcp', message, allowImage);
        
        // 存储pending请求
        pendingRequests.set(requestId, {
            resolve: (value: any) => {
                pendingRequests.delete(requestId);
                // 格式化为 MCP 协议要求的响应格式
                if (value === null || value === undefined) {
                    resolve({ content: [{ type: 'text', text: '用户取消了操作' }] });
                } else {
                    const content: any[] = [];
                    // 处理文本输入
                    const text = typeof value === 'string' ? value : (value.text || '');
                    if (text) {
                        content.push({ type: 'text', text: `用户输入: ${text}` });
                    }
                    // 处理图片（如果有）
                    const images: any[] = Array.isArray(value.images)
                        ? value.images
                        : (value.image ? [value.image] : []);
                    for (const img of images) {
                        if (!img) continue;
                        const imgStr = String(img);
                        // 从 data URL 中提取纯 base64 数据
                        const base64Match = imgStr.match(/^data:image\/([^;]+);base64,(.+)$/);
                        if (base64Match) {
                            const mimeType = `image/${base64Match[1]}`;
                            const base64Data = base64Match[2];
                            content.push({ type: 'image', data: base64Data, mimeType });
                        } else {
                            // 如果不是 data URL 格式，直接使用
                            content.push({ type: 'image', data: imgStr, mimeType: 'image/png' });
                        }
                    }
                    if (images.length > 0) {
                        content.push({ type: 'text', text: `[用户上传了图片 x${images.length}]` });
                    }
                    if (content.length === 0) {
                        content.push({ type: 'text', text: '用户提交了空内容' });
                    }
                    resolve({ content });
                }
            },
            reject: () => {
                pendingRequests.delete(requestId);
                resolve({ content: [{ type: 'text', text: '用户取消了操作' }] });
            },
            timestamp: Date.now()
        });

        // 无限制等待，直到用户响应
    });
}

async function handleNotify(args: any): Promise<any> {
    const { message, level = 'info' } = args;

    if (level === 'error') {
        vscode.window.showErrorMessage(message);
    } else if (level === 'warning') {
        vscode.window.showWarningMessage(message);
    } else {
        vscode.window.showInformationMessage(message);
    }

    return { content: [{ type: 'text', text: `通知已发送: ${message}` }] };
}

async function handleAskContinue(args: any): Promise<any> {
    const { reason } = args;
    
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve) => {
        sidebarProvider?.showContinueDialog(requestId, reason);
        
        pendingRequests.set(requestId, {
            resolve: (value: any) => {
                pendingRequests.delete(requestId);
                // 格式化为 MCP 协议要求的响应格式
                if (value && value.continue) {
                    const content: any[] = [];
                    let text = '用户选择继续。';
                    if (value.instruction) {
                        text += `\n新指令: ${value.instruction}`;
                    }
                    content.push({ type: 'text', text });
                    // 处理图片（如果有）
                    const images: any[] = Array.isArray(value.images)
                        ? value.images
                        : (value.image ? [value.image] : []);
                    for (const img of images) {
                        if (!img) continue;
                        const imgStr = String(img);
                        // 从 data URL 中提取纯 base64 数据
                        const base64Match = imgStr.match(/^data:image\/([^;]+);base64,(.+)$/);
                        if (base64Match) {
                            const mimeType = `image/${base64Match[1]}`;
                            const base64Data = base64Match[2];
                            content.push({ type: 'image', data: base64Data, mimeType });
                        } else {
                            // 如果不是 data URL 格式，直接使用
                            content.push({ type: 'image', data: imgStr, mimeType: 'image/png' });
                        }
                    }
                    if (images.length > 0) {
                        content.push({ type: 'text', text: `[用户上传了图片 x${images.length}]` });
                    }
                    resolve({ content });
                } else {
                    resolve({ content: [{ type: 'text', text: '用户选择结束对话。' }] });
                }
            },
            reject: () => {
                pendingRequests.delete(requestId);
                resolve({ content: [{ type: 'text', text: '用户选择结束对话。' }] });
            },
            timestamp: Date.now()
        });

        // 无限制等待，直到用户响应
    });
}

// 处理来自webview的响应
export function handleWebviewResponse(requestId: string, response: any) {
    const pending = pendingRequests.get(requestId);
    if (pending) {
        pending.resolve(response);
    }
}

// 处理图片上传
export function handleImageUpload() {
    stats.imageUploads++;
}

// ==================== 对话框 Panel ====================

function toggleDialog() {
    // 如果对话框已打开，关闭它
    if (dialogPanel) {
        dialogPanel.dispose();
        dialogPanel = null;
        outputChannel.appendLine('[toggleDialog] 对话框已关闭');
        return;
    }
    
    // 如果有待处理的请求，打开对话框
    if (pendingRequests.size > 0) {
        const entries = Array.from(pendingRequests.entries());
        const [latestRequestId] = entries[entries.length - 1];
        const reason = lastDialogReason || '请选择是否继续对话';
        outputChannel.appendLine(`[toggleDialog] 打开对话框，请求ID: ${latestRequestId}`);
        showDialogPanel(latestRequestId, 'continue', '继续对话', reason, true);
    } else {
        vscode.window.showInformationMessage('当前没有待处理的对话请求');
    }
}

function showDialogPanel(requestId: string, type: 'continue' | 'input', title: string, message: string, allowImage: boolean = true) {
    // 如果已有 panel，先关闭
    if (dialogPanel) {
        dialogPanel.dispose();
    }

    // 保存当前对话框信息
    currentDialogRequestId = requestId;
    lastDialogReason = message;

    dialogPanel = vscode.window.createWebviewPanel(
        'mcpDialog',
        type === 'continue' ? '继续对话？' : title,
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    dialogPanel.webview.html = getDialogHtml(requestId, type, title, message, allowImage);

    dialogPanel.webview.onDidReceiveMessage(msg => {
        outputChannel.appendLine(`[DialogPanel] 收到消息: ${msg.type}, requestId: ${msg.requestId}`);
        switch (msg.type) {
            case 'response':
                handleWebviewResponse(msg.requestId, msg.value);
                currentDialogRequestId = null;
                dialogPanel?.dispose();
                dialogPanel = null;
                break;
            case 'imageUpload':
                handleImageUpload();
                break;
        }
    });

    dialogPanel.onDidDispose(() => {
        dialogPanel = null;
        // 注意：不清除 currentDialogRequestId，以便用户可以重新打开
        outputChannel.appendLine(`[DialogPanel] 对话框已关闭，pending requestId: ${currentDialogRequestId}`);
    });
}

function getDialogHtml(requestId: string, type: 'continue' | 'input', title: string, message: string, allowImage: boolean): string {
    const isContinue = type === 'continue';
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isContinue ? '继续对话？' : title}</title>
    <style>
        :root {
            --bg-base: #0f0f0f;
            --bg-card: #1a1a1a;
            --bg-elevated: #242424;
            --bg-input: #1e1e1e;
            --text-primary: #ffffff;
            --text-secondary: #b0b0b0;
            --text-muted: #707070;
            --accent: #6366f1;
            --accent-hover: #818cf8;
            --accent-glow: rgba(99, 102, 241, 0.3);
            --success: #22c55e;
            --success-glow: rgba(34, 197, 94, 0.3);
            --danger: #ef4444;
            --border: rgba(255, 255, 255, 0.08);
            --border-hover: rgba(255, 255, 255, 0.15);
            --radius-sm: 6px;
            --radius-md: 10px;
            --radius-lg: 14px;
            --shadow-md: 0 4px 20px rgba(0,0,0,0.4);
            --transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            color: var(--text-primary);
            background: var(--bg-base);
            padding: 24px;
            line-height: 1.5;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
        }
        
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
        
        .container {
            max-width: 560px;
            margin: 0 auto;
        }
        
        .header {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 24px;
            padding: 20px;
            background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-md), 0 0 40px var(--accent-glow);
        }
        .header-icon {
            width: 48px;
            height: 48px;
            background: rgba(255,255,255,0.2);
            border-radius: var(--radius-md);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        .header-text h1 {
            font-size: 18px;
            font-weight: 600;
            color: #fff;
            letter-spacing: -0.3px;
        }
        .header-text p {
            font-size: 12px;
            color: rgba(255,255,255,0.8);
            margin-top: 2px;
        }
        
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 20px;
            margin-bottom: 16px;
        }
        
        .card-label {
            font-size: 11px;
            font-weight: 500;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
        }
        
        .reason-box {
            background: var(--bg-elevated);
            padding: 16px;
            border-radius: var(--radius-md);
            color: var(--text-primary);
            font-size: 14px;
            line-height: 1.7;
            border: 1px solid var(--border);
        }
        
        .input-label {
            display: block;
            font-size: 11px;
            font-weight: 500;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
        }
        
        textarea {
            width: 100%;
            min-height: 120px;
            padding: 14px;
            background: var(--bg-input);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            color: var(--text-primary);
            font-size: 14px;
            resize: vertical;
            font-family: inherit;
            transition: var(--transition);
        }
        textarea:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-glow);
        }
        textarea::placeholder {
            color: var(--text-muted);
        }
        
        .image-section {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--border);
        }
        .image-options {
            display: flex;
            gap: 20px;
            margin-bottom: 14px;
        }
        .image-options label {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            font-size: 13px;
            color: var(--text-secondary);
            transition: var(--transition);
        }
        .image-options label:hover {
            color: var(--text-primary);
        }
        .image-options input[type="radio"] {
            accent-color: var(--accent);
            width: 16px;
            height: 16px;
        }
        
        .image-drop-zone {
            border: 2px dashed var(--border);
            border-radius: var(--radius-md);
            padding: 36px;
            text-align: center;
            color: var(--text-muted);
            cursor: pointer;
            transition: var(--transition);
            margin-bottom: 14px;
        }
        .image-drop-zone:hover {
            border-color: var(--accent);
            color: var(--text-secondary);
            background: rgba(99, 102, 241, 0.05);
        }
        .image-drop-zone.dragover {
            border-color: var(--accent);
            background: rgba(99, 102, 241, 0.1);
        }
        .image-drop-zone .icon {
            font-size: 32px;
            margin-bottom: 8px;
        }
        
        .image-preview {
            max-width: 100%;
            max-height: 200px;
            border-radius: var(--radius-md);
            display: none;
            margin-bottom: 14px;
            border: 1px solid var(--border);
        }
        .image-preview.show {
            display: block;
        }

        .image-preview-grid {
            display: none;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 14px;
        }
        .image-preview-grid.show {
            display: grid;
        }
        .image-preview-grid img {
            width: 100%;
            height: 70px;
            object-fit: cover;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
        }
        
        .btn {
            padding: 14px 24px;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: var(--transition);
            font-family: inherit;
        }
        .btn:active { transform: scale(0.97); }
        
        .btn-success {
            background: var(--success);
            color: #fff;
            flex: 1;
            box-shadow: 0 2px 12px var(--success-glow);
        }
        .btn-success:hover {
            filter: brightness(1.1);
            box-shadow: 0 4px 20px var(--success-glow);
        }
        
        .btn-ghost {
            background: var(--bg-elevated);
            color: var(--text-secondary);
            border: 1px solid var(--border);
            flex: 1;
        }
        .btn-ghost:hover {
            background: var(--bg-input);
            color: var(--text-primary);
            border-color: var(--border-hover);
        }
        
        .btn-outline {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text-secondary);
            padding: 10px 16px;
        }
        .btn-outline:hover {
            background: var(--bg-elevated);
            color: var(--text-primary);
        }
        
        .btn-row {
            display: flex;
            gap: 12px;
            margin-top: 20px;
        }
        
        .shortcuts {
            text-align: center;
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 20px;
            padding: 12px;
            background: var(--bg-card);
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
        }
        .shortcuts kbd {
            background: var(--bg-elevated);
            padding: 3px 8px;
            border-radius: 4px;
            border: 1px solid var(--border);
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 10px;
            margin: 0 2px;
        }
        
        .toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg-elevated);
            color: var(--text-primary);
            padding: 12px 24px;
            border-radius: var(--radius-md);
            font-size: 13px;
            box-shadow: var(--shadow-md);
            border: 1px solid var(--success);
            z-index: 1000;
            animation: toastIn 0.3s ease;
        }
        @keyframes toastIn {
            from { opacity: 0; transform: translate(-50%, 20px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-icon">${isContinue ? '💬' : '📝'}</div>
            <div class="header-text">
                <h1>${isContinue ? '继续对话？' : title}</h1>
                <p>${isContinue ? 'AI 请求您的确认' : '请输入您的回复'}</p>
            </div>
        </div>

        <div class="card">
            <div class="card-label">${isContinue ? '任务完成说明' : '消息内容'}</div>
            <div class="reason-box">${message}</div>
        </div>

        <div class="card">
            <label class="input-label">${isContinue ? '新指令（可选）' : '您的回复'}</label>
            <textarea id="userInput" placeholder="${isContinue ? '输入新指令或留空继续...' : '输入内容...'}" autofocus></textarea>

            ${allowImage ? `
            <div class="image-section">
                <label class="input-label">附加图片（可选）</label>
                <div class="image-options">
                    <label><input type="radio" name="imageType" value="base64" checked> 嵌入图片</label>
                    <label><input type="radio" name="imageType" value="path"> 仅路径</label>
                </div>
                <div class="image-drop-zone" id="dropZone">
                    <div class="icon">🖼️</div>
                    <div>Ctrl+V 粘贴 或 拖放图片到此处</div>
                </div>
                <div id="imagePreviewGrid" class="image-preview-grid"></div>
                <button class="btn btn-outline" onclick="selectImage()">📁 选择图片文件</button>
                <input type="file" id="fileInput" accept="image/*" multiple style="display:none" />
            </div>
            ` : ''}
        </div>

        <div class="btn-row">
            <button class="btn btn-success" onclick="submitResponse(true)">
                ${isContinue ? '✓ 继续执行' : '✓ 提交'}
            </button>
            <button class="btn btn-ghost" onclick="submitResponse(false)">
                ${isContinue ? '✗ 结束对话' : '✗ 取消'}
            </button>
        </div>

        <div class="shortcuts">
            <kbd>Enter</kbd> 确认 · <kbd>Shift+Enter</kbd> 换行 · <kbd>Esc</kbd> 取消
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const requestId = '${requestId}';
        const isContinue = ${isContinue};
        let imagesData = [];
        let imagePath = null;

        function showToast(msg) {
            const existing = document.querySelector('.toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }

        // 快捷键
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitResponse(true);
            } else if (e.key === 'Escape') {
                submitResponse(false);
            }
        });

        // 粘贴图片
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (items) {
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        const file = item.getAsFile();
                        if (file) handleImageFile(file);
                    }
                }
            }
        });

        // 拖放图片
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragover');
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                const files = Array.from(e.dataTransfer?.files || []);
                for (const file of files) {
                    if (file && file.type.startsWith('image/')) {
                        handleImageFile(file);
                    }
                }
            });
        }

        // 文件选择
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const files = Array.from(e.target.files || []);
                for (const file of files) {
                    if (file) handleImageFile(file);
                }
            });
        }

        function selectImage() {
            document.getElementById('fileInput')?.click();
        }

        function handleImageFile(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result;
                if (typeof result === 'string') {
                    imagesData.push(result);
                }
                renderPreviews();
                showToast('图片已加载');
                vscode.postMessage({ type: 'imageUpload' });
            };
            reader.readAsDataURL(file);
        }

        function renderPreviews() {
            const grid = document.getElementById('imagePreviewGrid');
            if (!grid) return;

            grid.innerHTML = '';
            for (const img of imagesData) {
                const el = document.createElement('img');
                el.src = img;
                grid.appendChild(el);
            }
            if (imagesData.length > 0) {
                grid.classList.add('show');
            } else {
                grid.classList.remove('show');
            }
        }

        function submitResponse(confirm) {
            const input = document.getElementById('userInput')?.value || '';
            const imageType = document.querySelector('input[name="imageType"]:checked')?.value || 'base64';
            
            let response;
            if (isContinue) {
                response = {
                    continue: confirm,
                    instruction: input,
                    images: imageType === 'base64' ? imagesData : [],
                    imagePath: imagePath
                };
            } else {
                if (confirm) {
                    response = {
                        text: input,
                        images: imageType === 'base64' ? imagesData : [],
                        imagePath: imagePath
                    };
                } else {
                    response = null;
                }
            }
            
            vscode.postMessage({ type: 'response', requestId, value: response });
        }
    </script>
</body>
</html>`;
}

// ==================== Windsurf配置 ====================

function configureWindsurf() {
    const homeDir = os.homedir();
    const configPaths = [
        path.join(homeDir, '.windsurf', 'windsurf', 'mcp_config.json'),
        path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json')
    ];

    for (const configPath of configPaths) {
        try {
            const dir = path.dirname(configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            let config: any = { mcpServers: {} };
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                if (!config.mcpServers) config.mcpServers = {};
            }

            config.mcpServers.windsurf_auto_mcp = {
                url: `http://localhost:${currentPort}`,
                disabled: false
            };

            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            outputChannel.appendLine(`已配置Windsurf: ${configPath}`);
            
        } catch (e: any) {
            outputChannel.appendLine(`配置Windsurf失败: ${e.message}`);
        }
    }

    vscode.window.showInformationMessage(`WindsurfAutoMcp 已配置到 Windsurf (端口: ${currentPort})`);
}

// ==================== 状态栏 ====================

function updateStatusBar() {
    if (mcpServer) {
        statusBarItem.text = `$(server) MCP: ${currentPort}`;
        statusBarItem.tooltip = `WindsurfAutoMcp 运行中 - 端口 ${currentPort}\n调用次数: ${stats.totalCalls}`;
    } else {
        statusBarItem.text = '$(server) MCP: 停止';
        statusBarItem.tooltip = 'WindsurfAutoMcp 已停止';
    }
}

// ==================== 统计 ====================

function loadStats(context: vscode.ExtensionContext) {
    const saved = context.globalState.get<typeof stats>('mcpServiceStats');
    if (saved) {
        stats = { ...saved, startTime: Date.now() };
    }
}

function saveStats() {
    if (extensionContext) {
        extensionContext.globalState.update('mcpServiceStats', stats);
    }
}

function showStats() {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
    vscode.window.showInformationMessage(
        `WindsurfAutoMcp 统计:\n` +
        `总调用: ${stats.totalCalls}\n` +
        `ask_user: ${stats.askUserCalls}\n` +
        `ask_continue: ${stats.askContinueCalls}\n` +
        `notify: ${stats.notifyCalls}\n` +
        `图片上传: ${stats.imageUploads}\n` +
        `运行时间: ${uptime} 分钟`
    );
}

// ==================== 规则文件 ====================

async function createWindsurfRules() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }

    const rulesContent = `# Windsurf Rules - WindsurfAutoMcp

## 任务完成规则
当你完成一个任务时，必须调用 \`ask_continue\` 工具询问用户是否继续。

## 使用示例
- 完成代码修改后，调用 ask_continue
- 完成文件创建后，调用 ask_continue  
- 完成调试分析后，调用 ask_continue

## 注意事项
- 不要在中途频繁询问，只在任务完成时询问
- 提供清晰的任务完成原因
- 等待用户确认后再继续下一个任务
`;

    const rulesPath = path.join(workspaceFolders[0].uri.fsPath, '.windsurf', 'rules.md');
    const rulesDir = path.dirname(rulesPath);

    try {
        if (!fs.existsSync(rulesDir)) {
            fs.mkdirSync(rulesDir, { recursive: true });
        }
        fs.writeFileSync(rulesPath, rulesContent, 'utf-8');
        vscode.window.showInformationMessage(`规则文件已创建: ${rulesPath}`);
        
        // 打开文件
        const doc = await vscode.workspace.openTextDocument(rulesPath);
        await vscode.window.showTextDocument(doc);
    } catch (error) {
        vscode.window.showErrorMessage(`创建规则文件失败: ${error}`);
    }
}

// ==================== 侧边栏提供者 ====================

class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        outputChannel.appendLine('[SidebarProvider] resolveWebviewView 被调用');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // 立即设置 HTML
        const html = this._getHtmlContent();
        outputChannel.appendLine('[SidebarProvider] HTML 长度: ' + html.length);
        webviewView.webview.html = html;
        outputChannel.appendLine('[SidebarProvider] HTML 已设置');

        // 当可见性变化时重新设置 HTML
        webviewView.onDidChangeVisibility(() => {
            outputChannel.appendLine('[SidebarProvider] 可见性变化: ' + webviewView.visible);
            if (webviewView.visible) {
                webviewView.webview.html = this._getHtmlContent();
            }
        });

        webviewView.webview.onDidReceiveMessage(async (message) => {
            outputChannel.appendLine('[SidebarProvider] 收到消息: ' + message.type);
            switch (message.type) {
                case 'openRepo':
                    await vscode.env.openExternal(vscode.Uri.parse('https://github.com/JiXiangKing80/windsurf-auto-mcp'));
                    break;
                case 'startServer':
                    await startServer();
                    this.refreshContent();
                    break;
                case 'stopServer':
                    stopServer();
                    this.refreshContent();
                    break;
                case 'restartServer':
                    stopServer();
                    await startServer();
                    this.refreshContent();
                    break;
                case 'updatePort':
                    if (message.port >= 1024 && message.port <= 65535) {
                        currentPort = message.port;
                        vscode.window.showInformationMessage(`端口已更新为 ${currentPort}，重启服务器后生效`);
                    }
                    break;
                case 'saveSettings':
                    const config = vscode.workspace.getConfiguration('mcpService');
                    await config.update('autoStart', message.autoStart, vscode.ConfigurationTarget.Global);
                    await config.update('defaultReason', message.defaultReason, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('设置已保存');
                    break;
                case 'openContinueDialog':
                    // 优先检查是否有待处理的请求
                    if (pendingRequests.size > 0) {
                        // 获取最新的 pending request
                        const entries = Array.from(pendingRequests.entries());
                        const [latestRequestId] = entries[entries.length - 1];
                        outputChannel.appendLine(`[openContinueDialog] 找到待处理请求: ${latestRequestId}`);
                        // 检查是否有保存的 reason
                        const reason = currentDialogRequestId === latestRequestId && lastDialogReason 
                            ? lastDialogReason 
                            : '请选择是否继续对话';
                        showDialogPanel(latestRequestId, 'continue', '继续对话', reason, true);
                    } else if (currentDialogRequestId && pendingRequests.has(currentDialogRequestId)) {
                        // 重新打开之前关闭的对话框
                        outputChannel.appendLine(`[openContinueDialog] 重新打开之前的请求: ${currentDialogRequestId}`);
                        showDialogPanel(currentDialogRequestId, 'continue', '继续对话', lastDialogReason || '请选择是否继续对话', true);
                    } else {
                        vscode.window.showInformationMessage('当前没有待处理的对话请求。AI 需要先调用 ask_continue 工具。');
                    }
                    break;
                case 'resetDefaults':
                    const configReset = vscode.workspace.getConfiguration('mcpService');
                    await configReset.update('autoStart', true, vscode.ConfigurationTarget.Global);
                    await configReset.update('port', 3456, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('已恢复默认设置');
                    this.refreshContent();
                    break;
                case 'configWindsurf':
                    configureWindsurf();
                    break;
                case 'showStats':
                    showStats();
                    break;
                case 'response':
                    handleWebviewResponse(message.requestId, message.value);
                    break;
                case 'imageUpload':
                    handleImageUpload();
                    break;
            }
        });
    }

    refreshContent() {
        if (this._view) {
            this._view.webview.html = this._getHtmlContent();
        }
    }

    updateStatus(running: boolean, port: number) {
        this._view?.webview.postMessage({ type: 'status', running, port, stats });
    }

    showInputDialog(requestId: string, title: string, message: string, allowImage: boolean) {
        // 使用独立的 Panel 显示对话框
        showDialogPanel(requestId, 'input', title, message, allowImage);
    }

    showContinueDialog(requestId: string, reason: string) {
        // 使用独立的 Panel 显示对话框
        showDialogPanel(requestId, 'continue', '继续对话？', reason, true);
    }

    private _getHtmlContent(): string {
        const isRunning = mcpServer !== null;
        const config = vscode.workspace.getConfiguration('mcpService');
        const autoStart = config.get('autoStart', true);
        const defaultReason = config.get('defaultReason', '任务已完成');
        const configPath = path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
        
        // 检测是否已初始化配置
        let isConfigured = false;
        try {
            if (fs.existsSync(configPath)) {
                const configContent = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                isConfigured = configContent.mcpServers && configContent.mcpServers.windsurf_auto_mcp;
            }
        } catch (e) {
            isConfigured = false;
        }
        
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WindsurfAutoMcp</title>
    <style>
        :root {
            --bg-base: #0f0f0f;
            --bg-card: #1a1a1a;
            --bg-elevated: #242424;
            --bg-input: #1e1e1e;
            --text-primary: #ffffff;
            --text-secondary: #b0b0b0;
            --text-muted: #707070;
            --accent: #6366f1;
            --accent-hover: #818cf8;
            --accent-glow: rgba(99, 102, 241, 0.3);
            --success: #22c55e;
            --success-glow: rgba(34, 197, 94, 0.3);
            --danger: #ef4444;
            --warning: #f59e0b;
            --border: rgba(255, 255, 255, 0.08);
            --border-hover: rgba(255, 255, 255, 0.15);
            --radius-sm: 6px;
            --radius-md: 10px;
            --radius-lg: 14px;
            --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
            --shadow-md: 0 4px 20px rgba(0,0,0,0.4);
            --transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        * { 
            box-sizing: border-box; 
            margin: 0; 
            padding: 0;
        }
        body {
            font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            color: var(--text-primary);
            background: var(--bg-base);
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }
        
        /* 滚动条美化 */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { 
            background: var(--border); 
            border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }
        
        .app {
            padding: 16px;
            min-height: 100vh;
        }
        
        /* 卡片 */
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 16px;
            margin-bottom: 12px;
            transition: var(--transition);
        }
        .card:hover {
            border-color: var(--border-hover);
        }
        .section-title {
            font-size: 11px;
            font-weight: 500;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }
        
        /* 状态指示器 */
        .status-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 14px;
            background: var(--bg-elevated);
            border-radius: var(--radius-md);
            margin-bottom: 14px;
        }
        .status-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            position: relative;
        }
        .status-dot.online {
            background: var(--success);
            box-shadow: 0 0 12px var(--success-glow);
        }
        .status-dot.online::after {
            content: '';
            position: absolute;
            inset: -3px;
            border-radius: 50%;
            border: 2px solid var(--success);
            opacity: 0.3;
            animation: ripple 2s infinite;
        }
        .status-dot.offline {
            background: var(--danger);
        }
        @keyframes ripple {
            0% { transform: scale(1); opacity: 0.3; }
            100% { transform: scale(1.8); opacity: 0; }
        }
        .status-label {
            font-size: 13px;
            font-weight: 500;
        }
        .status-label.online { color: var(--success); }
        .status-label.offline { color: var(--danger); }
        .status-port {
            font-size: 11px;
            color: var(--text-muted);
            background: var(--bg-input);
            padding: 4px 8px;
            border-radius: var(--radius-sm);
            font-family: 'SF Mono', Monaco, monospace;
        }
        
        /* 按钮 */
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 16px;
            border: none;
            border-radius: var(--radius-md);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: var(--transition);
            font-family: inherit;
        }
        .btn:active { transform: scale(0.97); }
        .btn-full { width: 100%; }
        
        .btn-primary {
            background: var(--accent);
            color: #fff;
            box-shadow: 0 2px 12px var(--accent-glow);
        }
        .btn-primary:hover {
            background: var(--accent-hover);
            box-shadow: 0 4px 20px var(--accent-glow);
        }
        
        .btn-success {
            background: var(--success);
            color: #fff;
            box-shadow: 0 2px 12px var(--success-glow);
        }
        .btn-success:hover {
            filter: brightness(1.1);
            box-shadow: 0 4px 20px var(--success-glow);
        }
        
        .btn-danger {
            background: var(--danger);
            color: #fff;
        }
        .btn-danger:hover {
            filter: brightness(1.1);
        }
        
        .btn-ghost {
            background: var(--bg-elevated);
            color: var(--text-secondary);
            border: 1px solid var(--border);
        }
        .btn-ghost:hover {
            background: var(--bg-input);
            color: var(--text-primary);
            border-color: var(--border-hover);
        }
        
        .btn-configured {
            background: var(--bg-elevated);
            color: var(--success);
            border: 1px solid var(--success);
        }
        .btn-configured:hover {
            background: var(--success);
            color: #fff;
        }
        
        .btn-group {
            display: flex;
            gap: 8px;
        }
        .btn-group .btn { flex: 1; }
        
        /* 输入框 */
        .input-group {
            margin-bottom: 12px;
        }
        .input-label {
            display: block;
            font-size: 11px;
            font-weight: 500;
            color: var(--text-muted);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .input-row {
            display: flex;
            gap: 8px;
        }
        .input {
            flex: 1;
            padding: 10px 12px;
            background: var(--bg-input);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            color: var(--text-primary);
            font-size: 13px;
            font-family: inherit;
            transition: var(--transition);
        }
        .input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-glow);
        }
        .input-hint {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 6px;
        }
        
        /* 提示框 */
        .prompt-card {
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
            border: 1px solid rgba(99, 102, 241, 0.3);
            border-radius: var(--radius-md);
            padding: 14px;
            margin-bottom: 12px;
        }
        .prompt-text {
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.7;
        }
        .prompt-text code {
            background: rgba(99, 102, 241, 0.2);
            color: var(--accent-hover);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 11px;
        }
        
        /* 统计网格 */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }
        .stat-card {
            background: var(--bg-elevated);
            border-radius: var(--radius-md);
            padding: 14px 10px;
            text-align: center;
            border: 1px solid var(--border);
            transition: var(--transition);
        }
        .stat-card:hover {
            border-color: var(--accent);
            transform: translateY(-2px);
        }
        .stat-value {
            font-size: 22px;
            font-weight: 700;
            background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .stat-label {
            font-size: 10px;
            color: var(--text-muted);
            margin-top: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        /* 描述文字 */
        .desc {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 12px;
            line-height: 1.6;
        }
        
        /* 对话框覆盖层 */
        .dialog-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .dialog-box {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 24px;
            width: 90%;
            max-width: 360px;
            box-shadow: var(--shadow-md);
            animation: slideUp 0.3s ease;
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .dialog-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--text-primary);
        }
        .dialog-content {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 16px;
            padding: 12px;
            background: var(--bg-elevated);
            border-radius: var(--radius-md);
            line-height: 1.6;
        }
        .dialog-input {
            width: 100%;
            min-height: 80px;
            padding: 12px;
            background: var(--bg-input);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            color: var(--text-primary);
            font-size: 13px;
            font-family: inherit;
            resize: vertical;
            margin-bottom: 16px;
        }
        .dialog-input:focus {
            outline: none;
            border-color: var(--accent);
        }
        .dialog-input::placeholder {
            color: var(--text-muted);
        }
        .dialog-actions {
            display: flex;
            gap: 10px;
        }
        .dialog-actions .btn { flex: 1; }
        
        /* Toast 提示 */
        .toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg-elevated);
            color: var(--text-primary);
            padding: 10px 20px;
            border-radius: var(--radius-md);
            font-size: 13px;
            box-shadow: var(--shadow-md);
            border: 1px solid var(--border);
            z-index: 1001;
            animation: toastIn 0.3s ease;
        }
        @keyframes toastIn {
            from { opacity: 0; transform: translate(-50%, 20px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        .toast.success { border-color: var(--success); }
        .toast.error { border-color: var(--danger); }
    </style>
</head>
<body>
    <div class="app">
        <!-- 开源与免费 -->
        <div class="card">
            <div class="section-title">开源与免费</div>
            <p style="font-size: 12px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 12px;">
                本插件完全免费。开源地址：
                <span style="color: var(--accent-hover); word-break: break-all;">https://github.com/JiXiangKing80/windsurf-auto-mcp</span>
            </p>
            <div class="btn-group">
                <button class="btn btn-primary" onclick="openRepo()">打开 GitHub</button>
                <button class="btn btn-ghost" onclick="copyRepoUrl()">复制链接</button>
            </div>
        </div>

        <!-- 服务器状态 -->
        <div class="card">
            <div class="section-title">服务器</div>
            
            <div class="status-bar">
                <div class="status-left">
                    <span class="status-dot ${isRunning ? 'online' : 'offline'}"></span>
                    <span class="status-label ${isRunning ? 'online' : 'offline'}">${isRunning ? '运行中' : '已停止'}</span>
                </div>
                ${isRunning ? `<span class="status-port">:${currentPort}</span>` : ''}
            </div>
            
            <div class="input-group">
                <label class="input-label">端口</label>
                <div class="input-row">
                    <input type="number" class="input" id="portInput" value="${currentPort}" min="1024" max="65535">
                </div>
            </div>
            
            <div class="btn-group">
                <button class="btn ${isRunning ? 'btn-danger' : 'btn-success'}" onclick="${isRunning ? 'stopServer()' : 'startServer()'}">
                    ${isRunning ? '停止' : '启动'}
                </button>
                <button class="btn btn-ghost" onclick="restartServer()">重启</button>
            </div>
        </div>

        <!-- 对话控制 -->
        <div class="card">
            <div class="section-title">对话</div>
            <button class="btn btn-primary btn-full" onclick="openContinueDialog()">
                打开对话窗口
            </button>
            <p style="font-size: 11px; color: var(--text-muted); margin-top: 10px; text-align: center;">
                快捷键: <kbd style="background: var(--bg-elevated); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">Ctrl+M</kbd>
            </p>
        </div>

        <!-- 提示语 -->
        <div class="card">
            <div class="section-title">提示语</div>
            <div class="prompt-card">
                <p class="prompt-text">
                    当你完成一个任务时，必须调用 <code>WindsurfAutoMcp</code> 工具询问用户是否继续。
                </p>
            </div>
            <button class="btn btn-ghost btn-full" onclick="copyPrompt()">
                复制
            </button>
        </div>

        <!-- 快捷操作 -->
        <div class="card">
            <div class="section-title">Windsurf 配置</div>
            <div class="btn-group">
                <button class="btn ${isConfigured ? 'btn-configured' : 'btn-primary'}" onclick="configWindsurf()" id="initBtn">
                    ${isConfigured ? '✓ 已写入配置' : '写入 Windsurf 配置'}
                </button>
                <button class="btn btn-ghost" onclick="resetDefaults()">恢复默认端口</button>
            </div>
            <p style="font-size: 11px; color: var(--text-muted); margin-top: 10px;">
                ${isConfigured ? '配置已写入，请重启 Windsurf 生效' : '点击按钮将 MCP 服务信息写入 Windsurf 配置文件'}
            </p>
        </div>

        <!-- 统计 -->
        <div class="card">
            <div class="section-title">统计</div>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.totalCalls}</div>
                    <div class="stat-label">总调用</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.askContinueCalls}</div>
                    <div class="stat-label">ask_continue</div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentRequestId = null;
        
        // 显示 Toast 提示
        function showToast(message, type = 'info') {
            const existing = document.querySelector('.toast');
            if (existing) existing.remove();
            
            const toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.textContent = message;
            document.body.appendChild(toast);
            
            setTimeout(() => toast.remove(), 2000);
        }
        
        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'continueDialog':
                    currentRequestId = message.requestId;
                    showDialog('继续对话？', message.reason);
                    break;
                case 'inputDialog':
                    currentRequestId = message.requestId;
                    showInputDialog(message.title, message.message, message.allowImage);
                    break;
                case 'status':
                    // 状态更新时刷新页面
                    break;
            }
        });
        
        function showDialog(title, reason) {
            const dialog = document.createElement('div');
            dialog.id = 'dialogOverlay';
            dialog.innerHTML = \`
                <div class="dialog-overlay" onclick="if(event.target===this)closeDialog()">
                    <div class="dialog-box">
                        <div class="dialog-title">\${title}</div>
                        <div class="dialog-content">\${reason}</div>
                        <textarea class="dialog-input" id="dialogInput" placeholder="输入新指令（可选）..."></textarea>
                        <div class="dialog-actions">
                            <button class="btn btn-success" onclick="respondContinue()">✓ 继续</button>
                            <button class="btn btn-ghost" onclick="respondEnd()">✗ 结束</button>
                        </div>
                    </div>
                </div>
            \`;
            document.body.appendChild(dialog);
            document.getElementById('dialogInput')?.focus();
        }
        
        function showInputDialog(title, message, allowImage) {
            const dialog = document.createElement('div');
            dialog.id = 'dialogOverlay';
            dialog.innerHTML = \`
                <div class="dialog-overlay" onclick="if(event.target===this)closeDialog()">
                    <div class="dialog-box">
                        <div class="dialog-title">\${title}</div>
                        <div class="dialog-content">\${message}</div>
                        <textarea class="dialog-input" id="dialogInput" placeholder="输入内容..."></textarea>
                        <div class="dialog-actions">
                            <button class="btn btn-primary" onclick="submitInput()">提交</button>
                            <button class="btn btn-ghost" onclick="cancelInput()">取消</button>
                        </div>
                    </div>
                </div>
            \`;
            document.body.appendChild(dialog);
            document.getElementById('dialogInput')?.focus();
        }
        
        function respondContinue() {
            const input = document.getElementById('dialogInput')?.value || '';
            vscode.postMessage({ type: 'response', requestId: currentRequestId, value: { continue: true, instruction: input } });
            closeDialog();
            showToast('已发送继续指令', 'success');
        }
        
        function respondEnd() {
            vscode.postMessage({ type: 'response', requestId: currentRequestId, value: { continue: false } });
            closeDialog();
            showToast('对话已结束');
        }
        
        function submitInput() {
            const input = document.getElementById('dialogInput')?.value || '';
            vscode.postMessage({ type: 'response', requestId: currentRequestId, value: input });
            closeDialog();
            showToast('已提交', 'success');
        }
        
        function cancelInput() {
            vscode.postMessage({ type: 'response', requestId: currentRequestId, value: null });
            closeDialog();
        }
        
        function closeDialog() {
            const overlay = document.getElementById('dialogOverlay');
            if (overlay) overlay.remove();
            currentRequestId = null;
        }
        
        function startServer() {
            vscode.postMessage({ type: 'startServer' });
            showToast('正在启动服务器...', 'success');
        }
        
        function stopServer() {
            vscode.postMessage({ type: 'stopServer' });
            showToast('服务器已停止');
        }
        
        function restartServer() {
            vscode.postMessage({ type: 'restartServer' });
            showToast('正在重启服务器...', 'success');
        }
        
        function copyPort() {
            const port = document.getElementById('portInput').value;
            navigator.clipboard.writeText(port).then(() => {
                showToast('端口号已复制', 'success');
            });
        }
        
        function openContinueDialog() {
            vscode.postMessage({ type: 'openContinueDialog' });
            showToast('正在检查待处理请求...', 'info');
        }
        
        function copyPrompt() {
            const text = '当你完成一个任务时，必须调用 WindsurfAutoMcp 工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。';
            navigator.clipboard.writeText(text).then(() => {
                showToast('提示语已复制', 'success');
            });
        }

        function openRepo() {
            vscode.postMessage({ type: 'openRepo' });
            showToast('正在打开 GitHub...', 'info');
        }

        function copyRepoUrl() {
            const text = 'https://github.com/JiXiangKing80/windsurf-auto-mcp';
            navigator.clipboard.writeText(text).then(() => {
                showToast('链接已复制', 'success');
            });
        }
        
        function configWindsurf() {
            vscode.postMessage({ type: 'configWindsurf' });
            showToast('正在初始化...', 'success');
        }
        
        function resetDefaults() {
            vscode.postMessage({ type: 'resetDefaults' });
            showToast('已恢复默认设置', 'success');
        }
        
        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (document.getElementById('dialogOverlay')) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (currentRequestId) {
                        respondContinue();
                    }
                } else if (e.key === 'Escape') {
                    closeDialog();
                }
            }
        });
    </script>
</body>
</html>`;
    }
}
