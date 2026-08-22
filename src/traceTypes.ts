export type GraphNodeKind =
  | "assignment"
  | "call"
  | "cycle"
  | "expression"
  | "literal"
  | "parameter"
  | "property"
  | "return"
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
