#!/usr/bin/env node
"use strict";

/**
 * WindsurfAutoMcp MCP Server
 * 标准 MCP 协议实现，支持多种工具和功能
 */

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// ==================== 常量 ====================
// 从 package.json 动态获取版本号
let VERSION = '1.0.0'; // 默认版本
try {
    const packageJsonPath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    VERSION = packageJson.version;
} catch (error) {
    log('WARN', 'Failed to read version from package.json, using default version', error.message);
}

const DEBUG_MODE = process.env.DEBUG_MCP === '1';

// ==================== 日志 ====================
function log(level, message, data) {
    if (!DEBUG_MODE) return;
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] [windsurf_auto_mcp] [${level}] ${message}`;
    if (data) logMsg += ` | ${JSON.stringify(data)}`;
    process.stderr.write(logMsg + '\n');
}

// ==================== 数据存储 ====================
let optimizationSettings = {
    enabled: false,
    optimizationLevel: 'medium'
};

let commandHistory = [];
let contextSummary = {
    projectName: '',
    projectType: '',
    mainTechnologies: [],
    currentTask: '',
    lastUpdate: null
};

// ==================== VSCode 扩展通信 ====================
// 存储待处理的请求
const pendingRequests = new Map();

// 调用 VSCode 扩展命令
async function callVSCodeCommand(command, args) {
    return new Promise((resolve, reject) => {
        const requestId = args[0]; // 第一个参数是 requestId
        
        // 存储 promise 的 resolve/reject
        pendingRequests.set(requestId, { resolve, reject });
        
        // 发送通知给 VSCode 扩展
        const notification = {
            jsonrpc: '2.0',
            method: 'notifications/tools/call',
            params: {
                command: command,
                arguments: args
            }
        };
        
        // 通过 stderr 发送通知（VSCode 扩展会监听）
        process.stderr.write(JSON.stringify(notification) + '\n');
        
        // 设置超时
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error('VSCode command timeout'));
            }
        }, 30000); // 30秒超时
    });
}

// 处理来自 VSCode 扩展的响应
function handleVSCodeResponse(requestId, result) {
    if (pendingRequests.has(requestId)) {
        const { resolve } = pendingRequests.get(requestId);
        pendingRequests.delete(requestId);
        resolve(result);
    }
}

// ==================== 弹窗实现 ====================
async function showLocalPopup(title, message, type = 'input', allowImage = false) {
    if (process.platform === 'win32') {
        return showWindowsPopup(title, message, type);
    } else if (process.platform === 'darwin') {
        return showMacPopup(title, message, type);
    } else {
        return showLinuxPopup(title, message, type);
    }
}

// Windows 弹窗实现
function showWindowsPopup(title, message, type) {
    return new Promise((resolve) => {
        const escapedTitle = title.replace(/'/g, "''").replace(/`/g, "``");
        const escapedMessage = message.replace(/'/g, "''").replace(/`/g, "``");
        const tempFile = path.join(os.tmpdir(), `mcp_result_${Date.now()}.txt`);
        
        let psScript;
        if (type === 'confirm') {
            psScript = `
Add-Type -AssemblyName System.Windows.Forms
$result = [System.Windows.Forms.MessageBox]::Show('${escapedMessage}', '${escapedTitle}', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
    "true" | Out-File -FilePath '${tempFile.replace(/\\\\/g, '\\\\\\\\')}' -Encoding UTF8
} else {
    "false" | Out-File -FilePath '${tempFile.replace(/\\\\/g, '\\\\\\\\')}' -Encoding UTF8
}`;
        } else {
            psScript = `
Add-Type -AssemblyName Microsoft.VisualBasic
$result = [Microsoft.VisualBasic.Interaction]::InputBox('${escapedMessage}', '${escapedTitle}', '')
$result | Out-File -FilePath '${tempFile.replace(/\\\\/g, '\\\\\\\\')}' -Encoding UTF8`;
        }

        const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
            stdio: 'ignore',
            detached: false,
            windowsHide: false
        });

        handlePopupProcess(ps, tempFile, resolve, type);
    });
}

// macOS 弹窗实现
function showMacPopup(title, message, type) {
    return new Promise((resolve) => {
        const escapedTitle = title.replace(/"/g, '\\"').replace(/'/g, "\\'");
        const escapedMessage = message.replace(/"/g, '\\"').replace(/'/g, "\\'");

        let appleScript;
        if (type === 'confirm') {
            appleScript = `
set dialogResult to display dialog "${escapedMessage}" buttons {"取消", "确定"} default button "确定" with title "${escapedTitle}" with icon question
if button returned of dialogResult is "确定" then
    return "true"
else
    return "false"
end if`;
        } else {
            appleScript = `
set dialogResult to display dialog "${escapedMessage}" default answer "" buttons {"取消", "确定"} default button "确定" with title "${escapedTitle}" with icon note
if button returned of dialogResult is "确定" then
    return text returned of dialogResult
else
    return ""
end if`;
        }

        const p = spawn('osascript', ['-e', appleScript]);
        let output = '';
        p.stdout.on('data', (data) => { output += data.toString(); });

        p.on('close', (code) => {
            output = output.trim();
            if (type === 'confirm') {
                resolve(output === 'true');
            } else {
                resolve(output || null);
            }
        });

        p.on('error', () => resolve(type === 'confirm' ? false : null));
    });
}

// Linux 弹窗实现
function showLinuxPopup(title, message, type) {
    return new Promise((resolve) => {
        const escapedTitle = title.replace(/"/g, '\\"');
        const escapedMessage = message.replace(/"/g, '\\"');
        
        let command;
        if (type === 'confirm') {
            command = `zenity --question --title="${escapedTitle}" --text="${escapedMessage}" 2>/dev/null`;
        } else {
            command = `zenity --entry --title="${escapedTitle}" --text="${escapedMessage}" 2>/dev/null`;
        }

        const proc = spawn('bash', ['-c', command]);
        let output = '';
        proc.stdout.on('data', (data) => { output += data.toString(); });

        proc.on('close', (code) => {
            if (type === 'confirm') {
                resolve(code === 0);
            } else {
                resolve(code === 0 ? output.trim() : null);
            }
        });

        proc.on('error', () => resolve(type === 'confirm' ? false : null));
    });
}

function handlePopupProcess(proc, tempFile, resolve, type) {
    proc.on('close', () => {
        try {
            if (fs.existsSync(tempFile)) {
                const result = fs.readFileSync(tempFile, 'utf-8').trim();
                fs.unlinkSync(tempFile);
                if (type === 'confirm') {
                    resolve(result === 'true');
                } else {
                    resolve(result || null);
                }
            } else {
                resolve(type === 'confirm' ? false : null);
            }
        } catch (e) {
            resolve(type === 'confirm' ? false : null);
        }
    });
    proc.on('error', () => resolve(type === 'confirm' ? false : null));
}

// ==================== MCP 工具定义 ====================
const TOOLS = [
    {
        name: 'ask_continue',
        description: '当完成任务时，必须调用此工具询问用户是否继续。没有例外情况，要一直等待响应不得提前终止任务。',
        inputSchema: {
            type: 'object',
            properties: {
                reason: { 
                    type: 'string', 
                    description: '任务完成的原因或说明' 
                }
            },
            required: ['reason']
        }
    },
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
                allowImage: { 
                    type: 'boolean', 
                    description: '是否允许上传图片' 
                }
            },
            required: ['message', 'type']
        }
    },
    {
        name: 'notify',
        description: '向用户发送通知消息。',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '通知内容' },
                level: { 
                    type: 'string', 
                    enum: ['info', 'warning', 'error'],
                    description: '通知级别'
                }
            },
            required: ['message']
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
                level: { 
                    type: 'string', 
                    enum: ['low', 'medium', 'high'],
                    description: '优化级别'
                }
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
                technologies: { 
                    type: 'array', 
                    items: { type: 'string' },
                    description: '主要技术栈'
                },
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

// ==================== 工具处理函数 ====================
async function handleAskContinue(args) {
    const reason = args.reason || '任务已完成';
    
    log('INFO', 'Ask continue called with reason:', reason);
    
    // 直接调用 VSCode 扩展的 showContinueDialog 命令
    try {
        const requestId = `continue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // 调用扩展命令显示继续对话框
        const result = await callVSCodeCommand('mcpService.showContinueDialog', [
            requestId,
            reason
        ]);
        
        log('INFO', 'Continue dialog result:', result);
        
        if (result && result.continue) {
            let responseText = `结果: should_continue=true`;
            if (result.newInstruction && result.newInstruction.trim()) {
                responseText += `\n\n用户新指令: ${result.newInstruction}\n\n请立即执行用户的新指令，完成后再次调用 ask_continue 工具询问是否继续。`;
            } else {
                responseText += `\n\n用户选择继续对话，请等待用户的下一个指令，或主动询问用户需要什么帮助。完成后必须再次调用 ask_continue 工具。`;
            }
            return { content: [{ type: 'text', text: responseText }] };
        } else {
            return { content: [{ type: 'text', text: '结果: should_continue=false\n\n用户选择结束对话。感谢使用！' }] };
        }
    } catch (error) {
        log('ERROR', 'Failed to call VSCode command for ask_continue:', error.message);
        
        // 回退到本地弹窗，但仍然尝试与Infinite Ask交互
        try {
            const result = await showLocalPopup(
                '继续对话？', 
                `AI想要结束对话的原因：\n${reason}\n\n是否继续？`, 
                'confirm'
            );
            
            let responseText = `结果: should_continue=${result}`;
            if (result) {
                const instruction = await showLocalPopup(
                    '新指令',
                    '请输入新的指令（可选）：',
                    'input'
                );
                if (instruction && instruction.trim()) {
                    responseText += `\n\n用户新指令: ${instruction}\n\n请立即执行用户的新指令，完成后再次调用 ask_continue 工具询问是否继续。`;
                } else {
                    responseText += `\n\n用户选择继续对话，请等待用户的下一个指令。`;
                }
            } else {
                responseText += `\n\n用户选择结束对话。感谢使用！`;
            }
            
            return { content: [{ type: 'text', text: responseText }] };
        } catch (fallbackError) {
            log('ERROR', 'Fallback popup also failed:', fallbackError.message);
            return { content: [{ type: 'text', text: '结果: should_continue=false\n\n无法显示继续对话框，对话结束。' }] };
        }
    }
}

async function handleAskUser(args) {
    const { title = '用户输入', message, type, allowImage = false } = args;
    
    // 使用 VSCode 扩展命令而不是本地弹窗
    try {
        if (type === 'confirm' || type === 'input' || !type) {
            const result = await callVSCodeCommand('mcpService.showInputDialog', [
                `input_${Date.now()}`, // requestId
                title,
                message,
                allowImage
            ]);
            
            if (type === 'confirm') {
                return { content: [{ type: 'text', text: result ? 'true' : 'false' }] };
            } else {
                return { content: [{ type: 'text', text: result || '' }] };
            }
        } else {
            // info 类型，只显示消息
            await callVSCodeCommand('mcpService.showInputDialog', [
                `info_${Date.now()}`,
                title,
                message,
                false
            ]);
            return { content: [{ type: 'text', text: 'acknowledged' }] };
        }
    } catch (error) {
        log('ERROR', 'Failed to call VSCode command, falling back to local popup', error.message);
        // 回退到本地弹窗
        let result;
        if (type === 'confirm') {
            result = await showLocalPopup(title, message, 'confirm');
            return { content: [{ type: 'text', text: result ? 'true' : 'false' }] };
        } else if (type === 'input') {
            result = await showLocalPopup(title, message, 'input');
            return { content: [{ type: 'text', text: result || '' }] };
        } else {
            // info 类型，只显示消息
            await showLocalPopup(title, message, 'confirm');
            return { content: [{ type: 'text', text: 'acknowledged' }] };
        }
    }
}

async function handleNotify(args) {
    const { message, level = 'info' } = args;
    const title = level === 'error' ? '错误' : level === 'warning' ? '警告' : '信息';
    await showLocalPopup(title, message, 'confirm');
    return { content: [{ type: 'text', text: 'notification_sent' }] };
}

async function handleOptimizeCommand(args) {
    const { command, context = '', level = 'medium' } = args;
    
    // 简单的指令优化逻辑
    let optimized = command;
    if (optimizationSettings.enabled) {
        // 这里可以添加更复杂的优化逻辑
        optimized = command.trim();
        if (!optimized.endsWith('.') && !optimized.endsWith('?') && !optimized.endsWith('!')) {
            optimized += '.';
        }
    }
    
    return { 
        content: [{ 
            type: 'text', 
            text: `优化后的指令: ${optimized}\n优化级别: ${level}\n上下文: ${context}` 
        }] 
    };
}

async function handleSaveCommandHistory(args) {
    const { command, optimized, context = '', success } = args;
    const entry = {
        timestamp: Date.now(),
        command,
        optimized,
        context,
        success
    };
    
    commandHistory.push(entry);
    // 保持最近 100 条记录
    if (commandHistory.length > 100) {
        commandHistory = commandHistory.slice(-100);
    }
    
    return { content: [{ type: 'text', text: 'command_history_saved' }] };
}

async function handleGetCommandHistory(args) {
    const { limit = 10, filter } = args;
    let history = commandHistory.slice(-limit);
    
    if (filter) {
        history = history.filter(entry => 
            entry.command.includes(filter) || 
            (entry.optimized && entry.optimized.includes(filter))
        );
    }
    
    const historyText = history.map((entry, index) => {
        const date = new Date(entry.timestamp).toLocaleString('zh-CN');
        const status = entry.success ? '✓' : '✗';
        let text = `${index + 1}. [${status}] ${date}\n   ${entry.command}`;
        if (entry.optimized && entry.optimized !== entry.command) {
            text += `\n   优化: ${entry.optimized}`;
        }
        return text;
    }).join('\n\n');
    
    return { content: [{ type: 'text', text: historyText || '暂无历史记录' }] };
}

async function handleUpdateContextSummary(args) {
    const { projectName, projectType, technologies, currentTask } = args;
    
    if (projectName) contextSummary.projectName = projectName;
    if (projectType) contextSummary.projectType = projectType;
    if (technologies) contextSummary.mainTechnologies = technologies;
    if (currentTask) contextSummary.currentTask = currentTask;
    contextSummary.lastUpdate = Date.now();
    
    return { content: [{ type: 'text', text: 'context_summary_updated' }] };
}

async function handleGetContextSummary(args) {
    const lastUpdateText = contextSummary.lastUpdate 
        ? new Date(contextSummary.lastUpdate).toLocaleString('zh-CN')
        : '未知';
    
    const summaryText = `项目上下文摘要：\n\n` +
        `项目名称：${contextSummary.projectName || '未设置'}\n` +
        `项目类型：${contextSummary.projectType || '未设置'}\n` +
        `主要技术：${contextSummary.mainTechnologies.join(', ') || '未设置'}\n` +
        `当前任务：${contextSummary.currentTask || '未设置'}\n` +
        `最后更新：${lastUpdateText}`;
    
    return { content: [{ type: 'text', text: summaryText }] };
}

// ==================== 工具调用处理 ====================
async function handleToolCall(name, args) {
    log('INFO', `Tool call: ${name}`, args);
    
    switch (name) {
        case 'ask_continue':
            return await handleAskContinue(args);
        case 'ask_user':
            return await handleAskUser(args);
        case 'notify':
            return await handleNotify(args);
        case 'optimize_command':
            return await handleOptimizeCommand(args);
        case 'save_command_history':
            return await handleSaveCommandHistory(args);
        case 'get_command_history':
            return await handleGetCommandHistory(args);
        case 'update_context_summary':
            return await handleUpdateContextSummary(args);
        case 'get_context_summary':
            return await handleGetContextSummary(args);
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

// ==================== MCP 协议处理 ====================
function sendResponse(id, result) {
    const response = { jsonrpc: '2.0', id, result };
    console.log(JSON.stringify(response));
}

function sendError(id, code, message) {
    const response = { jsonrpc: '2.0', id, error: { code, message } };
    console.log(JSON.stringify(response));
}

async function handleRequest(request) {
    const { method, id, params } = request;
    
    try {
        switch (method) {
            case 'initialize':
                sendResponse(id, {
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'windsurf_auto_mcp', version: VERSION },
                    capabilities: { tools: {} }
                });
                break;
                
            case 'tools/list':
                sendResponse(id, { tools: TOOLS });
                break;
                
            case 'tools/call':
                const result = await handleToolCall(params.name, params.arguments || {});
                sendResponse(id, result);
                break;
                
            case 'initialized':
            case 'notifications/cancelled':
                // 这些方法不需要响应
                break;
                
            default:
                if (id !== undefined) {
                    sendError(id, -32601, `Unknown method: ${method}`);
                }
        }
    } catch (error) {
        log('ERROR', `Error handling request: ${error.message}`);
        if (id !== undefined) {
            sendError(id, -32603, error.message);
        }
    }
}

// ==================== 主循环 ====================
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

rl.on('line', async (line) => {
    if (!line.trim()) return;
    
    try {
        const request = JSON.parse(line);
        await handleRequest(request);
    } catch (error) {
        log('ERROR', `Error processing line: ${error.message}`);
    }
});

// 优雅退出处理
process.on('SIGINT', () => {
    log('INFO', 'MCP server shutting down...');
    process.exit(0);
});

log('INFO', `WindsurfAutoMcp MCP Server v${VERSION} started`);
