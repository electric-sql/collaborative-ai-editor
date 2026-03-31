/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YJS_SERVICE_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
