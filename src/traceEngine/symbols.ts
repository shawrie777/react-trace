import { Identifier, Node } from "ts-morph";
import { dedupe } from "./utils";

export function getValueDeclarations(node: Identifier): Node[] {
  const symbol = node.getSymbol();
  const aliasedSymbol = symbol?.getAliasedSymbol();
  const declarations = [
    ...(symbol?.getDeclarations() ?? []),
    ...(aliasedSymbol?.getDeclarations() ?? []),
  ];

  return dedupe(declarations);
}