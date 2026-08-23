import {
    ArrowFunction,
    FunctionDeclaration,
    FunctionExpression,
    MethodDeclaration,
    Node
} from "ts-morph";

import { GraphNodeKind } from "../traceTypes";

export type FunctionLike =
    | ArrowFunction
    | FunctionDeclaration
    | FunctionExpression
    | MethodDeclaration;

export type TraceTarget = {
    node: Node;
    bindings: Map<string, TraceTarget>;
    kind?: GraphNodeKind;
    note?: string;
};

export type ScanResult = {
  targets: TraceTarget[];
  definitelyAssigned: boolean;
};
