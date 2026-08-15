// A different type that happens to share the name "Shape". Matching heritage
// clauses by name text alone would wrongly report Decoy as a subtype of the
// Shape declared in base.ts.
interface Shape {
  unrelated: boolean;
}

export class Decoy implements Shape {
  unrelated = true;
}
