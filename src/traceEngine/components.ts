import { Identifier, Node, SourceFile } from "ts-morph";
import { getFunctionNameNode } from "./functions";
import { FunctionLike } from "./types";
import { dedupe } from "./utils";
import { isCallNamed } from "./callExpressions";
import { getValueDeclarations } from "./symbols";

export function getComponentReferenceNameNodes(functionLike: FunctionLike | undefined): Identifier[] {
  if (!functionLike) return [];

  const directName = getFunctionNameNode(functionLike);
  return dedupe([
    ...(directName ? [directName] : []),
    ...findDefaultImportNameNodesForFunction(functionLike),
  ]);
}

function findDefaultImportNameNodesForFunction(functionLike: FunctionLike): Identifier[] {
  const project = functionLike.getSourceFile().getProject();

  return project.getSourceFiles().flatMap(sourceFile =>
    sourceFile.getImportDeclarations().flatMap(importDeclaration => {
      const defaultImport = importDeclaration.getDefaultImport();
      if (!defaultImport) return [];

      const importedSourceFile = importDeclaration.getModuleSpecifierSourceFile();
      if (!importedSourceFile) return [];

      return sourceFileDefaultExportMayReferToFunction(importedSourceFile, functionLike)
        ? [defaultImport]
        : [];
    })
  );
}

function sourceFileDefaultExportMayReferToFunction(
  sourceFile: SourceFile,
  functionLike: FunctionLike,
  seen = new Set<string>()
): boolean {
  const filePath = sourceFile.getFilePath();
  if (seen.has(filePath)) return false;
  seen.add(filePath);

  if (
    sourceFile === functionLike.getSourceFile() &&
    Node.isFunctionDeclaration(functionLike) &&
    functionLike.isDefaultExport()
  ) {
    return true;
  }

  if (sourceFile.getExportAssignments().some(exportAssignment =>
    !exportAssignment.isExportEquals() &&
    expressionMayReferToFunction(exportAssignment.getExpression(), functionLike, seen)
  )) {
    return true;
  }

  return sourceFile.getExportDeclarations().some(exportDeclaration => {
    const namedExports = exportDeclaration.getNamedExports();
    const defaultReExports = namedExports.filter(namedExport =>
      namedExport.getAliasNode()?.getText() === "default" ||
      namedExport.getName() === "default"
    );

    if (defaultReExports.some(namedExport =>
      namedExport.getLocalTargetDeclarations().some(declaration =>
        declarationMayReferToFunction(declaration, functionLike, seen)
      )
    )) {
      return true;
    }

    return false;
  });
}

function expressionMayReferToFunction(
  expression: Node,
  functionLike: FunctionLike,
  seen: Set<string>
): boolean {
  if (expression === functionLike) return true;

  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return expressionMayReferToFunction(expression.getExpression(), functionLike, seen);
  }

  if (Node.isCallExpression(expression) && isCallNamed(expression, ["memo", "forwardRef"])) {
    return expression.getArguments().some(argument =>
      expressionMayReferToFunction(argument, functionLike, seen)
    );
  }

  if (Node.isIdentifier(expression)) {
    return getValueDeclarations(expression).some(declaration =>
      declarationMayReferToFunction(declaration, functionLike, seen)
    );
  }

  return false;
}

function declarationMayReferToFunction(
  declaration: Node,
  functionLike: FunctionLike,
  seen: Set<string>
): boolean {
  if (declaration === functionLike) return true;

  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return !!initializer && expressionMayReferToFunction(initializer, functionLike, seen);
  }

  if (Node.isExportAssignment(declaration)) {
    return !declaration.isExportEquals() &&
      expressionMayReferToFunction(declaration.getExpression(), functionLike, seen);
  }

  if (Node.isSourceFile(declaration)) {
    return sourceFileDefaultExportMayReferToFunction(declaration, functionLike, seen);
  }

  return false;
}