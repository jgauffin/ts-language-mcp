// ESLint-only fixture — parsable by espree.
// no-unused-vars: unusedVar is declared but never used.
// prefer-const: mutableThing is never reassigned.
export function withLintIssues() {
  const unusedVar = 1;
  let mutableThing = 2;
  return mutableThing;
}
