/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DURABLE_STREAMS_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
