export const COMPUTE_VERSION = 3
export type ComputeOptions = { signal?: AbortSignal; session?: number; dataRevision?: number; requestRevision?: number }
export type ComputeEnvelope = {
  version: number
  id: number
  task: string
  payload: unknown
  session?: number
  dataRevision?: number
  requestRevision?: number
}
type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
  identity: ComputeOptions
}
let worker: Worker | undefined
let serial = 0
let idleTimer: ReturnType<typeof setTimeout> | undefined
const disposers = new Set<() => void>()
export function onComputeDispose(callback: () => void) {
  disposers.add(callback)
}
let retained = 0
export const computeRetained = () => retained > 0
export function retainCompute() {
  retained++
  clearTimeout(idleTimer)
  return () => { retained = Math.max(0, retained - 1); idle() }
}
function disposeWorker() {
  clearTimeout(idleTimer)
  worker?.terminate()
  worker = undefined
  for (const dispose of disposers) dispose()
}
function idle() {
  clearTimeout(idleTimer)
  if (!pending.size && !retained) idleTimer = setTimeout(disposeWorker, 30000)
}
const pending = new Map<number, Pending>()
function fail() {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.cleanup()
    request.reject(new Error("计算失败"))
  }
  pending.clear()
  disposeWorker()
}
export function compute<T>(task: string, payload: unknown, options: ComputeOptions = {}): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  clearTimeout(idleTimer)
  try {
    if (!worker) {
      worker = new Worker(
        new URL("../workers/compute-worker.ts", import.meta.url),
        { type: "module" }
      )
      worker.onmessage = (event) => {
        const { version, id, value, error, session, dataRevision, requestRevision } = event.data
        const request = pending.get(id)
        if (!request) return
        pending.delete(id)
        clearTimeout(request.timer)
        request.cleanup()
        if (version !== COMPUTE_VERSION || error ||
            session !== request.identity.session || dataRevision !== request.identity.dataRevision || requestRevision !== request.identity.requestRevision)
          request.reject(new Error(error || "计算版本不兼容"))
        else request.resolve(value)
        idle()
      }
      worker.onerror = fail
      worker.onmessageerror = fail
    }
  } catch (error) {
    return Promise.reject(error)
  }
  const id = ++serial
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(fail, 10000)
    const cancel = () => {
      if (!pending.delete(id)) return
      clearTimeout(timer)
      try { worker?.postMessage({ version: COMPUTE_VERSION, task: "cancel", id }) } catch { /* Cancellation is already local. */ }
      options.signal?.removeEventListener("abort", cancel)
      reject(new DOMException("Aborted", "AbortError"))
      idle()
    }
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
      identity: options,
      cleanup: () => options.signal?.removeEventListener("abort", cancel),
    })
    options.signal?.addEventListener("abort", cancel, { once: true })
    try {
      const { session, dataRevision, requestRevision } = options
      worker!.postMessage({ version: COMPUTE_VERSION, id, task, payload, session, dataRevision, requestRevision })
    } catch {
      fail()
    }
  })
}
