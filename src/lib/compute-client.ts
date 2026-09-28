type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}
let worker: Worker | undefined
let serial = 0
const pending = new Map<number, Pending>()
export function compute<T>(task: string, payload: unknown): Promise<T> {
  if (!worker) {
    worker = new Worker(
      new URL("../workers/compute-worker.ts", import.meta.url),
      { type: "module" }
    )
    worker.onmessage = (event) => {
      const { id, value, error } = event.data
      const request = pending.get(id)
      pending.delete(id)
      if (error) request?.reject(new Error(error))
      else request?.resolve(value)
    }
    worker.onerror = () => {
      for (const request of pending.values())
        request.reject(new Error("计算失败"))
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  const id = ++serial
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    worker!.postMessage({ id, task, payload })
  })
}
