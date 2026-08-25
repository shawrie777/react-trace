import * as vscode from 'vscode';
import { getProject, project } from './morphUtils';
import { traceVariableOrigin } from './traceVariable';
import { TraceViewProvider, createTraceViewProvider } from './viewPanel';

export function activate(context: vscode.ExtensionContext) {
	const provider = createTraceViewProvider();
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

export function deactivate() {}
