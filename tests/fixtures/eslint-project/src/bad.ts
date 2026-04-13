// Both TS and ESLint errors in one file.
// TS error: number assigned to string.
export const tsBad: string = 42;

// ESLint error: no-unused-vars — unusedVar is declared but never referenced.
// ESLint warning: prefer-const — mutableThing is never reassigned.
export function withLintIssues(): number {
  const unusedVar = 1;
  let mutableThing = 2;
  return mutableThing;
}
