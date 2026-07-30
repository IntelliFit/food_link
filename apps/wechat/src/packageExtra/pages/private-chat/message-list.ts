export interface ChronologicalMessage {
  id: string
  created_at: string
}

function messageTimestamp(message: ChronologicalMessage): number {
  const timestamp = new Date(message.created_at).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function orderMessagesByTime<T extends ChronologicalMessage>(messages: T[]): T[] {
  return [...messages].sort((left, right) => {
    const timeDiff = messageTimestamp(left) - messageTimestamp(right)
    if (timeDiff !== 0) return timeDiff
    return left.id.localeCompare(right.id)
  })
}

export function mergeMessagesByID<T extends ChronologicalMessage>(current: T[], incoming: T[]): T[] {
  const byID = new Map<string, T>()
  current.forEach((message) => byID.set(message.id, message))
  incoming.forEach((message) => byID.set(message.id, message))
  return orderMessagesByTime([...byID.values()])
}
