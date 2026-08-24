import { Node, CallExpression, Identifier } from "ts-morph";
import { getNodeId } from "../nodeUtils";
import { TraceTarget, FunctionLike } from "./types";
import { findUseContextValues } from "./hooks";
import { getCallableDeclarations } from "./functions";
import { toTarget, isIdentifierWrite } from "./utils";
import { getReturnTargets } from "./expressions";
import { findArrayMethodReturnValues } from "./arrays/methods";

export function findCallReturnValues(call: CallExpression, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (isCallNamed(call, ["useContext"])) {
    return findUseContextValues(call, bindings);
  }

  const arrayMethodValues = findArrayMethodReturnValues(call, bindings);
  if (arrayMethodValues.length > 0) return arrayMethodValues;

  const functionLikes = getCallableDeclarations(call);

  if (functionLikes.length === 0) {
    return [];
  }

  return functionLikes.flatMap(functionLike => {
    const callContext = createCallContextForFunction(functionLike, call, bindings);
    return getReturnTargets(functionLike, callContext);
  });
}

export function isCallNamed(call: CallExpression, names: string[]): boolean {
  const callName = getCallName(call);
  return !!callName && names.includes(callName);
}

export function getCallName(call: CallExpression): string | undefined {
  const expression = call.getExpression();

  if (Node.isIdentifier(expression)) {
    return expression.getText();
  }

  if (Node.isPropertyAccessExpression(expression)) {
    return expression.getName();
  }

  return undefined;
}

function createCallContextForFunction(
  functionLike: FunctionLike,
  call: CallExpression,
  callerBindings: Map<string, TraceTarget>
): Map<string, TraceTarget> {
  const bindings = new Map(callerBindings);
  const args = call.getArguments();

  functionLike.getParameters().forEach((parameter, index) => {
    const arg = args[index];
    if (!arg) return;

    bindings.set(
      getNodeId(parameter),
      toTarget(arg, callerBindings, "parameter", "Argument passed to this function call")
    );
  });

  return bindings;
}

export function findMutationCallTargets(
  call: CallExpression,
  target: Identifier,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return [];

  const mutatingMethods = [
    "add",
    "clear",
    "copyWithin",
    "delete",
    "fill",
    "pop",
    "push",
    "reverse",
    "set",
    "shift",
    "sort",
    "splice",
    "unshift",
  ];

  if (!mutatingMethods.includes(expression.getName())) return [];
  if (!isIdentifierWrite(expression.getExpression(), target)) return [];

  return [
    toTarget(expression.getExpression(), bindings, "mutation", "Previous value before mutation"),
    ...call.getArguments().map(arg => toTarget(arg, bindings, "mutation", "Mutation input")),
  ];
}