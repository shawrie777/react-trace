import { Node } from "ts-morph";
import { GraphNode, GraphNodeKind } from "../traceTypes";
import {
  getContainingFunctionName,
  getNodeId,
  isTerminalValue,
} from "../nodeUtils";

import { TraceTarget } from "./types";
import { findDefinitions } from "./definitions";
import { dedupe } from "./utils";
import { isCallNamed } from "./callExpressions";
import { getFunctionLikesFromExpression } from "./functions";

const MAX_NODES = 30;
let nodeCount = 0;
const MAX_DEPTH = 12;

export async function trace(
  target: TraceTarget,
  path = new Set<string>()
): Promise<GraphNode | undefined> {
  if (path.size > MAX_DEPTH || nodeCount > MAX_NODES) return;
  if (path.size === 0) nodeCount = 0;
  nodeCount++;

  const { node } = target;
  const id = getNodeId(node);
  const isCycle = path.has(id);

  const sourceFile = node.getSourceFile();
  const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());

  const nextPath = new Set(path);
  nextPath.add(id);

  const children = isCycle
    ? []
    : (await Promise.all(
        dedupe(findDefinitions(target)).map(child => trace(child, nextPath))
      )).filter((child): child is GraphNode => !!child);
  let note: string | undefined;
  if (isCycle) note = "Cycle detected";
  else if (path.size === MAX_DEPTH) note = "Max depth reached";
  else if (nodeCount === MAX_NODES) note = "Max node count reached";
  else note = target.note ?? getDefaultNodeNote(node);

  return {
    id,
    kind: isCycle ? "cycle" : getGraphNodeKind(target.kind, node, note),
    file: node.getSourceFile().getFilePath(),
    line,
    preview: sourceFile.getFullText().split(/\r?\n/)[line - 1]?.trim() ?? "",
    containingFunc: getContainingFunctionName(node),
    note,
    children,
  };
}

function getGraphNodeKind(
  targetKind: GraphNodeKind | undefined,
  node: Node,
  note: string | undefined
): GraphNodeKind {
  if (note?.includes("boundary")) return "external";
  if (targetKind) return targetKind;
  if (isTerminalValue(node)) return "literal";
  if (Node.isBinaryExpression(node)) return "assignment";
  if (Node.isCallExpression(node)) return "call";
  if (Node.isParameterDeclaration(node) || Node.isBindingElement(node)) return "parameter";
  if (Node.isPropertyAccessExpression(node)) return "property";
  if (Node.isReturnStatement(node)) return "return";
  if (Node.isIdentifier(node)) return "selection";
  return "expression";
}

function getDefaultNodeNote(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node)) {
    const text = node.getText();

    if (text.startsWith("process.env") || text.startsWith("import.meta.env")) {
      return "Environment/config boundary";
    }
  }

  if (!Node.isCallExpression(node)) return undefined;

  const calleeText = node.getExpression().getText();

  if (
    isCallNamed(node, ["fetch"]) ||
    calleeText === "axios" ||
    calleeText.startsWith("axios.") ||
    /^(api|client|http|httpClient)\.(get|post|put|patch|delete|request|query|mutate)$/.test(calleeText)
  ) {
    return "Backend/network boundary";
  }

  if (/^(localStorage|sessionStorage)\.(getItem|setItem)$/.test(calleeText)) {
    return "Browser storage boundary";
  }

  if (isCallNamed(node, ["useSearchParams", "useParams", "useRouter"])) {
    return "Routing boundary";
  }

  if (isCallNamed(node, ["useQuery", "useMutation", "useInfiniteQuery", "useSuspenseQuery"])) {
    return "Data hook boundary";
  }

  if (isCallNamed(node, ["useState", "useReducer", "useContext", "useMemo", "useCallback"])) {
    return "React hook";
  }

  if (getFunctionLikesFromExpression(node.getExpression()).length === 0) {
    return "External or dynamic call boundary";
  }

  return undefined;
}
