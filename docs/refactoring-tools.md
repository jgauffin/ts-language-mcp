# Refactoring Tools

Tools that change code, plus the two that preview changes without making them.

All of these accept `symbol` in place of `line`/`column`, so you can target
`"UserService.getUser"` without first reading the file to find its coordinates.

## Which tools write to disk

| Tool | Writes to disk |
|------|----------------|
| `rename_preview` | No |
| `organize_imports` (default) | No |
| `rename_symbol` | Yes |
| `format_document` | Yes |
| `apply_code_fix` | Yes |
| `organize_imports` with `apply: true` | Yes |

---

## `get_code_fixes`

The fixes TypeScript itself proposes for the errors at a position: add a missing
import, add a missing interface member, remove unused code, fix a misspelled
property, and so on.

Prefer this over hand-writing a fix for a reported diagnostic. The compiler
already knows the exact edit, including which module an unresolved name comes
from, which is the detail most often guessed wrong.

```json
{ "file": "src/handlers.ts", "line": 12, "column": 10 }
```

```yaml
fixes:
 - fixName: import
   description: Add import from "./services/user-service.js"
   fixAllDescription: Add all missing imports
   changes:
    - file: src/handlers.ts
      edits:
       - line: 1
         column: 1
         endLine: 1
         endColumn: 1
         newText: "import { UserService } from './services/user-service.js';\n"
count: 1
```

`errorCodes` is optional. Left out, the tool uses whatever diagnostics are
reported at that position, so pointing at a reported error is enough.

**Agent use case:** `get_diagnostics` reports "Cannot find name 'UserService'".
Call `get_code_fixes` at that position and apply the returned import rather than
inventing a path.

---

## `apply_code_fix`

Applies one of the fixes from `get_code_fixes` and writes it to disk.

```json
{ "symbol": "createGetUserHandler", "fixName": "import", "applyToAll": true }
```

```yaml
applied: true
filesModified:
 - src/handlers.ts
totalEdits: 1
description: Add import from "./services/user-service.js"
```

`applyToAll` fixes every occurrence of the same problem in the file, and is only
available for fixes that report a `fixAllDescription`.

Asking for a fix that is not available returns an error naming the ones that are,
rather than failing silently.

---

## `organize_imports`

Sorts a file's imports and drops unused ones, using TypeScript's own organizer.

Previews by default; pass `apply: true` to write the result.

```json
{ "file": "src/handlers.ts", "apply": true }
```

**Agent use case:** after deleting the last usage of an import, let the compiler
remove it. Editing the import list by hand is where stray commas and half-removed
named imports come from.

---

## `rename_preview`

Every location a rename would touch, without changing anything.

```json
{ "symbol": "UserService", "newName": "AccountService" }
```

```yaml
locations:
 - file: src/services/user-service.ts
   line: 4
   column: 18
   text: export interface UserService {
   originalText: UserService
   newText: AccountService
 - file: src/consumer.ts
   line: 6
   column: 12
   text: "return { timeout };"
   originalText: timeout
   newText: timeoutMs
   prefixText: "timeout: "
count: 2
```

`prefixText` and `suffixText` appear where a bare substitution would change
meaning. The example above is a shorthand property: the object must keep its
`timeout` key while the binding it references is renamed, so the result is
`{ timeout: timeoutMs }`. Aliased imports work the same way. If you apply rename
edits yourself rather than using `rename_symbol`, you must honour these.

---

## `rename_symbol`

Performs the rename across the project and writes every affected file to disk.

```json
{ "symbol": "UserService", "newName": "AccountService" }
```

```yaml
success: true
filesModified:
 - src/services/user-service.ts
 - src/handlers.ts
totalChanges: 7
```

Shorthand properties and aliased imports are handled correctly.

---

## `format_document`

Formats a file with TypeScript's built-in formatter and writes it to disk.

```json
{ "file": "src/handlers.ts" }
```

```yaml
formatted: true
changeCount: 12
file: src/handlers.ts
```

The formatted text is not returned by default, because the file is on disk and
returning its full contents is the most expensive response this server can send.
Pass `includeContent: true` if you genuinely need the text back.

Formatting options are TypeScript's own. There is no Prettier or `.editorconfig`
integration, so a project using Prettier should run that instead.
