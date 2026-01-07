import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 文件修改记录接口
interface FileModification {
    id: string;
    filePath: string;
    originalContent: string;
    modifiedContent: string;
    timestamp: number;
    command: string; // 触发修改的用户指令
    backupPath?: string;
}

// 任务记录接口
interface TaskRecord {
    id: string;
    command: string; // 用户原始指令
    timestamp: number;
    modifications: FileModification[];
    status: 'completed' | 'in_progress' | 'failed';
}

export class FileTracker {
    private static instance: FileTracker;
    private taskRecords: TaskRecord[] = [];
    private currentTaskId: string | null = null;
    private context: vscode.ExtensionContext;
    private backupDir: string;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.backupDir = path.join(context.globalStorageUri.fsPath, 'file-backups');
        this.ensureBackupDir();
        this.loadTaskRecords();
    }

    public static getInstance(context?: vscode.ExtensionContext): FileTracker {
        if (!FileTracker.instance && context) {
            FileTracker.instance = new FileTracker(context);
        }
        return FileTracker.instance;
    }

    private ensureBackupDir() {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    // 开始新任务
    public startTask(command: string): string {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const task: TaskRecord = {
            id: taskId,
            command: command,
            timestamp: Date.now(),
            modifications: [],
            status: 'in_progress'
        };

        this.taskRecords.push(task);
        this.currentTaskId = taskId;
        this.saveTaskRecords();

        console.log(`开始新任务: ${taskId} - ${command}`);
        return taskId;
    }

    // 记录文件修改
    public recordFileModification(filePath: string, originalContent: string, modifiedContent: string): string {
        if (!this.currentTaskId) {
            console.warn('没有活跃的任务，无法记录文件修改');
            return '';
        }

        const modificationId = `mod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const backupFileName = `${modificationId}_${path.basename(filePath)}`;
        const backupPath = path.join(this.backupDir, backupFileName);

        // 创建备份文件
        try {
            fs.writeFileSync(backupPath, originalContent, 'utf-8');
        } catch (error) {
            console.error('创建备份文件失败:', error);
        }

        const modification: FileModification = {
            id: modificationId,
            filePath: filePath,
            originalContent: originalContent,
            modifiedContent: modifiedContent,
            timestamp: Date.now(),
            command: this.getCurrentTaskCommand(),
            backupPath: backupPath
        };

        // 添加到当前任务
        const currentTask = this.taskRecords.find(task => task.id === this.currentTaskId);
        if (currentTask) {
            currentTask.modifications.push(modification);
            this.saveTaskRecords();
        }

        console.log(`记录文件修改: ${filePath} (备份: ${backupPath})`);
        return modificationId;
    }

    // 完成当前任务
    public completeCurrentTask() {
        if (!this.currentTaskId) return;

        const currentTask = this.taskRecords.find(task => task.id === this.currentTaskId);
        if (currentTask) {
            currentTask.status = 'completed';
            this.saveTaskRecords();
        }

        console.log(`任务完成: ${this.currentTaskId}`);
        this.currentTaskId = null;
    }

    // 还原单个文件
    public async restoreFile(modificationId: string): Promise<boolean> {
        const modification = this.findModification(modificationId);
        if (!modification) {
            vscode.window.showErrorMessage(`找不到修改记录: ${modificationId}`);
            return false;
        }

        try {
            // 从备份文件还原
            if (modification.backupPath && fs.existsSync(modification.backupPath)) {
                const originalContent = fs.readFileSync(modification.backupPath, 'utf-8');
                fs.writeFileSync(modification.filePath, originalContent, 'utf-8');
            } else {
                // 使用内存中的原始内容
                fs.writeFileSync(modification.filePath, modification.originalContent, 'utf-8');
            }

            vscode.window.showInformationMessage(`文件已还原: ${path.basename(modification.filePath)}`);
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`文件还原失败: ${error}`);
            return false;
        }
    }

    // 还原整个任务的所有文件修改
    public async restoreTask(taskId: string): Promise<boolean> {
        const task = this.taskRecords.find(t => t.id === taskId);
        if (!task) {
            vscode.window.showErrorMessage(`找不到任务记录: ${taskId}`);
            return false;
        }

        const result = await vscode.window.showWarningMessage(
            `确定要还原任务 "${task.command}" 的所有文件修改吗？这将撤销 ${task.modifications.length} 个文件的更改。`,
            { modal: true },
            '确定还原',
            '取消'
        );

        if (result !== '确定还原') return false;

        let successCount = 0;
        for (const modification of task.modifications) {
            try {
                if (modification.backupPath && fs.existsSync(modification.backupPath)) {
                    const originalContent = fs.readFileSync(modification.backupPath, 'utf-8');
                    fs.writeFileSync(modification.filePath, originalContent, 'utf-8');
                } else {
                    fs.writeFileSync(modification.filePath, modification.originalContent, 'utf-8');
                }
                successCount++;
            } catch (error) {
                console.error(`还原文件失败 ${modification.filePath}:`, error);
            }
        }

        vscode.window.showInformationMessage(`任务还原完成: ${successCount}/${task.modifications.length} 个文件已还原`);
        return successCount === task.modifications.length;
    }

    // 获取任务列表
    public getTaskRecords(): TaskRecord[] {
        return [...this.taskRecords].reverse(); // 最新的在前
    }

    // 获取当前任务的修改记录
    public getCurrentTaskModifications(): FileModification[] {
        if (!this.currentTaskId) return [];
        
        const currentTask = this.taskRecords.find(task => task.id === this.currentTaskId);
        return currentTask ? currentTask.modifications : [];
    }

    // 清理旧的备份文件（保留最近30天）
    public cleanupOldBackups() {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        this.taskRecords = this.taskRecords.filter(task => {
            if (task.timestamp < thirtyDaysAgo) {
                // 删除相关的备份文件
                task.modifications.forEach(mod => {
                    if (mod.backupPath && fs.existsSync(mod.backupPath)) {
                        try {
                            fs.unlinkSync(mod.backupPath);
                        } catch (error) {
                            console.error('删除备份文件失败:', error);
                        }
                    }
                });
                return false; // 从记录中移除
            }
            return true; // 保留
        });

        this.saveTaskRecords();
    }

    private findModification(modificationId: string): FileModification | undefined {
        for (const task of this.taskRecords) {
            const modification = task.modifications.find(mod => mod.id === modificationId);
            if (modification) return modification;
        }
        return undefined;
    }

    private getCurrentTaskCommand(): string {
        if (!this.currentTaskId) return '';
        
        const currentTask = this.taskRecords.find(task => task.id === this.currentTaskId);
        return currentTask ? currentTask.command : '';
    }

    private saveTaskRecords() {
        this.context.globalState.update('fileTracker_taskRecords', this.taskRecords);
    }

    private loadTaskRecords() {
        const saved = this.context.globalState.get<TaskRecord[]>('fileTracker_taskRecords', []);
        this.taskRecords = saved;
    }
}

// 导出便捷函数
export function initializeFileTracker(context: vscode.ExtensionContext) {
    return FileTracker.getInstance(context);
}
