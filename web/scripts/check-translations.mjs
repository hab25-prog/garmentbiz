import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const sourceRoot = path.resolve("src");
const providerPath = path.join(sourceRoot, "app/providers/LanguageProvider.tsx");
const amharicKeys = new Set();
const amharicTranslations = new Map();
const usedKeys = new Map();
const untranslatedNodes = [];

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? collectFiles(fullPath)
      : /\.(tsx|ts)$/.test(entry.name) ? [fullPath] : [];
  });
}

function addKeysFromObject(object, sourceFile) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isStringLiteral(property.name) || ts.isNoSubstitutionTemplateLiteral(property.name)
      ? property.name.text
      : ts.isIdentifier(property.name) ? property.name.text : null;
    if (key) {
      amharicKeys.add(normalize(key));
      if (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer)) {
        amharicTranslations.set(normalize(key), property.initializer.text);
      }
    }
  }
}

function collectTranslationDictionary() {
  const sourceFile = ts.createSourceFile(
    providerPath,
    fs.readFileSync(providerPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "amharic"
      && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      addKeysFromObject(node.initializer, sourceFile);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === "Object"
      && node.expression.name.text === "assign"
      && node.arguments[0]?.getText(sourceFile) === "amharic"
      && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      addKeysFromObject(node.arguments[1], sourceFile);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function remember(text, file, position) {
  const key = normalize(text);
  if (key) usedKeys.set(key, { file: path.relative(process.cwd(), file), position });
}

function collectUsage(file) {
  // This old, unmounted component is not imported by the active Materials feature.
  if (file === path.join(sourceRoot, "components/Materials.tsx")) return;
  const sourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === "API_ERROR_TRANSLATION_KEYS" && node.initializer
      && ts.isArrayLiteralExpression(node.initializer)) {
      for (const element of node.initializer.elements) {
        if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
          remember(element.text, file, element.getStart(sourceFile));
        }
      }
    }
    if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text)) {
      untranslatedNodes.push(`${path.relative(process.cwd(), file)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`);
    }
    if (ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName) && node.tagName.text === "LocalizedText") {
      const textAttribute = node.attributes.properties.find((attribute) =>
        ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === "text");
      if (textAttribute && ts.isJsxAttribute(textAttribute) && textAttribute.initializer && ts.isJsxExpression(textAttribute.initializer)
        && textAttribute.initializer.expression && ts.isStringLiteral(textAttribute.initializer.expression)) {
        remember(textAttribute.initializer.expression.text, file, node.getStart(sourceFile));
      }
    }
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
      if (["t", "translate", "translateCurrent"].includes(name) && node.arguments[0]
        && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
        remember(node.arguments[0].text, file, node.getStart(sourceFile));
      }
      if (ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText(sourceFile) === "toast"
        && ["success", "error", "info"].includes(node.expression.name.text)
        && node.arguments[0]) {
        const collectMessageLiterals = (candidate) => {
          if (ts.isStringLiteral(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) {
            remember(candidate.text, file, candidate.getStart(sourceFile));
          } else if (ts.isConditionalExpression(candidate)) {
            collectMessageLiterals(candidate.whenTrue);
            collectMessageLiterals(candidate.whenFalse);
          } else if (ts.isBinaryExpression(candidate)
            && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(candidate.operatorToken.kind)) {
            collectMessageLiterals(candidate.right);
          }
        };
        collectMessageLiterals(node.arguments[0]);
      }
    }
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const expression = node.expression;
      const hasTranslationCall = (candidate) => {
        if (ts.isCallExpression(candidate)) {
          const name = ts.isIdentifier(candidate.expression) ? candidate.expression.text
            : ts.isPropertyAccessExpression(candidate.expression) ? candidate.expression.name.text : "";
          if (["t", "translate", "translateCurrent"].includes(name)) return true;
        }
        if (ts.isJsxSelfClosingElement(candidate) && ts.isIdentifier(candidate.tagName)
          && candidate.tagName.text === "LocalizedText") return true;
        return candidate.forEachChild(hasTranslationCall);
      };
      const visibleLiterals = (candidate) => {
        if (ts.isParenthesizedExpression(candidate)) return visibleLiterals(candidate.expression);
        if (ts.isStringLiteral(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) {
          return /[A-Za-z]/.test(candidate.text) ? [candidate.text] : [];
        }
        if (ts.isConditionalExpression(candidate)) {
          return [...visibleLiterals(candidate.whenTrue), ...visibleLiterals(candidate.whenFalse)];
        }
        if (ts.isBinaryExpression(candidate)
          && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(candidate.operatorToken.kind)) {
          return visibleLiterals(candidate.right);
        }
        return [];
      };
      if (!hasTranslationCall(expression)) {
        for (const literal of visibleLiterals(expression)) {
          untranslatedNodes.push(`${path.relative(process.cwd(), file)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1} expression: ${JSON.stringify(normalize(literal))}`);
        }
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)
      && ["placeholder", "title", "aria-label", "alt"].includes(node.name.getText(sourceFile))
      && /[A-Za-z]/.test(node.initializer.text)
      && !/^\+?\d[\d.\-]*$/.test(node.initializer.text)) {
      untranslatedNodes.push(`${path.relative(process.cwd(), file)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1} ${node.name.getText(sourceFile)}: ${JSON.stringify(node.initializer.text)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

collectTranslationDictionary();
for (const file of collectFiles(sourceRoot)) collectUsage(file);

const missing = [...usedKeys.keys()].filter((key) => !amharicKeys.has(key));
const interpolationMismatches = [...usedKeys.keys()].filter((key) => {
  const translated = amharicTranslations.get(key);
  if (translated === undefined) return false;
  const names = (value) => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort().join(",");
  return names(key) !== names(translated);
});
if (untranslatedNodes.length || missing.length || interpolationMismatches.length) {
  if (untranslatedNodes.length) console.error("Unwrapped static JSX text:", [...new Set(untranslatedNodes)].join("\n"));
  if (missing.length) console.error("Missing Amharic dictionary keys:", missing.map((key) => `${key} (${usedKeys.get(key).file})`).join("\n"));
  if (interpolationMismatches.length) console.error("Interpolation placeholders differ:", interpolationMismatches.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Translation audit passed: ${usedKeys.size} UI and toast keys have Amharic entries; no untranslated static JSX text or checked text attributes found in active UI files.`);
}
