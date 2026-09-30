declare const __TABNEST_VERSION__: string
declare const __TABNEST_BUILD_ID__: string
export const BUILD_INFO = {
  version: typeof __TABNEST_VERSION__ === "undefined" ? "dev" : __TABNEST_VERSION__,
  buildId: typeof __TABNEST_BUILD_ID__ === "undefined" ? "dev" : __TABNEST_BUILD_ID__,
}
