import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isServerRunning, getCurrentPort, getStats } from './serverManager';
import { handleWebviewResponse } from './serverManager';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mcpServicePanel.sidebarView';

    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    private _extensionUri: vscode.Uri;
    private _context: vscode.ExtensionContext;

    private static readonly PENDING_CASCADE_HISTORY_KEY = 'windsurfAutoMcp_pendingCascadeHistory';

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

        // 如果侧边栏现在才打开，需要把之前缓存的Cascade指令补发到前端历史
        try {
            const pending = this._context.globalState.get<{ command: string; timestamp: number; source: string }[]>(
                SidebarProvider.PENDING_CASCADE_HISTORY_KEY,
                []
            );
            if (pending.length > 0 && this._view) {
                for (const item of pending) {
                    this._view.webview.postMessage({
                        type: 'addCommandToHistory',
                        command: item.command,
                        timestamp: item.timestamp,
                        source: item.source
                    });
                }
                void this._context.globalState.update(SidebarProvider.PENDING_CASCADE_HISTORY_KEY, []);
            }
        } catch (error) {
            console.error('补发Cascade历史缓存失败:', error);
        }

        // 启动Cascade指令监听器
        this.startCascadeCommandListener();

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'optimizeCommand':
                    this.optimizeCommand(data.command);
                    break;
                case 'addFile':
                    this.addFile();
                    break;
                case 'endConversation':
                    this.endConversation();
                    break;
                case 'continueConversation':
                    this.continueConversation(data.command, data.attachments);
                    break;
                case 'testCascadeHistory':
                    this.recordCascadeCommandToHistory(data.command);
                    console.log('测试：已记录Cascade指令到历史:', data.command);
                    break;
                case 'saveConfig':
                    this.saveConfig(data.config);
                    break;
                case 'userResponse':
                    handleWebviewResponse(data.requestId, data.value);
                    break;
                case 'generateSummary':
                    this.generateSummary(data.history);
                    break;
                case 'requestButtonReset':
                    // 处理来自webview的按钮重置请求
                    this.resetButtonState();
                    break;
                case 'showNotification':
                    // 处理来自webview的通知请求
                    this.showNotification(data.message, data.level);
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

    private async optimizeCommand(command: string) {
        console.log('开始优化指令:', command);
        if (!command || !command.trim()) {
            vscode.window.showWarningMessage('请先输入要优化的指令');
            return;
        }

        // 获取API配置
        const config = vscode.workspace.getConfiguration('windsurfAutoMcp');
        const apiKey = config.get<string>('apiKey', '');
        
        if (!apiKey || apiKey.trim().length < 10) {
            vscode.window.showWarningMessage('请先在设置中配置有效的API Key');
            return;
        }
        const trimmedApiKey = apiKey.trim();
        console.log('使用API Key前4位:', trimmedApiKey.substring(0, 4) + '...');

        try {
            // 显示优化中状态
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'optimizeStatus',
                    status: 'optimizing',
                    message: '正在优化指令...'
                });
            }

            // 调用智谱AI API优化指令
            const optimizedCommand = await this.callOptimizeAPI(command, apiKey);
            
            // 发送优化结果到webview
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'optimizeResult',
                    original: command,
                    optimized: optimizedCommand
                });
            }

            vscode.window.showInformationMessage('指令优化完成');
        } catch (error) {
            console.error('指令优化失败:', error);
            vscode.window.showErrorMessage(`指令优化失败: ${error}`);
            
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'optimizeStatus',
                    status: 'error',
                    message: '优化失败，请检查API配置'
                });
            }
        }
    }

    private async callOptimizeAPI(command: string, apiKey: string): Promise<string> {
        const https = require('https');
        
        const postData = JSON.stringify({
            model: "GLM-4-Flash",
            messages: [
                {
                    role: "system",
                    content: "你是一个专业的指令优化助手。请帮助用户优化他们的指令，使其更加清晰、准确和易于理解。请直接返回优化后的指令，不要添加额外的解释。"
                },
                {
                    role: "user",
                    content: `请优化以下指令，使其更加清晰和准确：\n\n${command}`
                }
            ],
            temperature: 0.3,
            max_tokens: 1000
        });

        const options = {
            hostname: 'open.bigmodel.cn',
            port: 443,
            path: '/api/paas/v4/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res: any) => {
                let data = '';

                res.on('data', (chunk: any) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.choices && response.choices[0] && response.choices[0].message) {
                            resolve(response.choices[0].message.content.trim());
                        } else {
                            reject(new Error('API响应格式错误'));
                        }
                    } catch (error) {
                        reject(new Error('解析API响应失败'));
                    }
                });
            });

            req.on('error', (error: any) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    private async addFile() {
        // 添加文件功能 - 打开文件选择器
        const fileUri = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: '选择文件',
            filters: {
                'Images': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'],
                'Documents': ['pdf', 'doc', 'docx', 'txt', 'md'],
                'Code': ['js', 'ts', 'py', 'java', 'cpp', 'c', 'html', 'css', 'json'],
                'All files': ['*']
            }
        });

        if (fileUri && fileUri.length > 0) {
            for (const uri of fileUri) {
                const filePath = uri.fsPath;
                const fileName = path.basename(filePath);
                const fileStats = fs.statSync(filePath);
                const fileSize = fileStats.size;
                
                // 检查是否为图片文件
                const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
                const fileExt = path.extname(fileName).toLowerCase();
                const isImage = imageExtensions.includes(fileExt);
                
                let fileData = filePath; // 默认使用文件路径
                
                // 如果是图片，读取并转换为base64
                if (isImage) {
                    try {
                        const imageBuffer = fs.readFileSync(filePath);
                        const mimeType = this.getMimeType(fileExt);
                        fileData = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
                    } catch (error) {
                        console.error('读取图片文件失败:', error);
                        vscode.window.showErrorMessage(`无法读取图片文件: ${fileName}`);
                        continue;
                    }
                }
                
                // 发送文件信息到webview
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'fileSelected',
                        file: {
                            name: fileName,
                            type: isImage ? this.getMimeType(fileExt) : 'application/octet-stream',
                            size: fileSize,
                            data: fileData,
                            path: filePath
                        }
                    });
                }
            }
            
            vscode.window.showInformationMessage(`已选择 ${fileUri.length} 个文件`);
        }
    }

    private getMimeType(extension: string): string {
        const mimeTypes: { [key: string]: string } = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
        };
        return mimeTypes[extension] || 'application/octet-stream';
    }

    private endConversation() {
        // 结束对话功能
        vscode.window.showInformationMessage('对话已结束');
        // 可以执行清理操作或保存对话历史
    }

    private async tryExecuteCommand(commandId: string, ...args: any[]) {
        try {
            await vscode.commands.executeCommand(commandId, ...args);
            return true;
        } catch {
            return false;
        }
    }

    private async tryExecuteCommandAny(commandIds: string[], ...args: any[]) {
        for (const id of commandIds) {
            const ok = await this.tryExecuteCommand(id, ...args);
            if (ok) return true;
        }
        return false;
    }


    private async continueConversation(command: string, attachments?: any[]) {
        // 继续对话功能 - 与WindsurfAutoMcp集成
        if (command && command.trim()) {
            try {
                // 通知webview开始处理
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'conversationStarted'
                    });
                }
                
                // 获取配置
                const config = vscode.workspace.getConfiguration('windsurfAutoMcp');
                const additionalRules = config.get<string>('additionalRules', '');
                const autoOptimize = config.get<boolean>('autoOptimize', false);
                
                let finalCommand = command;
                
                // 如果开启自动优化，先优化指令
                if (autoOptimize) {
                    const apiKey = config.get<string>('apiKey', '');
                    if (apiKey) {
                        try {
                            finalCommand = await this.callOptimizeAPI(command, apiKey);
                        } catch (error) {
                            console.warn('指令优化失败，使用原始指令:', error);
                        }
                    }
                }
                
                // 处理附件信息
                let attachmentInfo = '';
                if (attachments && attachments.length > 0) {
                    attachmentInfo = `\n\n附件信息：包含 ${attachments.length} 个文件`;
                    attachments.forEach((att, index) => {
                        attachmentInfo += `\n${index + 1}. ${att.name} (${att.type})`;
                    });
                }
                
                const fullCommand = finalCommand + attachmentInfo;
                
                console.log('保存指令供MCP协议使用:', finalCommand);

                // 记录用户的原始指令到历史（在发送前记录）
                this.recordCascadeCommandToHistory(finalCommand);

                // 保存 pendingCommand，供 MCP 协议使用
                // 当 Cascade 调用 windsurf_auto_mcp 工具时，我们会返回这个指令
                try {
                    await this.savePendingCommand(fullCommand);
                    console.log('指令已保存到MCP服务器，等待Cascade调用windsurf_auto_mcp工具');
                } catch (error) {
                    console.error('保存指令到MCP服务器失败:', error);
                    throw error;
                }

                // 尝试主动通知Cascade有新指令等待处理
                try {
                    await this.triggerCascadeCheck();
                } catch (triggerError) {
                    console.log('主动触发Cascade检查失败，使用标准MCP流程:', triggerError);
                }

                // 显示等待状态，不需要用户额外操作
                vscode.window.showInformationMessage(
                    '指令已准备就绪，等待Cascade调用WindsurfAutoMcp工具继续执行'
                );

                // 通知webview对话开始
                // 更新webview状态 - 指令已发送，等待Cascade处理
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'conversationSent',
                        command: finalCommand,
                        attachments: attachments
                    });
                    
                    // 立即通知开始处理状态
                    this._view.webview.postMessage({
                        type: 'cascadeProcessing'
                    });
                }
                
                // 监听Cascade的处理状态
                this.startMonitoringCascadeStatus();
                
            } catch (error) {
                console.error('发送对话失败:', error);
                
                // 尝试备用发送方法
                console.log('尝试备用发送方法...');
                try {
                    await this.fallbackSendCommand(command);
                    vscode.window.showInformationMessage('使用备用方法发送指令成功');
                    
                    // 更新webview状态
                    if (this._view) {
                        this._view.webview.postMessage({
                            type: 'conversationSent',
                            command: command,
                            attachments: attachments
                        });
                        
                        this._view.webview.postMessage({
                            type: 'cascadeProcessing'
                        });
                    }
                    
                    // 启动监控
                    this.startMonitoringCascadeStatus();
                    
                } catch (fallbackError) {
                    console.error('备用发送方法也失败:', fallbackError);
                    vscode.window.showErrorMessage(`发送对话失败: ${error}`);
                    
                    // 恢复按钮状态
                    if (this._view) {
                        this._view.webview.postMessage({
                            type: 'conversationError',
                            error: '发送失败，请重试（已尝试自动发送与剪贴板回退）'
                        });
                    }
                }
            }
        }
    }

    private async generateSummary(history: any[]) {
        // 生成摘要功能
        try {
            // 获取API配置
            const config = vscode.workspace.getConfiguration('windsurfAutoMcp');
            const apiKey = config.get('apiKey', '');
            
            if (!apiKey) {
                // 如果没有API Key，使用简单的摘要逻辑
                let summary = '基于对话历史生成的摘要：\n\n';
                
                if (history && history.length > 0) {
                    const userMessages = history.filter(h => h.type === 'user').slice(-5);
                    const topics = userMessages.map(m => m.content.substring(0, 50)).join('、');
                    summary += `最近讨论的主要话题包括：${topics}...`;
                } else {
                    summary += '暂无对话历史记录。';
                }
                
                // 发送摘要回webview
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'summaryGenerated',
                        summary: summary
                    });
                }
                
                vscode.window.showInformationMessage('摘要生成完成（使用简单模式，建议配置API Key获得更好效果）');
                return;
            }

            // 使用AI生成智能摘要
            if (history && history.length > 0) {
                const conversationText = this.formatHistoryForSummary(history);
                const aiSummary = await this.callSummaryAPI(conversationText, apiKey);
                
                // 发送AI生成的摘要回webview
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'summaryGenerated',
                        summary: aiSummary
                    });
                }
                
                vscode.window.showInformationMessage('AI摘要生成完成');
            } else {
                // 没有对话历史
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'summaryGenerated',
                        summary: '暂无对话历史记录，无法生成摘要。'
                    });
                }
            }
            
        } catch (error) {
            console.error('生成摘要失败:', error);
            vscode.window.showErrorMessage(`生成摘要失败: ${error}`);
            
            // 发送错误消息回webview
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'summaryError',
                    error: '生成摘要失败，请稍后重试'
                });
            }
        }
    }

    private formatHistoryForSummary(history: any[]): string {
        // 格式化对话历史为摘要生成的输入文本
        const recentHistory = history.slice(-10); // 取最近10条记录
        let formattedText = '';
        
        recentHistory.forEach((item, index) => {
            const role = item.type === 'user' ? '用户' : 'AI助手';
            const content = item.content || '';
            formattedText += `${index + 1}. ${role}: ${content}\n\n`;
        });
        
        return formattedText;
    }

    private async callSummaryAPI(conversationText: string, apiKey: string): Promise<string> {
        const https = require('https');
        
        const postData = JSON.stringify({
            model: "GLM-4-Flash",
            messages: [
                {
                    role: "system",
                    content: "你是一个专业的对话摘要助手。请根据提供的对话历史，生成一个简洁、准确的摘要，突出主要讨论点、关键决策和重要结论。摘要应该帮助用户快速回顾对话要点。"
                },
                {
                    role: "user",
                    content: `请为以下对话历史生成摘要：\n\n${conversationText}`
                }
            ],
            temperature: 0.3,
            max_tokens: 500
        });

        const options = {
            hostname: 'open.bigmodel.cn',
            port: 443,
            path: '/api/paas/v4/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res: any) => {
                let data = '';

                res.on('data', (chunk: any) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.choices && response.choices[0] && response.choices[0].message) {
                            resolve(response.choices[0].message.content.trim());
                        } else {
                            reject(new Error('API响应格式错误'));
                        }
                    } catch (error) {
                        reject(new Error('解析API响应失败'));
                    }
                });
            });

            req.on('error', (error: any) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    private saveConfig(config: any) {
        // 保存配置功能
        const workspaceConfig = vscode.workspace.getConfiguration('windsurfAutoMcp');
        
        if (config.apiKey) {
            workspaceConfig.update('apiKey', config.apiKey, vscode.ConfigurationTarget.Global);
        }
        if (config.model) {
            workspaceConfig.update('model', config.model, vscode.ConfigurationTarget.Global);
        }
        if (config.additionalRules) {
            workspaceConfig.update('additionalRules', config.additionalRules, vscode.ConfigurationTarget.Global);
        }
        if (config.autoOptimize !== undefined) {
            workspaceConfig.update('autoOptimize', config.autoOptimize, vscode.ConfigurationTarget.Global);
        }
        
        vscode.window.showInformationMessage('配置已保存');
    }

    public refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
        }
    }
    
    // 监听Cascade处理状态
    private startMonitoringCascadeStatus() {
        // 通知webview Cascade开始处理
        if (this._view) {
            this._view.webview.postMessage({
                type: 'cascadeProcessing'
            });
        }
        
        // 清除之前的监控定时器
        if ((this as any)._currentMonitoringInterval) {
            clearInterval((this as any)._currentMonitoringInterval);
        }
        
        // 监听VS Code活动窗口变化来检测Cascade状态
        let processingTime = 0;
        const checkInterval = setInterval(() => {
            processingTime += 2000;
            
            // 检查是否有活动的聊天会话
            const activeEditor = vscode.window.activeTextEditor;
            const visibleEditors = vscode.window.visibleTextEditors;
            
            // 每10秒检查一次状态
            if (processingTime % 10000 === 0) {
                console.log(`Cascade处理监控中... ${processingTime/1000}秒`);
                
                // 尝试检测Cascade是否完成处理
                this.checkCascadeCompletion();
            }
            
            // 如果超过120秒，认为处理完成或超时
            if (processingTime >= 120000) {
                clearInterval(checkInterval);
                this.notifyCascadeComplete();
                console.log('Cascade处理监控超时，重置状态');
            }
        }, 2000);
        
        // 保存interval ID以便外部可以清除
        (this as any)._currentMonitoringInterval = checkInterval;
    }
    
    // 检查Cascade完成状态
    private checkCascadeCompletion() {
        // 这里可以添加更智能的检测逻辑
        // 比如检查聊天面板的状态、检查是否有新的输出等
        
        // 暂时使用简单的逻辑：如果没有活动的编辑器变化，可能表示处理完成
        // 实际项目中可以根据具体需求优化这个检测逻辑
    }
    
    // 重置按钮状态（供外部调用）
    public resetButtonState() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'resetButtonState'
            });
        }
    }

    private showNotification(message: string, level: string = 'info') {
        switch (level) {
            case 'error':
                vscode.window.showErrorMessage(message);
                break;
            case 'warning':
                vscode.window.showWarningMessage(message);
                break;
            case 'info':
            default:
                vscode.window.showInformationMessage(message);
                break;
        }
    }
    
    // 通知Cascade开始处理
    public notifyCascadeProcessing() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'cascadeProcessing'
            });
        }
    }
    
    // 通知Cascade处理完成
    public notifyCascadeComplete() {
        // 清除监控定时器
        if ((this as any)._currentMonitoringInterval) {
            clearInterval((this as any)._currentMonitoringInterval);
            (this as any)._currentMonitoringInterval = null;
        }
        
        if (this._view) {
            this._view.webview.postMessage({
                type: 'cascadeProcessingComplete'
            });
        }
    }


    // 保存待处理的指令到MCP服务器
    private async savePendingCommand(command: string) {
        try {
            // 方法1: 通过MCP工具模块保存
            const mcpTools = require('./mcpTools');
            if (mcpTools && mcpTools.setPendingCommand) {
                mcpTools.setPendingCommand(command);
                console.log('指令已保存到MCP工具模块');
            }
            
            // 方法2: 直接调用MCP服务器的set_pending_command工具
            try {
                const http = require('http');
                const postData = JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/call',
                    params: {
                        name: 'set_pending_command',
                        arguments: { command: command }
                    }
                });

                const options = {
                    hostname: 'localhost',
                    port: 3456,
                    path: '/',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': postData.length
                    }
                };

                await new Promise((resolve, reject) => {
                    const req = http.request(options, (res: any) => {
                        let data = '';
                        res.on('data', (chunk: any) => data += chunk);
                        res.on('end', () => {
                            console.log('MCP服务器响应:', data);
                            resolve(data);
                        });
                    });
                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });
                
                console.log('指令已通过HTTP发送到MCP服务器');
                return true;
            } catch (httpError) {
                console.error('HTTP调用MCP服务器失败:', httpError);
                throw httpError;
            }
        } catch (error) {
            console.error('保存指令到MCP服务器失败:', error);
            throw error;
        }
    }
    
    // 备用发送方法 - 使用不同的策略发送指令
    private async fallbackSendCommand(command: string) {
        console.log('执行备用发送方法:', command);
        
        try {
            // 方法1: 直接显示指令给用户，让用户手动复制粘贴
            const result = await vscode.window.showInformationMessage(
                `无法自动发送指令到Cascade。请手动复制以下指令到Cascade聊天框：\n\n${command}`,
                { modal: true },
                '复制指令',
                '取消'
            );
            
            if (result === '复制指令') {
                await vscode.env.clipboard.writeText(command);
                vscode.window.showInformationMessage('指令已复制到剪贴板，请粘贴到Cascade聊天框');
                
                // 尝试打开聊天面板
                try {
                    await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                } catch (focusError) {
                    console.log('无法自动打开聊天面板:', focusError);
                }
                
                return true;
            } else {
                throw new Error('用户取消了手动发送');
            }
            
        } catch (error) {
            console.error('备用发送方法失败:', error);
            throw error;
        }
    }
    
    // 记录指令到历史记录
    private recordCommandToHistory(command: string) {
        if (this._view && command && command.trim()) {
            console.log('正在记录Cascade指令到历史:', command);
            this._view.webview.postMessage({
                type: 'addCommandToHistory',
                command: command.trim(),
                timestamp: Date.now(),
                source: 'cascade'
            });
        }
    }

    // 记录Cascade执行的指令到历史记录（供外部调用）
    public recordCascadeCommandToHistory(command: string) {
        if (!command || !command.trim()) return;

        const trimmed = command.trim();
        const payload = {
            command: trimmed,
            timestamp: Date.now(),
            source: 'cascade'
        };

        // 侧边栏没打开时先缓存，避免记录丢失
        if (!this._view) {
            try {
                const pending = this._context.globalState.get<typeof payload[]>(
                    SidebarProvider.PENDING_CASCADE_HISTORY_KEY,
                    []
                );
                pending.push(payload);
                void this._context.globalState.update(SidebarProvider.PENDING_CASCADE_HISTORY_KEY, pending);
                console.log('侧边栏未打开，已缓存Cascade指令到globalState:', trimmed);
            } catch (error) {
                console.error('缓存Cascade指令失败:', error);
            }
            return;
        }

        console.log('记录Cascade执行的指令到历史:', trimmed);
        this._view.webview.postMessage({
            type: 'addCommandToHistory',
            command: payload.command,
            timestamp: payload.timestamp,
            source: payload.source
        });
    }

    // 主动触发Cascade检查新指令
    private async triggerCascadeCheck(): Promise<void> {
        try {
            // 尝试通过VS Code命令触发Cascade检查
            await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
            
            // 等待一下让聊天面板加载
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // 尝试发送一个提示消息让Cascade知道有新指令
            const hintMessage = '请调用 windsurf_auto_mcp 工具检查是否有新的用户指令需要执行。';
            
            // 尝试将提示消息复制到剪贴板
            await vscode.env.clipboard.writeText(hintMessage);
            
            console.log('已触发Cascade检查，提示消息已复制到剪贴板');
        } catch (error) {
            console.error('触发Cascade检查失败:', error);
            throw error;
        }
    }

    // 启动Cascade指令监听器
    private startCascadeCommandListener() {
        // 监听VS Code命令执行
        const commandDisposable = vscode.commands.registerCommand('windsurfAutoMcp.recordCascadeCommand', (command: string) => {
            if (command && command.trim()) {
                console.log('记录Cascade指令:', command);
                this.recordCascadeCommandToHistory(command);
            }
        });

        // 监听聊天面板的活动
        const chatDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && (editor.document.uri.scheme === 'vscode-chat' || 
                          editor.document.fileName.includes('chat') ||
                          editor.document.fileName.includes('cascade'))) {
                // 延迟检查聊天内容
                setTimeout(() => {
                    this.checkForCascadeActivity(editor);
                }, 2000);
            }
        });

        // 监听文档变化（作为备用方案）
        const docDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.scheme === 'vscode-chat' || 
                event.document.fileName.includes('chat') ||
                event.document.fileName.includes('cascade')) {
                
                // 延迟检查，避免频繁触发
                setTimeout(() => {
                    this.checkForCascadeActivity();
                }, 3000);
            }
        });

        this._disposables.push(commandDisposable, chatDisposable, docDisposable);
    }

    // 检查Cascade活动并尝试记录指令
    private checkForCascadeActivity(editor?: vscode.TextEditor) {
        // 使用传入的编辑器或当前活动的编辑器
        const targetEditor = editor || vscode.window.activeTextEditor;
        if (!targetEditor) return;
        
        const text = targetEditor.document.getText();
        
        // 尝试从文本中提取可能的指令
        const lines = text.split('\n');
        const recentLines = lines.slice(-10); // 检查最近10行
        
        for (const line of recentLines) {
            const trimmedLine = line.trim();
            
            // 检查是否像是用户指令（简单的启发式检测）
            if (trimmedLine.length > 10 && 
                !trimmedLine.startsWith('```') &&
                !trimmedLine.startsWith('#') &&
                !trimmedLine.startsWith('//') &&
                (trimmedLine.includes('创建') || 
                 trimmedLine.includes('修改') || 
                 trimmedLine.includes('删除') || 
                 trimmedLine.includes('分析') || 
                 trimmedLine.includes('实现') ||
                 trimmedLine.includes('修复') ||
                 trimmedLine.includes('优化'))) {
                
                // 记录可能的指令
                console.log('检测到可能的Cascade指令:', trimmedLine);
                this.recordCascadeCommandToHistory(trimmedLine);
                break; // 只记录第一个匹配的指令
            }
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

        // 获取配置
        const config = vscode.workspace.getConfiguration('windsurfAutoMcp');
        const apiKey = config.get('apiKey', '');
        const model = config.get('model', 'GLM-4.5-Flash');
        // 设置默认的追加规则
        const defaultRules = `请遵循以下规则：
1. 用中文回复
2. 提供详细的解释和示例
3. 如果涉及代码，请提供完整可运行的代码
4. 优先考虑最佳实践和安全性
5. 如有疑问请主动询问澄清`;
        const additionalRules = config.get<string>('additionalRules', defaultRules);
        const autoOptimize = config.get('autoOptimize', false);

        // 替换模板变量
        htmlContent = htmlContent.replace(/\{\{STYLES\}\}/g, cssContent);

        // 注入配置数据到JavaScript中
        const configScript = `
            <script>
                window.initialConfig = {
                    apiKey: ${JSON.stringify(apiKey)},
                    model: ${JSON.stringify(model)},
                    additionalRules: ${JSON.stringify(additionalRules)},
                    autoOptimize: ${autoOptimize}
                };
                
                // 页面加载完成后填充配置
                document.addEventListener('DOMContentLoaded', function() {
                    setTimeout(function() {
                        if (window.initialConfig) {
                            const apiKeyInput = document.getElementById('apiKey');
                            const modelSelect = document.getElementById('modelSelect');
                            const additionalRulesTextarea = document.getElementById('additionalRules');
                            const autoOptimizeCheckbox = document.getElementById('autoOptimize');
                            
                            if (apiKeyInput) {
                                apiKeyInput.value = window.initialConfig.apiKey || '';
                                // 显示API KEY的前几位和后几位，中间用*代替（如果有值）
                                if (window.initialConfig.apiKey && window.initialConfig.apiKey.length > 8) {
                                    const maskedKey = window.initialConfig.apiKey.substring(0, 4) + '*'.repeat(window.initialConfig.apiKey.length - 8) + window.initialConfig.apiKey.substring(window.initialConfig.apiKey.length - 4);
                                    apiKeyInput.placeholder = '当前: ' + maskedKey;
                                }
                            }
                            if (modelSelect) modelSelect.value = window.initialConfig.model || 'GLM-4.5-Flash';
                            if (additionalRulesTextarea) {
                                additionalRulesTextarea.value = window.initialConfig.additionalRules || '';
                            }
                            if (autoOptimizeCheckbox) autoOptimizeCheckbox.checked = window.initialConfig.autoOptimize || false;
                        }
                    }, 100);
                });
            </script>
        `;

        // 在</body>前插入配置脚本
        htmlContent = htmlContent.replace('</body>', configScript + '</body>');

        return htmlContent;
    }

    public showUserRequest(requestId: string, title: string, message: string, type: 'continue' | 'input') {
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

    // 外部调用的指令优化方法（供 MCP 服务器使用）
    public async optimizeCommandExternally(requestId: string, content: string, context?: string): Promise<string> {
        if (!content.trim()) return content;

        // 从统一的配置空间获取API Key
        const config = vscode.workspace.getConfiguration('windsurfAutoMcp');
        const apiKey = config.get('apiKey', '');
        if (!apiKey) {
            vscode.window.showErrorMessage('请先在扩展设置中配置 智谱 AI API Key');
            return content;
        }

        try {
            const model = config.get('model', 'GLM-4.5-Flash');
            const prompt = `你是一个专业的开发者工具指令美化专家。请将以下用户输入的原始指令优化为更专业、描述更清晰、更符合 AI 助手（如 Windsurf 或 Copilot）执行的描述。\n原始指令：${content}\n要求：\n1. 保持原意。\n2. 扩写细节。\n3. 只返回优化后的指令文本。`;

            const optimizedCommand = await this.callOptimizeAPI(prompt, apiKey);
            return optimizedCommand;
        } catch (error) {
            console.error('指令优化失败:', error);
            vscode.window.showErrorMessage(`指令优化失败: ${error}`);
            return content;
        }
    }
}
