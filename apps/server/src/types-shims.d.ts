declare module "better-sqlite3-session-store" {
  import type session from "express-session";
  function createStore(s: typeof session): new (opts: { client: unknown; expired?: { clear: boolean; intervalMs: number } }) => session.Store;
  export default createStore;
}
