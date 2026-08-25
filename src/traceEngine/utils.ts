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
  return { node, bindings, kind, note };
}

export function dedupe<T extends TraceTarget | Node>(group: T[]) : T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const elem of group) {
    const key = "node" in elem ? `${getNodeId(elem.node)}:${elem.kind ?? ""}:${elem.note ?? ""}` : getNodeId(elem);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(elem);
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