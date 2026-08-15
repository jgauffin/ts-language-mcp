export interface Shape {
  area(): number;
}

export abstract class Base implements Shape {
  abstract area(): number;
}
