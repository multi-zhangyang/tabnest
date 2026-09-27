export const isExtension = Boolean(globalThis.chrome?.bookmarks?.getTree)

const queues = new Map<string, Promise<unknown>>()

export async function withLock<T>(
  name: string,
  operation: () => Promise<T>
): Promise<T> {
  if (globalThis.navigator?.locks)
    return navigator.locks.request(`tabnest:${name}`, operation)
  const previous = queues.get(name) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  queues.set(name, current)
  try {
    return await current
  } finally {
    if (queues.get(name) === current) queues.delete(name)
  }
}
