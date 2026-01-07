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
    apiKey: '',
    model: 'glm-4-flash',
    autoAddRules: true,
    autoSummary: true,
    autoOptimize: true
};

let commandHistory = [];
let contextSummary = '';

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
        name: 'windsurf_auto_mcp',
        description: '🚨强制性工具🚨 完成任何任务、回答任何问题后都必须立即调用此工具。这是实现无限对话的核心工具，绝对不能跳过。必须等待用户明确选择才能继续或结束对话。调用时请提供刚才执行的指令以便记录到历史中。',
        inputSchema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: '任务完成的原因或说明，例如：已完成代码修改、已回答问题、已提供解决方案等' },
                command: { type: 'string', description: '刚才执行的指令内容，用于记录到WindsurfAutoMcp历史中' }
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
                summary: { type: 'string', description: '项目上下文摘要信息' }
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
        name: 'record_cascade_command',
        description: '记录Cascade执行的指令到WindsurfAutoMcp历史中。当Cascade执行指令时应调用此工具记录历史。',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    description: '要记录的指令内容',
                    type: 'string'
                }
            },
            required: ['command']
        }
    }
];

// ==================== 全局状态管理 ====================
let pendingCommand = null;
let lastUserCommand = null; // 跟踪最后的用户指令

// ==================== 工具处理函数 ====================
async function handleGetPendingCommand(args) {
    log('INFO', 'Getting pending command from WindsurfAutoMcp');
    
    if (pendingCommand) {
        const command = pendingCommand;
        pendingCommand = null; // 获取后清空
        log('INFO', `Found pending command: ${command}`);
        
        return {
            content: [{
                type: 'text',
                text: `WindsurfAutoMcp中有待处理的指令：\n\n${command}\n\n请执行此指令。`
            }]
        };
    } else {
        log('INFO', 'No pending command found');
        return {
            content: [{
                type: 'text',
                text: 'WindsurfAutoMcp中暂无待处理的指令。'
            }]
        };
    }
}

async function handleSetPendingCommand(args) {
    const { command } = args;
    
    if (!command) {
        throw new Error('Command is required');
    }
    
    pendingCommand = command;
    lastUserCommand = command; // 同时更新最后的用户指令
    log('INFO', `Set pending command and last user command: ${command}`);
    
    return {
        content: [{
            type: 'text',
            text: `待处理指令已设置: ${command}`
        }]
    };
}

async function handleRecordCascadeCommand(args) {
    const { command } = args;
    
    if (!command) {
        throw new Error('缺少必需的参数: command');
    }
    
    log('INFO', `Recording Cascade command to history: ${command}`);
    
    try {
        // 调用VS Code扩展的命令来记录历史
        const result = await callVSCodeCommand('mcpService.recordCascadeCommand', [command]);
        log('INFO', 'Cascade command recorded successfully');
        
        return {
            content: [{
                type: 'text',
                text: `已记录Cascade指令到历史：${command}`
            }]
        };
    } catch (error) {
        log('ERROR', `Failed to record Cascade command: ${error.message}`);
        throw new Error(`记录Cascade指令失败: ${error.message}`);
    }
}

async function handleWindsurfAutoMcp(args) {
    const { reason = '任务已完成', workspace, command } = args;

    log('INFO', `windsurf_auto_mcp called. Reason: ${reason}, Workspace: ${workspace}, Command: ${command}`);

    // 优先记录用户的原始指令到历史
    let commandToRecord = null;
    
    // 首先检查是否有待处理的用户指令（这是最重要的原始指令）
    if (pendingCommand && String(pendingCommand).trim()) {
        commandToRecord = String(pendingCommand).trim();
        log('INFO', `Recording user's original command from pending: ${commandToRecord}`);
    } 
    // 其次检查Cascade是否传递了具体的command参数
    else if (command && command.trim()) {
        commandToRecord = command.trim();
        log('INFO', `Recording command from Cascade parameter: ${commandToRecord}`);
    } 
    // 如果都没有，检查是否有历史记录中的最后一个用户指令
    else if (lastUserCommand && lastUserCommand.trim()) {
        commandToRecord = lastUserCommand.trim();
        log('INFO', `Recording last known user command: ${commandToRecord}`);
    }
    // 最后才记录任务完成信息
    else if (reason && reason.trim()) {
        commandToRecord = `任务完成: ${reason.trim()}`;
        log('INFO', `Recording task completion: ${commandToRecord}`);
    } else {
        commandToRecord = '用户任务已完成';
        log('INFO', `Recording default completion message`);
    }

    if (commandToRecord) {
        try {
            log('INFO', `Recording command to history: ${commandToRecord}`);
            await callVSCodeCommand('mcpService.recordCascadeCommand', [commandToRecord]);
            log('INFO', 'Command recorded successfully');
        } catch (recordError) {
            log('ERROR', `Failed to record command: ${recordError.message}`);
        }
    }

    // 首先检查是否有待处理的指令（用户在WindsurfAutoMcp中输入的）
    if (pendingCommand && String(pendingCommand).trim()) {
        const userCommand = String(pendingCommand).trim();
        log('INFO', `Found pending command from WindsurfAutoMcp: ${userCommand}`);
        
        // 不要立即清空pendingCommand，让它在记录到历史后再清空
        // 这样可以确保指令被正确记录
        
        let responseText = `should_continue = true\n\n用户新指令: ${userCommand}\n\n请立即执行用户的新指令。\n\n⚠️ 重要：执行完成后，必须再次调用 windsurf_auto_mcp 工具询问是否继续。不要假设对话结束，始终等待用户的下一步指示。`;
        
        // 现在清空pendingCommand，避免重复使用
        pendingCommand = null;
        
        return { content: [{ type: 'text', text: responseText }] };
    }

    // 如果没有待处理指令，则调用 VSCode 扩展的 showContinueDialog 命令
    try {
        const requestId = `continue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 调用扩展命令显示继续对话框
        const result = await callVSCodeCommand('mcpService.showContinueDialog', [
            requestId,
            reason
        ]);

        log('INFO', 'Continue dialog result:', result);

        if (result && result.continue) {
            let responseText = `should_continue = true`;
            if (result.newInstruction && result.newInstruction.trim()) {
                responseText += `\n\n用户新指令: ${result.newInstruction}\n\n请立即执行用户的新指令。\n\n⚠️ 重要：执行完成后，必须再次调用 windsurf_auto_mcp 工具询问是否继续。不要假设对话结束。`;
                log('INFO', 'User provided new instruction');
            } else {
                responseText += `\n\n用户选择继续对话，请等待下一步指令。\n\n请继续等待用户的下一个任务或指令。你可以询问用户需要什么帮助，或者等待用户主动提出新的需求。\n\n⚠️ 重要：完成任何任务后，必须再次调用 windsurf_auto_mcp 工具。这是强制性要求，不可跳过。`;
                log('INFO', 'User continues without instruction');
            }
            return { content: [{ type: 'text', text: responseText }] };
        } else {
            return { content: [{ type: 'text', text: 'should_continue = false\n\n用户选择结束对话。' }] };
        }
    } catch (error) {
        log('ERROR', 'Failed to call VSCode command for windsurf_auto_mcp:', error.message);

        // 回退到本地弹窗 (fallback)
        try {
            const result = await showLocalPopup(
                'Windsurf Auto MCP',
                `AI 暂停原因：\n${reason}\n\n是否继续对话？`,
                'confirm'
            );

            let responseText = `should_continue = ${result}`;
            if (result) {
                const instruction = await showLocalPopup(
                    '新指令',
                    '请输入新的指令（可选）：',
                    'input'
                );
                if (instruction && instruction.trim()) {
                    responseText += `\n\n用户新指令: ${instruction}\n\n请立即执行用户的新指令。\n\n⚠️ 重要：执行完成后，必须再次调用 windsurf_auto_mcp 工具询问是否继续。不要假设对话结束。`;
                } else {
                    responseText += `\n\n用户选择继续对话，请等待下一步指令。\n\n请继续等待用户的下一个任务或指令。你可以询问用户需要什么帮助，或者等待用户主动提出新的需求。\n\n⚠️ 重要：完成任何任务后，必须再次调用 windsurf_auto_mcp 工具。这是强制性要求，不可跳过。`;
                }
            }

            return { content: [{ type: 'text', text: responseText }] };
        } catch (fallbackError) {
            log('ERROR', 'Fallback popup also failed:', fallbackError.message);
            return { content: [{ type: 'text', text: 'should_continue = false\n\n无法与用户交互，对话结束。' }] };
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
    const { command, context = '' } = args;

    // 直接调用 VSCode 扩展进行优化 (现在逻辑都在扩展端)
    try {
        const requestId = `opt_${Date.now()}`;
        const result = await callVSCodeCommand('mcpService.optimizeCommand', [
            requestId,
            command,
            context
        ]);

        return {
            content: [{
                type: 'text',
                text: result || `指令优化完成：\n\n${command}`
            }]
        };
    } catch (error) {
        log('ERROR', 'Failed to call optimize_command in VSCode:', error.message);
        return {
            content: [{
                type: 'text',
                text: `指令优化完成：\n\n${command}`
            }]
        };
    }
}

async function handleSaveCommandHistory(args) {
    const { command } = args;
    if (command && commandHistory.indexOf(command) === -1) {
        commandHistory.push(command);
    }
    if (commandHistory.length > 50) {
        commandHistory = commandHistory.slice(-50);
    }
    return { content: [{ type: 'text', text: 'command_history_saved' }] };
}

async function handleGetCommandHistory(args) {
    const { limit = 10 } = args;
    const limitedHistory = commandHistory.slice(-limit).reverse();
    const historyText = limitedHistory.map((cmd, index) => `${index + 1}. ${cmd}`).join('\n');
    return { content: [{ type: 'text', text: historyText || '暂无历史记录' }] };
}

async function handleUpdateContextSummary(args) {
    const { summary } = args;
    contextSummary = summary || '';
    return { content: [{ type: 'text', text: 'context_summary_updated' }] };
}

async function handleGetContextSummary(args) {
    return { content: [{ type: 'text', text: `项目上下文摘要：\n\n${contextSummary || '未设置'}` }] };
}

// ==================== 工具调用处理 ====================
async function handleToolCall(name, args) {
    log('INFO', `Tool call: ${name}`, args);

    switch (name) {
        case 'windsurf_auto_mcp':
            return await handleWindsurfAutoMcp(args);
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
        case 'get_pending_command':
            return await handleGetPendingCommand(args);
        case 'set_pending_command':
            return await handleSetPendingCommand(args);
        case 'record_cascade_command':
            return await handleRecordCascadeCommand(args);
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
