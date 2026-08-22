// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getProject, project } from './morphUtils';
import { traceVariableOrigin } from './traceVariable';
import { TraceViewProvider, createTraceViewProvider } from './viewPanel';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "react-trace" is now active!');
	const provider = createTraceViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(TraceViewProvider.viewType, provider)
	);

	getProject();

	vscode.workspace.onDidSaveTextDocument(document => {
		const sourceFile = project?.getSourceFile(document.uri.fsPath);
		sourceFile?.refreshFromFileSystemSync();
	});

	const trace = vscode.commands.registerCommand('react-trace.traceVariableOrigin', traceVariableOrigin);
	context.subscriptions.push(trace);
}

// This method is called when your extension is deactivated
export function deactivate() {}
