// Outside the tsconfig "include", and JavaScript in a project without allowJs.
// The language service cannot produce a source file for it, so any tool that
// pulls it into the root set will fail on program-backed APIs.
export const legacy = 'untyped';
