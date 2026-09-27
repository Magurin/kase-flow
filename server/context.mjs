import { AsyncLocalStorage } from "node:async_hooks";
export const issueContext = new AsyncLocalStorage();
