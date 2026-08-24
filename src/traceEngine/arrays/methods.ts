import { CallExpression, Node } from "ts-morph";
import { getReturnTargets } from "../expressions";
import { getFunctionLikesFromExpression } from "../functions";
import { FunctionLike, TraceTarget } from "../types";
import { getNodeId } from "../../nodeUtils";
import { toTarget } from "../utils";
import { findArrayElementCandidateSources } from "./elements";

export function findArrayMethodReturnValues(
  call: CallExpression,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return [];

  const methodName = expression.getName();
  const receiver = expression.getExpression();

  if (methodName === "map" || methodName === "flatMap") {
    const callback = call.getArguments()[0];
    if (!callback) return [];

    const functionLikes = getFunctionLikesFromExpression(callback);
    if (functionLikes.length === 0) return [];

    return findArrayElementCandidateSources(receiver, bindings)
      .flatMap(elementTarget => functionLikes.flatMap(functionLike => {
        const callbackContext = createArrayCallbackContext(
          functionLike,
          elementTarget,
          receiver,
          bindings
        );

        return getReturnTargets(functionLike, callbackContext).map(target => ({
          ...target,
          note: target.note ?? `Array ${methodName} callback return`,
        }));
      }));
  }

  if (methodName === "reduce") {
    return findReduceReturnValues(call, receiver, bindings);
  }

  if (methodName === "find") {
    return findArrayElementCandidateSources(receiver, bindings).map(target => ({
      ...target,
      note: target.note ?? "Array find result",
    }));
  }

  if (
    ["filter", "slice", "toReversed", "toSorted", "toSpliced", "reverse", "sort"].includes(methodName)
  ) {
    return findArrayElementCandidateSources(receiver, bindings).map(target => ({
      ...target,
      note: target.note ?? `Array ${methodName} preserves source elements`,
    }));
  }

  if (methodName === "concat") {
    return [
      ...findArrayElementCandidateSources(receiver, bindings),
      ...call.getArguments().flatMap(argument =>
        findArrayElementCandidateSources(argument, bindings)
      ),
    ];
  }

  return [];
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

function createArrayCallbackContext(
  functionLike: FunctionLike,
  elementTarget: TraceTarget,
  receiver: Node,
  oldBindings: Map<string, TraceTarget>
): Map<string, TraceTarget> {
  const bindings = new Map(oldBindings);
  const [elementParameter, indexParameter, arrayParameter] = functionLike.getParameters();

  if (elementParameter) {
    bindings.set(getNodeId(elementParameter), elementTarget);
  }

  if (indexParameter) {
    bindings.set(getNodeId(indexParameter), toTarget(receiver, oldBindings, "parameter", "Array callback index"));
  }

  if (arrayParameter) {
    bindings.set(getNodeId(arrayParameter), toTarget(receiver, oldBindings, "parameter", "Array callback source"));
  }

  return bindings;
}

export function createReduceCallbackContext(
  functionLike: FunctionLike,
  accumulatorTarget: TraceTarget | undefined,
  elementTarget: TraceTarget,
  receiver: Node,
  oldBindings: Map<string, TraceTarget>
): Map<string, TraceTarget> {
  const bindings = new Map(oldBindings);
  const [accumulatorParameter, elementParameter, indexParameter, arrayParameter] = functionLike.getParameters();

  if (accumulatorParameter && accumulatorTarget) {
    bindings.set(getNodeId(accumulatorParameter), accumulatorTarget);
  }

  if (elementParameter) {
    bindings.set(getNodeId(elementParameter), elementTarget);
  }

  if (indexParameter) {
    bindings.set(getNodeId(indexParameter), toTarget(receiver, oldBindings, "parameter", "Array callback index"));
  }

  if (arrayParameter) {
    bindings.set(getNodeId(arrayParameter), toTarget(receiver, oldBindings, "parameter", "Array callback source"));
  }

  return bindings;
}