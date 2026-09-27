import type { State } from "./domain";

export type Page =
  | "issues"
  | "overview"
  | "actions"
  | "control"
  | "registry"
  | "journal"
  | "investor";

/** What every issue page receives from the shell. */
export type Ctx = {
  s: State;
  readOnly: boolean;
  now: number;
  busy: boolean;
  act(body: object): Promise<boolean>;
  refresh(): Promise<void>;
  notify(message: string): void;
  go(page: Page): void;
  openAction(kind?: number): void;
  openTransfer(): void;
  inspect(signature: string): void;
  newDemo(wallet?: string): Promise<void>;
};
