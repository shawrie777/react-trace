export type GraphNodeKind =
  | "assignment"
  | "call"
  | "cycle"
  | "context"
  | "expression"
  | "external"
  | "hook"
  | "literal"
  | "mutation"
  | "parameter"
  | "property"
  | "return"
  | "state"
  | "selection"
  | "unknown";

export type GraphNode = {
  id: string,
  kind: GraphNodeKind,
  file: string,
  line: number,
  preview: string,
  containingFunc: string,
  note?: string,
  children: GraphNode[];
}
