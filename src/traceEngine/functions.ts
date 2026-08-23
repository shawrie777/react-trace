import { Node, Identifier, CallExpression, ParameterDeclaration, SourceFile } from "ts-morph";
import { getNodeId } from "../nodeUtils";
import { TraceTarget, FunctionLike } from "./types";
import { isCallNamed } from "./callExpressions";
import { dedupeNodes, toTarget } from "./utils";
import { getValueDeclarations } from "./definitions";

export function getFunctionLikesFromExpression(expression: Node): FunctionLike[] {
  if (
    Node.isFunctionDeclaration(expression) ||
    Node.isFunctionExpression(expression) ||
    Node.isArrowFunction(expression) ||
    Node.isMethodDeclaration(expression)
  ) {
    return [expression];
  }

  if (Node.isCallExpression(expression)) {
    return getWrappedFunctionLikes(expression);
  }

  const symbol = expression.getSymbol();
  const aliasedSymbol = symbol?.getAliasedSymbol();
  const declarations = [
    ...(symbol?.getDeclarations() ?? []),
    ...(aliasedSymbol?.getDeclarations() ?? []),
  ];

  return dedupeNodes(declarations.flatMap(getFunctionLikesFromDeclaration));
}

function getWrappedFunctionLikes(call: CallExpression): FunctionLike[] {
  if (!isCallNamed(call, ["memo", "forwardRef"])) return [];

  return call.getArguments().flatMap(getFunctionLikesFromExpression);
}

function getFunctionLikesFromDeclaration(declaration: Node): FunctionLike[] {
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isArrowFunction(declaration) ||
    Node.isMethodDeclaration(declaration)
  ) {
    return [declaration];
  }

  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();

    if (
      Node.isFunctionExpression(initializer) ||
      Node.isArrowFunction(initializer)
    ) {
      return [initializer];
    }

    if (Node.isCallExpression(initializer)) {
      const wrappedFunctionLikes = getWrappedFunctionLikes(initializer);
      if (wrappedFunctionLikes.length > 0) return wrappedFunctionLikes;
    }
  }

  if (Node.isExportSpecifier(declaration)) {
    return declaration
      .getLocalTargetDeclarations()
      .flatMap(getFunctionLikesFromDeclaration);
  }

  if (Node.isExportAssignment(declaration) && !declaration.isExportEquals()) {
    return getFunctionLikesFromExpression(declaration.getExpression());
  }

  return [];
}

export function getCallableDeclarations(call: CallExpression): FunctionLike[] {
  return getFunctionLikesFromExpression(call.getExpression());
}

export function getParameterFunction(parameter: ParameterDeclaration): FunctionLike | undefined {
  const parent = parameter.getParent();

  if (
    Node.isFunctionDeclaration(parent) ||
    Node.isFunctionExpression(parent) ||
    Node.isArrowFunction(parent) ||
    Node.isMethodDeclaration(parent)
  ) {
    return parent;
  }

  return undefined;
}

export function getFunctionNameNode(functionLike: FunctionLike | undefined): Identifier | undefined {
  if (!functionLike) return undefined;

  if (Node.isFunctionDeclaration(functionLike) || Node.isMethodDeclaration(functionLike)) {
    const nameNode = functionLike.getNameNode();
    return Node.isIdentifier(nameNode) ? nameNode : undefined;
  }

  let current: Node = functionLike;

  while (current) {
    const parent = current.getParent();

    if (Node.isVariableDeclaration(parent)) {
      const nameNode = parent.getNameNode();
      return Node.isIdentifier(nameNode) ? nameNode : undefined;
    }

    if (
      Node.isCallExpression(parent) &&
      isCallNamed(parent, ["memo", "forwardRef"])
    ) {
      current = parent;
      continue;
    }

    if (
      Node.isParenthesizedExpression(parent) ||
      Node.isAsExpression(parent) ||
      Node.isSatisfiesExpression(parent) ||
      Node.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }

    break;
  }

  return undefined;
}

export function createReduceCallbackContext(
  functionLike: FunctionLike,
  accumulatorTarget: TraceTarget | undefined,
  elementTarget: TraceTarget,
  receiver: Node,
  oldBindings: Map<string, TraceTarget>
): Map<string, TraceTarget> {
  const bindings = new Map(oldBindings);
  const [accumulatorParameter, elementParameter, indexParameter, arrayParameter] = functionLike.getParameters();

  if (accumulatorParameter && accumulatorTarget) {
    bindings.set(getNodeId(accumulatorParameter), accumulatorTarget);
  }

  if (elementParameter) {
    bindings.set(getNodeId(elementParameter), elementTarget);
  }

  if (indexParameter) {
    bindings.set(getNodeId(indexParameter), toTarget(receiver, oldBindings, "parameter", "Array callback index"));
  }

  if (arrayParameter) {
    bindings.set(getNodeId(arrayParameter), toTarget(receiver, oldBindings, "parameter", "Array callback source"));
  }

  return bindings;
}

export function bindFirstParameterToTarget(
  functionLike: FunctionLike,
  target: TraceTarget,
  oldBindings: Map<string, TraceTarget>
): Map<string, TraceTarget> {
  const firstParameter = functionLike.getParameters()[0];
  if (!firstParameter) return oldBindings;

  const bindings = new Map(oldBindings);
  bindings.set(getNodeId(firstParameter), target);
  return bindings;
}

export function getComponentReferenceNameNodes(functionLike: FunctionLike | undefined): Identifier[] {
  if (!functionLike) return [];

  const directName = getFunctionNameNode(functionLike);
  return dedupeNodes([
    ...(directName ? [directName] : []),
    ...findDefaultImportNameNodesForFunction(functionLike),
  ]);
}

function findDefaultImportNameNodesForFunction(functionLike: FunctionLike): Identifier[] {
  const project = functionLike.getSourceFile().getProject();

  return project.getSourceFiles().flatMap(sourceFile =>
    sourceFile.getImportDeclarations().flatMap(importDeclaration => {
      const defaultImport = importDeclaration.getDefaultImport();
      if (!defaultImport) return [];

      const importedSourceFile = importDeclaration.getModuleSpecifierSourceFile();
      if (!importedSourceFile) return [];

      return sourceFileDefaultExportMayReferToFunction(importedSourceFile, functionLike)
        ? [defaultImport]
        : [];
    })
  );
}

function sourceFileDefaultExportMayReferToFunction(
  sourceFile: SourceFile,
  functionLike: FunctionLike,
  seen = new Set<string>()
): boolean {
  const filePath = sourceFile.getFilePath();
  if (seen.has(filePath)) return false;
  seen.add(filePath);

  if (
    sourceFile === functionLike.getSourceFile() &&
    Node.isFunctionDeclaration(functionLike) &&
    functionLike.isDefaultExport()
  ) {
    return true;
  }

  if (sourceFile.getExportAssignments().some(exportAssignment =>
    !exportAssignment.isExportEquals() &&
    expressionMayReferToFunction(exportAssignment.getExpression(), functionLike, seen)
  )) {
    return true;
  }

  return sourceFile.getExportDeclarations().some(exportDeclaration => {
    const namedExports = exportDeclaration.getNamedExports();
    const defaultReExports = namedExports.filter(namedExport =>
      namedExport.getAliasNode()?.getText() === "default" ||
      namedExport.getName() === "default"
    );

    if (defaultReExports.some(namedExport =>
      namedExport.getLocalTargetDeclarations().some(declaration =>
        declarationMayReferToFunction(declaration, functionLike, seen)
      )
    )) {
      return true;
    }

    return false;
  });
}

function expressionMayReferToFunction(
  expression: Node,
  functionLike: FunctionLike,
  seen: Set<string>
): boolean {
  if (expression === functionLike) return true;

  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return expressionMayReferToFunction(expression.getExpression(), functionLike, seen);
  }

  if (Node.isCallExpression(expression) && isCallNamed(expression, ["memo", "forwardRef"])) {
    return expression.getArguments().some(argument =>
      expressionMayReferToFunction(argument, functionLike, seen)
    );
  }

  if (Node.isIdentifier(expression)) {
    return getValueDeclarations(expression).some(declaration =>
      declarationMayReferToFunction(declaration, functionLike, seen)
    );
  }

  return false;
}

function declarationMayReferToFunction(
  declaration: Node,
  functionLike: FunctionLike,
  seen: Set<string>
): boolean {
  if (declaration === functionLike) return true;

  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return !!initializer && expressionMayReferToFunction(initializer, functionLike, seen);
  }

  if (Node.isExportAssignment(declaration)) {
    return !declaration.isExportEquals() &&
      expressionMayReferToFunction(declaration.getExpression(), functionLike, seen);
  }

  if (Node.isSourceFile(declaration)) {
    return sourceFileDefaultExportMayReferToFunction(declaration, functionLike, seen);
  }

  return false;
}