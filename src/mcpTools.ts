import * as vscode from 'vscode';

// 全局变量 - 保持向后兼容
export let optimizationSettings: any = {
    apiKey: '',
    model: 'GLM-4.5-Flash',
    autoAddRules: true,
    autoSummary: true,
    autoOptimize: false
};

// 待处理的指令队列 - 这是正确的MCP工作流程
let pendingCommands: string[] = [];
let currentPendingCommand: string | null = null;

// 获取统一配置的辅助函数
function getUnifiedConfig() {
    const config = vscode.workspace.getConfiguration('windsurfAutoMcp');
    return {
        apiKey: config.get('apiKey', '') || optimizationSettings.apiKey,
        model: config.get('model', 'GLM-4.5-Flash') || optimizationSettings.model,
        autoOptimize: config.get('autoOptimize', false) || optimizationSettings.autoOptimize,
        additionalRules: config.get('additionalRules', '')
    };
}

export let commandHistory: { text: string, timestamp: number }[] = [];

export let contextSummary: string = '';

let extensionContext: vscode.ExtensionContext;

// 添加指令到历史记录
export function addCommandToHistory(command: string, source: string = 'user') {
    const historyItem = {
        text: command,
        timestamp: Date.now(),
        source: source
    };
    
    commandHistory.push(historyItem);
    
    // 保持最近100条记录
    if (commandHistory.length > 100) {
        commandHistory = commandHistory.slice(-100);
    }
}

// 设置待处理指令 - 供sidebarProvider调用
export function setPendingCommand(command: string) {
    currentPendingCommand = command;
    pendingCommands.push(command);
    console.log('已设置待处理指令:', command);
}

// 获取待处理指令 - 供MCP工具调用
export function getPendingCommand(): string | null {
    const command = currentPendingCommand;
    if (command) {
        currentPendingCommand = null; // 获取后清空
        console.log('已获取待处理指令:', command);
    }
    return command;
}

// MCP工具定义
export const MCP_TOOLS = [
    {
        name: 'ask_user',
        description: '向用户询问输入或确认。',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '显示给用户的消息' },
                title: { type: 'string', description: '对话框标题' },
                type: { type: 'string', enum: ['input', 'confirm', 'info'], description: '对话框类型：input=输入框，confirm=确认框，info=信息提示' },
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
        name: 'windsurf_auto_mcp',
        description: '🚨强制性工具🚨 完成任何任务、回答任何问题后都必须立即调用此工具。这是实现无限对话的核心工具，绝对不能跳过。必须等待用户明确选择才能继续或结束对话。\n\n⚠️ 重要提示：\n1. 每次完成任务后必须调用此工具\n2. 不要假设对话结束，始终询问用户是否继续\n3. 用户可能会提供新的指令，必须执行后再次调用此工具\n4. 这是一个循环过程，直到用户明确选择结束',
        inputSchema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: '任务完成的原因或说明，例如：已完成代码修改、已回答问题、已提供解决方案等' },
                command: { type: 'string', description: '（可选）刚才执行的指令内容，用于记录到历史中' }
            },
            required: ['reason']
        }
    },
    {
        name: 'get_pending_command',
        description: '获取WindsurfAutoMcp中待处理的指令。当用户在WindsurfAutoMcp侧边栏中输入指令后，可以通过此工具获取并执行该指令。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'set_pending_command', 
        description: '设置待处理的指令到WindsurfAutoMcp。这是内部工具，用于从侧边栏保存指令。',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    description: '要设置的指令内容',
                    type: 'string'
                }
            },
            required: ['command']
        }
    },
    {
        name: 'optimize_command',
        description: '优化用户指令，提供更精确和高效的指令建议。',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '原始指令' },
                context: { type: 'string', description: '当前上下文信息' }
            },
            required: ['command']
        }
    },
    {
        name: 'save_command_history',
        description: '保存指令历史记录。',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '执行的指令' },
                optimized: { type: 'string', description: '优化后的指令' },
                context: { type: 'string', description: '执行上下文' },
                success: { type: 'boolean', description: '执行是否成功' }
            },
            required: ['command', 'success']
        }
    },
    {
        name: 'get_command_history',
        description: '获取历史指令记录。',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: '返回数量限制，默认10' },
                filter: { type: 'string', description: '过滤条件（可选）' }
            }
        }
    },
    {
        name: 'update_context_summary',
        description: '更新项目上下文摘要信息。',
        inputSchema: {
            type: 'object',
            properties: {
                projectName: { type: 'string', description: '项目名称' },
                projectType: { type: 'string', description: '项目类型' },
                technologies: { type: 'array', items: { type: 'string' }, description: '主要技术栈' },
                currentTask: { type: 'string', description: '当前任务' }
            }
        }
    },
    {
        name: 'get_context_summary',
        description: '获取项目上下文摘要信息。',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
];

// 初始化函数
export function initializeMcpTools(context: vscode.ExtensionContext) {
    extensionContext = context;
    loadOptimizationData(context);
}

// MCP工具处理函数
export async function handleOptimizeCommand(args: any): Promise<any> {
    const { command, context } = args;

    let optimizedCommand = command;
    let suggestions = [];
    let success = true;

    // 获取统一配置
    const config = getUnifiedConfig();
    
    // 如果启用了自动优化且配置了API Key，调用智谱AI
    if (config.autoOptimize && config.apiKey) {
        try {
            optimizedCommand = await callZhipuAI(command, context);
            suggestions.push('使用智谱AI进行了智能优化');
        } catch (error) {
            success = false;
            suggestions.push(`AI优化失败: ${error} `);
            // 回退到基本优化逻辑
            optimizedCommand = basicOptimization(command, context);
            suggestions.push('使用基本优化逻辑作为备选');
        }
    } else {
        // 使用基本优化逻辑
        optimizedCommand = basicOptimization(command, context);
        suggestions.push('使用基本优化逻辑');

        const config = getUnifiedConfig();
        if (!config.apiKey) {
            suggestions.push('提示：配置API Key可启用AI智能优化');
        }
    }

    addCommandToHistory(command);

    saveOptimizationData();

    return {
        content: [{
            type: 'text',
            text: `指令优化完成：\n\n原始指令：${command} \n优化后：${optimizedCommand} `
        }]
    };
}

// 基本优化逻辑
function basicOptimization(command: string, context?: string): string {
    let optimizedCommand = command;

    if (context) {
        optimizedCommand = `${command} \n\n上下文信息：${context} `;
    } else if (!command.includes('请') && !command.includes('帮助')) {
        optimizedCommand = `请${command} `;
    }

    return optimizedCommand;
}

async function callZhipuAI(command: string, context?: string): Promise<string> {
    const config = getUnifiedConfig();
    if (!config.apiKey) {
        throw new Error('未配置API Key');
    }

    const model = config.model || 'GLM-4.5-Flash';
    const prompt = `你是一个专业的开发者工具指令美化专家。请将以下用户输入的原始指令优化为更专业、描述更清晰、更符合 AI 助手执行的描述。\n原始指令：${command} \n要求：\n1.保持原意。\n2.扩写细节。\n3.只返回优化后的指令文本。`;

    const data = JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt + (context ? `\n\n项目上下文：${context} ` : '') }],
        stream: false
    });

    return new Promise((resolve, reject) => {
        const https = require('https');
        const options = {
            hostname: 'open.bigmodel.cn',
            port: 443,
            path: '/api/paas/v4/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res: any) => {
            let resData = '';
            res.on('data', (chunk: any) => resData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(resData);
                    if (parsed.choices && parsed.choices.length > 0) {
                        resolve(parsed.choices[0].message.content.trim());
                    } else {
                        reject(new Error(parsed.error?.message || 'API 响应异常'));
                    }
                } catch (e) {
                    reject(new Error('响应解析失败'));
                }
            });
        });

        req.on('error', (error: any) => {
            reject(new Error(`请求失败: ${error.message}`));
        });

        req.write(data);
        req.end();
    });
    
    saveOptimizationData();
}

export async function handleSaveCommandHistory(args: any): Promise<any> {
    const { command } = args;
    addCommandToHistory(command);
    return { content: [{ type: 'text', text: `历史指令已保存` }] };
}

export async function handleGetCommandHistory(args: any): Promise<any> {
    const { limit = 10 } = args;
    const limitedHistory = commandHistory.slice(0, limit);
    const historyText = limitedHistory.map((cmd, index) => `${index + 1}. ${cmd.text} `).join('\n');
    return {
        content: [{
            type: 'text',
            text: `历史指令记录：\n\n${historyText || '暂无历史记录'} `
        }]
    };
}

export function setContextSummary(summary: string) {
    contextSummary = summary;
    saveOptimizationData();
}

export async function handleUpdateContextSummary(args: any): Promise<any> {
    const { summary } = args;
    setContextSummary(summary || '');
    return { content: [{ type: 'text', text: `上下文摘要已更新` }] };
}

export async function handleGetContextSummary(args: any): Promise<any> {
    return {
        content: [{
            type: 'text',
            text: `项目上下文摘要：\n\n${contextSummary || '未设置'} `
        }]
    };
}

export async function handleGetPendingCommand(): Promise<any> {
    const command = getPendingCommand();
    
    if (command) {
        return {
            content: [
                {
                    type: 'text',
                    text: `WindsurfAutoMcp中有待处理的指令：\n\n${command}\n\n请执行此指令。`
                }
            ]
        };
    } else {
        return {
            content: [
                {
                    type: 'text', 
                    text: 'WindsurfAutoMcp中暂无待处理的指令。'
                }
            ]
        };
    }
}

export async function handleSetPendingCommand(args: any): Promise<any> {
    const { command } = args;
    
    if (!command) {
        throw new Error('缺少必需的参数: command');
    }
    
    setPendingCommand(command);
    
    return {
        content: [
            {
                type: 'text',
                text: `已设置待处理指令：${command}`
            }
        ]
    };
}

// 保存优化相关数据
export function saveOptimizationData() {
    if (extensionContext) {
        extensionContext.globalState.update('optimizationSettings', optimizationSettings);
        extensionContext.globalState.update('commandHistory', commandHistory);
        extensionContext.globalState.update('contextSummary', contextSummary);
    }
}

// 加载优化相关数据
export function loadOptimizationData(context: vscode.ExtensionContext) {
    const savedOptSettings = context.globalState.get<any>('optimizationSettings');
    if (savedOptSettings) {
        optimizationSettings = { ...optimizationSettings, ...savedOptSettings };
    }

    const savedHistory = context.globalState.get<any[]>('commandHistory');
    if (savedHistory) {
        // 平滑处理：如果是旧的字符串数组，转换为对象数组
        commandHistory = savedHistory.map(item => typeof item === 'string' ? { text: item, timestamp: Date.now() } : item);
    }

    const savedContext = context.globalState.get<string>('contextSummary');
    if (savedContext) {
        contextSummary = savedContext;
    }
}
