import * as vscode from 'vscode';
import * as http from 'http';
import { 
    MCP_TOOLS,
    handleOptimizeCommand, 
    handleSaveCommandHistory, 
    handleGetCommandHistory, 
    handleUpdateContextSummary, 
    handleGetContextSummary 
} from './mcpTools';

let mcpServer: http.Server | null = null;
let currentPort = 3456;
let outputChannel: vscode.OutputChannel;

// 统计数据
export let stats = {
    totalCalls: 0,
    askUserCalls: 0,
    askContinueCalls: 0,
    notifyCalls: 0,
    imageUploads: 0,
    startTime: Date.now()
};

let extensionContext: vscode.ExtensionContext;
const pendingRequests = new Map<string, { resolve: Function, reject: Function }>();

export function initializeServerManager(context: vscode.ExtensionContext, channel: vscode.OutputChannel) {
    extensionContext = context;
    outputChannel = channel;
    loadStats(context);
}

export function startServer(port?: number) {
    if (mcpServer) {
        outputChannel.appendLine('服务器已在运行中');
        return;
    }

    if (port) {
        currentPort = port;
    }

    mcpServer = http.createServer((req, res) => {
        handleRequest(req, res);
    });

    mcpServer.listen(currentPort, () => {
        outputChannel.appendLine(`MCP 服务器已启动，端口: ${currentPort}`);
        vscode.window.showInformationMessage(`MCP 服务器已启动，端口: ${currentPort}`);
    });

    mcpServer.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
            outputChannel.appendLine(`端口 ${currentPort} 已被占用，尝试下一个端口...`);
            currentPort++;
            mcpServer = null;
            startServer();
        } else {
            outputChannel.appendLine(`服务器启动失败: ${error.message}`);
            vscode.window.showErrorMessage(`服务器启动失败: ${error.message}`);
            mcpServer = null;
        }
    });
}

export function stopServer() {
    if (mcpServer) {
        mcpServer.close(() => {
            outputChannel.appendLine('MCP 服务器已停止');
            vscode.window.showInformationMessage('MCP 服务器已停止');
        });
        mcpServer = null;
    } else {
        outputChannel.appendLine('服务器未运行');
    }
}

export function restartServer() {
    stopServer();
    setTimeout(() => {
        startServer();
    }, 1000);
}

export function isServerRunning(): boolean {
    return mcpServer !== null;
}

export function getCurrentPort(): number {
    return currentPort;
}

export function getStats() {
    return { ...stats };
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                await handleJSONRPC(body, res);
            } catch (error) {
                outputChannel.appendLine(`请求处理错误: ${error}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal error' },
                    id: null
                }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
}

async function handleJSONRPC(body: string, res: http.ServerResponse) {
    const request = JSON.parse(body);
    outputChannel.appendLine(`收到请求: ${request.method}`);

    let response: any = {
        jsonrpc: '2.0',
        id: request.id
    };

    try {
        switch (request.method) {
            case 'initialize':
                response.result = {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: 'windsurf-auto-mcp',
                        version: '1.0.0'
                    }
                };
                break;

            case 'tools/list':
                response.result = {
                    tools: MCP_TOOLS
                };
                break;

            case 'tools/call':
                const result = await handleToolCall(request.params.name, request.params.arguments || {});
                response.result = result;
                break;

            default:
                response.error = {
                    code: -32601,
                    message: `Method not found: ${request.method}`
                };
        }
    } catch (error) {
        outputChannel.appendLine(`工具调用错误: ${error}`);
        response.error = {
            code: -32603,
            message: `Internal error: ${error}`
        };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
}

async function handleToolCall(name: string, args: any): Promise<any> {
    stats.totalCalls++;
    saveStats();

    let result: any;

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
        case 'optimize_command':
            result = await handleOptimizeCommand(args);
            break;
        case 'save_command_history':
            result = await handleSaveCommandHistory(args);
            break;
        case 'get_command_history':
            result = await handleGetCommandHistory(args);
            break;
        case 'update_context_summary':
            result = await handleUpdateContextSummary(args);
            break;
        case 'get_context_summary':
            result = await handleGetContextSummary(args);
            break;
        default:
            throw new Error(`未知工具: ${name}`);
    }

    saveStats();
    return result;
}

async function handleAskUser(args: any): Promise<any> {
    const { message, title = '用户输入', type = 'input', allowImage = false } = args;
    
    return new Promise((resolve) => {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        pendingRequests.set(requestId, { resolve, reject: () => {} });
        
        // 通过命令调用聊天界面显示对话框
        vscode.commands.executeCommand('mcpService.showInputDialog', requestId, title, message, allowImage);
    });
}

async function handleNotify(args: any): Promise<any> {
    const { message, level = 'info' } = args;
    
    switch (level) {
        case 'error':
            vscode.window.showErrorMessage(message);
            break;
        case 'warning':
            vscode.window.showWarningMessage(message);
            break;
        default:
            vscode.window.showInformationMessage(message);
    }
    
    return {
        content: [{
            type: 'text',
            text: `通知已发送: ${message}`
        }]
    };
}

async function handleAskContinue(args: any): Promise<any> {
    const { reason } = args;
    
    return new Promise((resolve) => {
        const requestId = `continue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        pendingRequests.set(requestId, { resolve, reject: () => {} });
        
        // 通过命令调用侧边栏显示继续对话框
        vscode.commands.executeCommand('mcpService.showContinueDialog', requestId, reason);
    });
}

export function handleWebviewResponse(requestId: string, value: any) {
    const pending = pendingRequests.get(requestId);
    if (pending) {
        pendingRequests.delete(requestId);
        
        if (requestId.startsWith('continue_')) {
            // 处理继续对话的响应
            if (value && value.continue) {
                let responseText = `结果: should_continue=true`;
                if (value.newInstruction && value.newInstruction.trim()) {
                    responseText += `\n\n用户新指令: ${value.newInstruction}\n\n请立即执行用户的新指令，完成后再次调用 ask_continue 工具询问是否继续。`;
                } else {
                    responseText += `\n\n用户选择继续对话，请等待用户的下一个指令，或主动询问用户需要什么帮助。完成后必须再次调用 ask_continue 工具。`;
                }
                pending.resolve({
                    content: [{
                        type: 'text',
                        text: responseText
                    }]
                });
            } else {
                pending.resolve({
                    content: [{
                        type: 'text',
                        text: '结果: should_continue=false\n\n用户选择结束对话。感谢使用！'
                    }]
                });
            }
        } else {
            // 处理普通输入的响应
            pending.resolve({
                content: [{
                    type: 'text',
                    text: value || '用户取消了输入'
                }]
            });
        }
    }
}

function saveStats() {
    if (extensionContext) {
        extensionContext.globalState.update('mcpStats', stats);
    }
}

function loadStats(context: vscode.ExtensionContext) {
    const savedStats = context.globalState.get<typeof stats>('mcpStats');
    if (savedStats) {
        stats = { ...stats, ...savedStats };
    }
}

// 处理来自聊天界面的用户响应
export function handleChatResponse(requestId: string, userResponse: string, type: 'input' | 'confirm' | 'continue') {
    let result: any;
    
    switch (type) {
        case 'input':
            result = {
                content: [{
                    type: 'text',
                    text: userResponse
                }]
            };
            break;
        case 'confirm':
            const confirmed = userResponse.toLowerCase().includes('是') || 
                            userResponse.toLowerCase().includes('yes') || 
                            userResponse.toLowerCase().includes('确认');
            result = {
                content: [{
                    type: 'text',
                    text: confirmed ? 'confirmed' : 'cancelled'
                }]
            };
            break;
        case 'continue':
            const shouldContinue = userResponse.toLowerCase().includes('继续') || 
                                  userResponse.toLowerCase().includes('是') ||
                                  userResponse.toLowerCase().includes('yes');
            result = {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ should_continue: shouldContinue })
                }]
            };
            break;
    }
    
    const pending = pendingRequests.get(requestId);
    if (pending) {
        pendingRequests.delete(requestId);
        pending.resolve(result);
    }
}
