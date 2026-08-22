import * as vscode from 'vscode';
import { Node, SyntaxKind, Identifier, CallExpression, ParameterDeclaration } from "ts-morph";
import { GraphNode } from './traceTypes';
import { traceView } from './viewPanel';
import { project, getFreshSourceFile } from './morphUtils';

export async function traceVariableOrigin(){
    if (!project) {
      vscode.window.showErrorMessage("traceVariable: no project found.");
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("traceVariable: no editor found.");
      return;
    };

    const position = editor.selection.active;
    const offset = editor.document.offsetAt(position);
    const sourceFile = getFreshSourceFile(editor.document);
    if (!sourceFile) {
      vscode.window.showErrorMessage("traceVariable: no source file found.");
      return;
    }
    const node = sourceFile.getDescendantAtPos(offset);
    if (!node || !Node.isIdentifier(node)) {
      vscode.window.showErrorMessage("traceVariable: no node found.");
      return;
    };

    const symbol = node.getSymbol();
    if (!symbol) return;

    const declarations = symbol.getDeclarations();
    if (declarations.length === 0) return;

    const isUserDefined = declarations.some((declaration) => {
        const declarationSource = declaration.getSourceFile();

        return (
            !declarationSource.isFromExternalLibrary() &&
            !declarationSource.isInNodeModules() &&
            !declarationSource.isDeclarationFile()
        );
    });

    if (!isUserDefined) {
        vscode.window.showErrorMessage("traceVariable: not a user defined symbol.");
        return;
    }

    const tree = await trace(node);
    if (tree) await traceView?.render(tree);
}

async function trace(node: Node | undefined, path = new Set<string>()) : Promise<GraphNode | undefined> {
    if (!node) return undefined;
    const sourceFile = node.getSourceFile();

    const id = `${sourceFile.getFilePath()}:${node.getStart()}`;
    
    const start = node.getStart();
    const { line } = sourceFile.getLineAndColumnAtPos(start);
    const lines = sourceFile.getFullText().split(/\r?\n/);

    const definitions = findDefinitions(node);

    return {
      id,
      file: sourceFile.getFilePath(),
      line,
      preview: lines[line - 1]?.trim() ?? "",
      containingFunc: getContainingFunctionName(node),
      children: path.has(id) ? [] : (await Promise.all(
        definitions.map(n => trace(n, new Set(path).add(id))))).filter(t => !!t),
    };
}

function getContainingFunctionName(node: Node): string {
    const func = node.getFirstAncestor(ancestor =>
        Node.isFunctionDeclaration(ancestor) ||
        Node.isMethodDeclaration(ancestor) ||
        Node.isFunctionExpression(ancestor) ||
        Node.isArrowFunction(ancestor) ||
        Node.isConstructorDeclaration(ancestor)
    );

    if (!func) return "";

    if (Node.isFunctionDeclaration(func) || Node.isMethodDeclaration(func)) {
        return func.getName() ?? "";
    }

    if (Node.isConstructorDeclaration(func)) {
        return "constructor";
    }

    if (Node.isFunctionExpression(func) || Node.isArrowFunction(func)) {
        const parent = func.getParent();

        if (Node.isVariableDeclaration(parent)) {
            return parent.getName();
        }

        if (Node.isPropertyAssignment(parent)) {
            return parent.getName();
        }

        if (Node.isCallExpression(parent)) {
            return "<callback>";
        }
    }

    return "<anonymous>";
}

function findDefinitions(node: Node) : Node[] {
    if (isTerminalValue(node)) return [];
    if (Node.isIdentifier(node)) return findIdentifierDefinitions(node);
    if (Node.isCallExpression(node)) return findCallReturnValues(node);
    if (Node.isReturnStatement(node)) return findReturnedValueSources(node);
    if (Node.isParameterDeclaration(node)) return findParameterArguments(node);
    return findExpressionDependencies(node);
}

function findIdentifierDefinitions(node: Identifier): Node[] {
    return node
        .findReferencesAsNodes()
        .filter(ref => isRelevantEarlierReference(ref, node))
        .flatMap(getDefinitionValueFromReference)
        .filter((value): value is Node => !!value);
}

function getDefinitionValueFromReference(ref: Node): Node | undefined {
    const parent = ref.getParent();

    if (Node.isVariableDeclaration(parent) && parent.getNameNode() === ref) {
        return parent.getInitializer();
    }

    if (
        Node.isBinaryExpression(parent) &&
        parent.getLeft() === ref &&
        parent.getOperatorToken().getText() === "="
    ) {
        return parent.getRight();
    }

    if (Node.isParameterDeclaration(parent) && parent.getNameNode() === ref) {
        return parent; // terminal for now, call-site tracing later
    }

  return undefined;
}

function isRelevantEarlierReference(ref: Node, target: Node): boolean {
    return (
        ref.getSourceFile() === target.getSourceFile() &&
        ref.getStart() < target.getStart()
    );
}

function findExpressionDependencies(node: Node): Node[] {
    if (Node.isBinaryExpression(node)) {
        return [node.getLeft(), node.getRight()];
    }

    if (Node.isParenthesizedExpression(node)) {
        return [node.getExpression()];
    }

    if (Node.isIdentifier(node)) {
        return [node];
    }

    if (
        Node.isNumericLiteral(node) ||
        Node.isStringLiteral(node) ||
        node.getText() === "true" ||
        node.getText() === "false" ||
        node.getText() === "null" ||
        node.getText() === "undefined"
    ) {
        return [];
    }

    return [];
}

function findReturnedValueSources(node: Node): Node[] {
    if (!Node.isReturnStatement(node)) return [];

    const expression = node.getExpression();
    if (!expression) return [];

    return findExpressionSources(expression);
}

function findExpressionSources(node: Node): Node[] {
    if (isTerminalValue(node)) return [];

    if (Node.isIdentifier(node)) {
        return findIdentifierDefinitions(node);
    }

    if (Node.isCallExpression(node)) {
        return [node];
    }

    if (Node.isBinaryExpression(node)) {
        return [
            ...findExpressionSources(node.getLeft()),
            ...findExpressionSources(node.getRight()),
        ];
    }

    if (Node.isParenthesizedExpression(node)) {
        return findExpressionSources(node.getExpression());
    }

    return [];
}

function isTerminalValue(node: Node): boolean {
    return (
        Node.isNumericLiteral(node) ||
        Node.isStringLiteral(node) ||
        Node.isNoSubstitutionTemplateLiteral(node) ||
        node.isKind(SyntaxKind.TrueKeyword) ||
        node.isKind(SyntaxKind.FalseKeyword) ||
        node.isKind(SyntaxKind.NullKeyword) ||
        node.isKind(SyntaxKind.UndefinedKeyword)
    );
}

function findCallReturnValues(call: CallExpression): Node[] {
    const callee = call.getExpression();
    const declarations = callee.getSymbol()?.getDeclarations() ?? [];

    return declarations.flatMap(getReturnStatements);
}

function getReturnStatements(declaration: Node): Node[] {
    if (!Node.isFunctionDeclaration(declaration)) return [];

    const body = declaration.getBody();
    if (!body) return [];

    return body.getDescendantsOfKind(SyntaxKind.ReturnStatement);
}

function findParameterArguments(parameter: ParameterDeclaration): Node[] {
    if (!Node.isParameterDeclaration(parameter)) return [];

    const fn = parameter.getFirstAncestor(Node.isFunctionDeclaration);
    if (!fn) return [];

    const parameterIndex = fn.getParameters().findIndex(p => p === parameter);
    if (parameterIndex === -1) return [];

    const nameNode = fn.getNameNode();
    if (!nameNode) return [];

    return nameNode
        .findReferencesAsNodes()
        .flatMap(ref => {
            const parent = ref.getParent();

            if (
                Node.isCallExpression(parent) &&
                parent.getExpression() === ref
            ) {
                return parent.getArguments()[parameterIndex] ?? [];
            }

            return [];
        });
}
