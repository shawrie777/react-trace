export type GraphNode = {
  id: string,
  file: string,
  line: number,
  preview: string,
  containingFunc: string,
  children: GraphNode[];
}