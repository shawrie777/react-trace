import { GraphNode } from "./traceTypes";

type PositionedNode = {
    node: GraphNode,
    x: number,
    y: number,
    parent?: PositionedNode,
};

export function positionTree(
    root: GraphNode,
    xSpace = 200,
    ySpace = 80,
) : PositionedNode[] {
    const positioned: PositionedNode[] = [];
    let nextY = 0;

    function position(
        node: GraphNode,
        depth: number,
        parent?: PositionedNode,
    ) : PositionedNode {
        const positionedNode: PositionedNode = {
            node,
            x: depth * xSpace,
            y: 0,
            parent,
        };

        positioned.push(positionedNode);

        if (node.children.length === 0) {
            positionedNode.y = nextY;
            nextY += ySpace;
        } else {
            const children = node.children.map(child => 
                position(child, depth + 1, positionedNode)
            );

            positionedNode.y = (children[0].y + children[children.length - 1].y) / 2;
        }

        return positionedNode;
    }

    position(root, 0);
    return positioned;
}