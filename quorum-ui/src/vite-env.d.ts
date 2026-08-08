import 'vite/client';

interface ImportMetaEnv {
  /** Which Midnight network the app targets, e.g. `preview`. */
  readonly VITE_NETWORK_ID: string;
  readonly VITE_LOGGING_LEVEL: string;
  /**
   * The already-deployed poll to offer as a one-click join.
   *
   * @remarks
   * Optional. Without it the user can still paste any contract address; with it
   * the app can point straight at the live poll, which is what makes the demo
   * reproducible for someone who has no poll of their own.
   */
  readonly VITE_QUORUM_CONTRACT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
