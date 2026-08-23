import { Node, Statement, Identifier, SyntaxKind, BindingElement } from "ts-morph";
import { GraphNodeKind } from "../traceTypes";
import { getNodeId, nodesReferToSameSymbol } from "../nodeUtils";
import { TraceTarget, FunctionLike, ScanResult } from "./types";
import { findExpressionSources } from "./returns";

export const emptyScanResult: ScanResult = {
  targets: [],
  definitelyAssigned: false,
};

export function toTarget(
  node: Node,
  bindings: Map<string, TraceTarget>,
  kind?: GraphNodeKind,
  note?: string
): TraceTarget {
  return { node, bindings: bindings, kind, note };
}

export function dedupeTargets(targets: TraceTarget[]): TraceTarget[] {
  const seen = new Set<string>();
  const result: TraceTarget[] = [];

  for (const target of targets) {
    const key = `${getNodeId(target.node)}:${target.kind ?? ""}:${target.note ?? ""}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(target);
  }

  return result;
}

export function dedupeNodes<TNode extends Node>(nodes: TNode[]): TNode[] {
  const seen = new Set<string>();
  const result: TNode[] = [];

  for (const node of nodes) {
    const key = getNodeId(node);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(node);
  }

  return result;
}

export function getReturnTargets(functionLike: FunctionLike, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (Node.isArrowFunction(functionLike)) {
    const body = functionLike.getBody();

    if (Node.isBlock(body)) {
      return body
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .map(returnStatement => toTarget(returnStatement, bindings, "return"));
    }

    return [toTarget(body, bindings, "return", "Implicit arrow-function return")];
  }

  const body = functionLike.getBody();
  if (!body) return [];

  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .map(returnStatement => toTarget(returnStatement, bindings, "return"));
}

export function withInitializerFallback(
  targets: TraceTarget[],
  initializer: Node | undefined,
  bindings: Map<string, TraceTarget>,
  kind: GraphNodeKind,
  note: string
): TraceTarget[] {
  if (targets.length > 0 || !initializer) return targets;
  return [toTarget(initializer, bindings, kind, note)];
}

export function declarationTargets(declaration: Node, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer
      ? [toTarget(initializer, bindings, "assignment")]
      : [toTarget(declaration, bindings, "assignment", "Declared without an initializer")];
  }

  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isArrowFunction(declaration) ||
    Node.isMethodDeclaration(declaration)
  ) {
    return getReturnTargets(declaration, bindings);
  }

  if (Node.isParameterDeclaration(declaration)) {
    return [toTarget(declaration, bindings, "parameter")];
  }

  if (Node.isBindingElement(declaration)) {
    return [toTarget(declaration, bindings, "parameter")];
  }

  if (Node.isExportAssignment(declaration) && !declaration.isExportEquals()) {
    return findExpressionSources(declaration.getExpression(), bindings);
  }

  return [];
}

export function bindingElementHasRestToken(bindingElement: BindingElement): boolean {
  return Node.isDotDotDotTokenable(bindingElement) && !!bindingElement.getDotDotDotToken();
}

export function statementAlwaysTerminates(statement: Statement): boolean {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) {
    return true;
  }

  if (Node.isBlock(statement)) {
    const statements = statement.getStatements();
    const lastStatement = statements[statements.length - 1];
    return lastStatement ? statementAlwaysTerminates(lastStatement) : false;
  }

  if (Node.isIfStatement(statement)) {
    const elseStatement = statement.getElseStatement();
    return !!elseStatement &&
      statementAlwaysTerminates(statement.getThenStatement()) &&
      statementAlwaysTerminates(elseStatement);
  }

  if (Node.isSwitchStatement(statement)) {
    const clauses = statement.getClauses();
    return clauses.length > 0 &&
      clauses.some(Node.isDefaultClause) &&
      clauses.every(clause => {
        const statements = clause.getStatements();
        const lastStatement = statements[statements.length - 1];
        return lastStatement ? statementAlwaysTerminates(lastStatement) : false;
      });
  }

  if (Node.isTryStatement(statement)) {
    const finallyBlock = statement.getFinallyBlock();
    if (finallyBlock && statementAlwaysTerminates(finallyBlock)) return true;

    const catchClause = statement.getCatchClause();
    return statementAlwaysTerminates(statement.getTryBlock()) &&
      !!catchClause &&
      statementAlwaysTerminates(catchClause.getBlock());
  }

  return false;
}

export function bindingElementMatchesIdentifier(element: BindingElement, target: Identifier): boolean {
  const nameNode = element.getNameNode();

  return Node.isIdentifier(nameNode) && nodesReferToSameSymbol(nameNode, target);
}

export function isIdentifierWrite(left: Node, target: Identifier): boolean {
  return Node.isIdentifier(left) && nodesReferToSameSymbol(left, target);
}

export function getBindingElementIdentifier(bindingElement: BindingElement): Identifier | undefined {
  const nameNode = bindingElement.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode : undefined;
}