# Navigation Tools

Tools for navigating code: jumping to definitions, finding references, and tracing implementations.

## `get_definition`

**Jump from usage to declaration.** When your agent sees a function call or type reference, this finds where it's defined.

```json
{ "file": "src/handlers.ts", "line": 28, "column": 25 }
```
Returns: `{ "file": "src/services/user-service.ts", "line": 55, "column": 9 }`

*Agent use case: Understanding unfamiliar code by tracing imports and dependencies.*

## `get_references`

**Find all usages of a symbol across the project.** Each reference is classified as `definition`, `read`, or `write`.

```json
{ "file": "src/types.ts", "line": 5, "column": 13 }
```
Returns locations with kind: helps agents understand data flow and impact of changes.

*Agent use case: Before modifying a function, check all callers to ensure compatibility.*

## `get_implementations`

**Find concrete implementations of interfaces or abstract methods.**

```json
{ "file": "src/services.ts", "line": 4, "column": 18 }
```
Returns all classes that implement the interface.

*Agent use case: Understanding polymorphic code - "which classes actually implement this interface?"*

## `get_call_hierarchy`

**Trace function calls up or down.** Direction `incoming` shows callers; `outgoing` shows callees.

```json
{ "file": "src/utils.ts", "line": 15, "column": 10, "direction": "incoming" }
```

*Agent use case: Understanding call chains - "what calls this function?" or "what does this function call?"*

## `get_type_hierarchy`

**Navigate class/interface inheritance.** Direction `supertypes` shows parents; `subtypes` shows implementations.

```json
{ "file": "src/models.ts", "line": 15, "column": 14, "direction": "supertypes" }
```

*Agent use case: Understanding inheritance chains and finding base class methods.*
