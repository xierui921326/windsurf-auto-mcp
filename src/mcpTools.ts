import * as vscode from 'vscode';

// 全局变量
export let optimizationSettings = {
    enabled: true,
    autoOptimize: false,
    optimizationLevel: 'medium' as 'low' | 'medium' | 'high',
    contextLength: 1000,
    includeProjectInfo: true
};

export let commandHistory: Array<{
    id: string;
    command: string;
    timestamp: number;
    optimized?: string;
    context?: string;
    success: boolean;
}> = [];

export let contextSummary = {
    projectName: '',
    projectType: '',
    mainTechnologies: [] as string[],
    currentTask: '',
    lastUpdate: 0
};

let extensionContext: vscode.ExtensionContext;

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
        name: 'ask_continue',
        description: '当完成任务时，必须调用此工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。',
        inputSchema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: '任务完成的原因或说明' }
            },
            required: ['reason']
        }
    },
    {
        name: 'optimize_command',
        description: '优化用户指令，提供更精确和高效的指令建议。',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '原始指令' },
                context: { type: 'string', description: '当前上下文信息' },
                level: { type: 'string', enum: ['low', 'medium', 'high'], description: '优化级别' }
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
    const { command, context, level = 'medium' } = args;
    
    if (!optimizationSettings.enabled) {
        return { content: [{ type: 'text', text: '指令优化功能已禁用' }] };
    }
    
    // 基于优化级别提供不同的优化建议
    let optimizedCommand = command;
    let suggestions = [];
    
    // 简单的优化逻辑示例
    if (level === 'high') {
        // 高级优化：添加详细上下文和具体要求
        if (context && optimizationSettings.includeProjectInfo) {
            optimizedCommand = `${command}\n\n上下文信息：${context}`;
        }
        suggestions.push('添加了详细上下文信息');
        suggestions.push('建议明确指定技术栈和约束条件');
    } else if (level === 'medium') {
        // 中级优化：基本结构化
        if (!command.includes('请') && !command.includes('帮助')) {
            optimizedCommand = `请${command}`;
            suggestions.push('添加了礼貌用词');
        }
    }
    
    // 保存到历史记录
    const historyEntry = {
        id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        command: command,
        timestamp: Date.now(),
        optimized: optimizedCommand,
        context: context || '',
        success: true
    };
    commandHistory.unshift(historyEntry);
    
    // 限制历史记录数量
    if (commandHistory.length > 100) {
        commandHistory = commandHistory.slice(0, 100);
    }
    
    saveOptimizationData();
    
    return {
        content: [{
            type: 'text',
            text: `指令优化完成：\n\n原始指令：${command}\n优化后：${optimizedCommand}\n\n优化建议：${suggestions.join('、')}`
        }]
    };
}

export async function handleSaveCommandHistory(args: any): Promise<any> {
    const { command, optimized, context, success } = args;
    
    const historyEntry = {
        id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        command: command,
        timestamp: Date.now(),
        optimized: optimized || '',
        context: context || '',
        success: success
    };
    
    commandHistory.unshift(historyEntry);
    
    // 限制历史记录数量
    if (commandHistory.length > 100) {
        commandHistory = commandHistory.slice(0, 100);
    }
    
    saveOptimizationData();
    
    return {
        content: [{
            type: 'text',
            text: `指令历史已保存：${command}`
        }]
    };
}

export async function handleGetCommandHistory(args: any): Promise<any> {
    const { limit = 10, filter } = args;
    
    let filteredHistory = commandHistory;
    
    // 应用过滤器
    if (filter) {
        filteredHistory = commandHistory.filter(entry => 
            entry.command.toLowerCase().includes(filter.toLowerCase()) ||
            (entry.optimized && entry.optimized.toLowerCase().includes(filter.toLowerCase()))
        );
    }
    
    // 限制返回数量
    const limitedHistory = filteredHistory.slice(0, limit);
    
    const historyText = limitedHistory.map((entry, index) => {
        const date = new Date(entry.timestamp).toLocaleString('zh-CN');
        const status = entry.success ? '✓' : '✗';
        let text = `${index + 1}. [${status}] ${date}\n   指令：${entry.command}`;
        if (entry.optimized && entry.optimized !== entry.command) {
            text += `\n   优化：${entry.optimized}`;
        }
        if (entry.context) {
            text += `\n   上下文：${entry.context.substring(0, 100)}${entry.context.length > 100 ? '...' : ''}`;
        }
        return text;
    }).join('\n\n');
    
    return {
        content: [{
            type: 'text',
            text: `历史指令记录（共${filteredHistory.length}条，显示${limitedHistory.length}条）：\n\n${historyText || '暂无历史记录'}`
        }]
    };
}

export async function handleUpdateContextSummary(args: any): Promise<any> {
    const { projectName, projectType, technologies, currentTask } = args;
    
    if (projectName) contextSummary.projectName = projectName;
    if (projectType) contextSummary.projectType = projectType;
    if (technologies) contextSummary.mainTechnologies = technologies;
    if (currentTask) contextSummary.currentTask = currentTask;
    
    contextSummary.lastUpdate = Date.now();
    
    saveOptimizationData();
    
    return {
        content: [{
            type: 'text',
            text: `上下文摘要已更新：\n项目：${contextSummary.projectName}\n类型：${contextSummary.projectType}\n技术栈：${contextSummary.mainTechnologies.join(', ')}\n当前任务：${contextSummary.currentTask}`
        }]
    };
}

export async function handleGetContextSummary(args: any): Promise<any> {
    const lastUpdateText = contextSummary.lastUpdate 
        ? new Date(contextSummary.lastUpdate).toLocaleString('zh-CN')
        : '未知';
    
    return {
        content: [{
            type: 'text',
            text: `项目上下文摘要：\n\n项目名称：${contextSummary.projectName || '未设置'}\n项目类型：${contextSummary.projectType || '未设置'}\n主要技术：${contextSummary.mainTechnologies.join(', ') || '未设置'}\n当前任务：${contextSummary.currentTask || '未设置'}\n最后更新：${lastUpdateText}`
        }]
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
    const savedOptSettings = context.globalState.get<typeof optimizationSettings>('optimizationSettings');
    if (savedOptSettings) {
        optimizationSettings = { ...optimizationSettings, ...savedOptSettings };
    }
    
    const savedHistory = context.globalState.get<typeof commandHistory>('commandHistory');
    if (savedHistory) {
        commandHistory = savedHistory;
    }
    
    const savedContext = context.globalState.get<typeof contextSummary>('contextSummary');
    if (savedContext) {
        contextSummary = { ...contextSummary, ...savedContext };
    }
}
