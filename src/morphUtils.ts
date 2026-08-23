import * as vscode from 'vscode';
import * as fs from "fs";
import * as path from 'path';
import { Project } from "ts-morph";

export let project: Project | undefined;

export function getProject() {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) return;

  const tsconfig = findTsConfig(workspace.uri.fsPath);
  console.log(tsconfig);

  project = new Project({tsConfigFilePath: tsconfig});
}

function findTsConfig(dir: string): string | undefined {
    const queue = [dir];

    while (queue.length > 0) {
        const currentDir = queue.shift()!;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name === "tsconfig.json" && entry.isFile()) {
                return path.join(currentDir, entry.name);
            }
        }

        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) {
                continue;
            }

            if (entry.isDirectory()) {
                queue.push(path.join(currentDir, entry.name));
            }
        }
    }
}

export function getFreshSourceFile(document: vscode.TextDocument) {
    if (!project) return undefined;

    const filePath = document.uri.fsPath;
    let sourceFile =
        project.getSourceFile(filePath) ??
        project.addSourceFileAtPathIfExists(filePath);

    if (!sourceFile) return undefined;

    const currentText = document.getText();

    if (sourceFile.getFullText() !== currentText) {
        sourceFile.replaceWithText(currentText);
    }

    return sourceFile;
}