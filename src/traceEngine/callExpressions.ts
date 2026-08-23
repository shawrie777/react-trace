import { Node, CallExpression, ParameterDeclaration, Identifier } from "ts-morph";
import { getNodeId } from "../nodeUtils";
import { TraceTarget, FunctionLike } from "./types";
import { findArrayElementCandidateSources, findArrayMethodReturnValues } from "./array";
import { findUseContextValues } from "./hooks";
import { getCallableDeclarations, getParameterFunction, getFunctionNameNode, getFunctionLikesFromExpression, createReduceCallbackContext } from "./functions";
import { toTarget, getReturnTargets, isIdentifierWrite } from "./utils";

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

export function findCallSiteArguments(
  parameter: ParameterDeclaration,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);
  const nameNode = getFunctionNameNode(functionLike);
  if (!functionLike || !nameNode) return [];

  const parameterIndex = functionLike.getParameters().findIndex(candidate => candidate === parameter);
  if (parameterIndex === -1) return [];

  return nameNode
    .findReferencesAsNodes()
    .flatMap(ref => {
      const parent = ref.getParent();

      if (
        Node.isCallExpression(parent) &&
        parent.getExpression() === ref
      ) {
        const arg = parent.getArguments()[parameterIndex];
        return arg ? [toTarget(arg, bindings, "parameter")] : [];
      }

      return [];
    });
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

export function findReduceReturnValues(
  call: CallExpression,
  receiver: Node,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const callback = call.getArguments()[0];
  if (!callback) return [];

  const functionLikes = getFunctionLikesFromExpression(callback);
  if (functionLikes.length === 0) return [];

  const initialValue = call.getArguments()[1];
  const elementTargets = findArrayElementCandidateSources(receiver, bindings);
  const accumulatorTarget = initialValue
    ? toTarget(initialValue, bindings, "parameter", "Initial reduce accumulator")
    : elementTargets[0];

  return [
    ...(initialValue ? [toTarget(initialValue, bindings, "parameter", "Initial reduce accumulator")] : []),
    ...elementTargets.flatMap(elementTarget => functionLikes.flatMap(functionLike => {
      const callbackContext = createReduceCallbackContext(
        functionLike,
        accumulatorTarget,
        elementTarget,
        receiver,
        bindings
      );

      return getReturnTargets(functionLike, callbackContext).map(target => ({
        ...target,
        note: target.note ?? "Array reduce callback return",
      }));
    })),
  ];
}