import { GraphNode } from "./traceTypes";

export type PositionedNode = {
  key: string,
  node: GraphNode,
  x: number,
  y: number,
  incomingCount: number,
};

export type PositionedEdge = {
  parent: PositionedNode,
  child: PositionedNode,
};

export function positionTree(
  root: GraphNode,
  xSpace = 200,
  ySpace = 80,
): { nodes: PositionedNode[], edges: PositionedEdge[] } {
  const nodes = new Map<string, PositionedNode>();
  const childKeys = new Map<string, Set<string>>();
  const edgeKeys = new Set<string>();
  const edgePairs: Array<[string, string]> = [];
  const incomingKeys = new Map<string, Set<string>>();
  const positionedKeys = new Set<string>();
  let nextY = 0;

  function visit(node: GraphNode, depth: number, parentKey?: string) {
    const key = getMergeKey(node);
    const existingNode = nodes.get(key);
    const positionedNode = existingNode ?? {
      key,
      node,
      x: depth * xSpace,
      y: 0,
      incomingCount: 0,
    };

    positionedNode.x = Math.max(positionedNode.x, depth * xSpace);
    nodes.set(key, positionedNode);

    if (!childKeys.has(key)) {
      childKeys.set(key, new Set());
    }

    if (parentKey) {
      const edgeKey = JSON.stringify([parentKey, key]);
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edgePairs.push([parentKey, key]);
      }

      const incoming = incomingKeys.get(key) ?? new Set<string>();
      incoming.add(parentKey);
      incomingKeys.set(key, incoming);
    }

    for (const child of node.children) {
      const childKey = getMergeKey(child);
      childKeys.get(key)!.add(childKey);
      visit(child, depth + 1, key);
    }
  }

  function position(key: string, activePath = new Set<string>()): number {
    const node = nodes.get(key);
    if (!node) return nextY;
    if (positionedKeys.has(key)) return node.y;

    if (activePath.has(key)) {
      node.y = nextY;
      nextY += ySpace;
      positionedKeys.add(key);
      return node.y;
    }

    activePath.add(key);

    const children = [...(childKeys.get(key) ?? [])];
    if (children.length === 0) {
      node.y = nextY;
      nextY += ySpace;
    } else {
      const childPositions = children.map(childKey => position(childKey, activePath));
      node.y = (childPositions[0] + childPositions[childPositions.length - 1]) / 2;
    }

    positionedKeys.add(key);
    activePath.delete(key);
    return node.y;
  }

  visit(root, 0);
  position(getMergeKey(root));

  const positionedNodes = [...nodes.values()].map(node => ({
    ...node,
    incomingCount: incomingKeys.get(node.key)?.size ?? 0,
  }));
  const positionedByKey = new Map(positionedNodes.map(node => [node.key, node]));
  const edges = edgePairs.flatMap(([parentKey, childKey]) => {
    const parent = positionedByKey.get(parentKey);
    const child = positionedByKey.get(childKey);

    return parent && child ? [{ parent, child }] : [];
  });

  return { nodes: positionedNodes, edges };
}

function getMergeKey(node: GraphNode): string {
  return `${node.id}:${node.kind}:${node.note ?? ""}`;
}
