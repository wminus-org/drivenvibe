/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key. Set ⇒ cloud build (Clerk login + relay awareness). Unset ⇒ local/self-host build. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Cloud build: price shown on the Upgrade screen. Default "€7 / month". */
  readonly VITE_PRO_PRICE_LABEL?: string;
}
