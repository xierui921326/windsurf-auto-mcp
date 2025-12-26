const vscode = acquireVsCodeApi();

function startServer() {
    vscode.postMessage({ type: 'startServer' });
}

function stopServer() {
    vscode.postMessage({ type: 'stopServer' });
}

function restartServer() {
    vscode.postMessage({ type: 'restartServer' });
}

function configWindsurf() {
    vscode.postMessage({ type: 'configWindsurf' });
}

function resetDefaults() {
    vscode.postMessage({ type: 'resetDefaults' });
}

function toggleOptimization() {
    vscode.postMessage({ type: 'toggleOptimization' });
}

function updateOptimizationLevel() {
    const level = document.getElementById('optimizationLevel')?.value;
    if (level) {
        vscode.postMessage({ type: 'updateOptimizationLevel', level: level });
    }
}

function viewHistory() {
    vscode.postMessage({ type: 'viewHistory' });
}

function clearHistory() {
    if (confirm('确定要清空所有历史记录吗？')) {
        vscode.postMessage({ type: 'clearHistory' });
    }
}

function showContextSummary() {
    vscode.postMessage({ type: 'showContextSummary' });
}

function createRules() {
    vscode.postMessage({ type: 'createRules' });
}

function openRepo() {
    vscode.postMessage({ type: 'openRepo' });
}

function copyRepoUrl() {
    vscode.postMessage({ type: 'copyRepoUrl' });
}

function openContinueDialog() {
    vscode.postMessage({ type: 'openContinueDialog' });
}

function copyPrompt() {
    vscode.postMessage({ type: 'copyPrompt' });
}
