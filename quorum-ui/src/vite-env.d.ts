/// <reference types="vite/client" />

// A triple-slash reference rather than `import 'vite/client'` on purpose: an
// import would make this file a module, and the interfaces below would then be
// local declarations that never merge with Vite's global ones. As a reference,
// they augment `import.meta.env` as intended and the env vars come out typed
// instead of `any`.

interface ImportMetaEnv {
  /** Which Midnight network the app targets, e.g. `preview`. */
  readonly VITE_NETWORK_ID: string;
  readonly VITE_LOGGING_LEVEL: string;
  /**
   * The already-deployed poll to offer as a one-click join.
   *
   * @remarks
   * Optional. Without it the user can still paste any contract address; with it
   * the app points straight at the live poll, which is what makes the demo
   * reproducible for someone who has no poll of their own.
   */
  readonly VITE_QUORUM_CONTRACT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
