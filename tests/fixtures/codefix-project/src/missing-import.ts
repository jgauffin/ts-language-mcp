// "makeAccount" is not imported, so TypeScript reports "Cannot find name" and
// offers an add-import fix that knows the correct module specifier.
export function openAccount(id: string) {
  return makeAccount(id);
}
