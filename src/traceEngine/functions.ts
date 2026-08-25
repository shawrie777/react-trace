import { Node, Identifier, CallExpression, ParameterDeclaration } from "ts-morph";
import { getNodeId } from "../nodeUtils";
import { TraceTarget, FunctionLike } from "./types";
import { isCallNamed } from "./callExpressions";
import { dedupe } from "./utils";

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

  return dedupe(declarations.flatMap(getFunctionLikesFromDeclaration));
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