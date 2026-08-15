export interface Account {
  id: string;
  balance: number;
}

export function makeAccount(id: string): Account {
  return { id, balance: 0 };
}
