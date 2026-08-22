export type LatestRequest = {
  id: number
  signal: AbortSignal
}

export type LatestRequestGate = {
  begin: () => LatestRequest
  isLatest: (id: number) => boolean
  dispose: () => void
}

export function createLatestRequestGate(): LatestRequestGate {
  let latestID = 0
  let controller: AbortController | null = null
  let disposed = false

  return {
    begin() {
      controller?.abort()
      controller = new AbortController()
      disposed = false
      latestID += 1
      return { id: latestID, signal: controller.signal }
    },
    isLatest(id) {
      return !disposed && id === latestID
    },
    dispose() {
      disposed = true
      latestID += 1
      controller?.abort()
      controller = null
    },
  }
}
