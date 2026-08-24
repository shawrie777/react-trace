import { Node, Identifier, BindingElement } from "ts-morph";
import { GraphNodeKind } from "../traceTypes";
import { getNodeId, nodesReferToSameSymbol } from "../nodeUtils";
import { TraceTarget, ScanResult } from "./types";

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

export function bindingElementHasRestToken(bindingElement: BindingElement): boolean {
  return Node.isDotDotDotTokenable(bindingElement) && !!bindingElement.getDotDotDotToken();
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