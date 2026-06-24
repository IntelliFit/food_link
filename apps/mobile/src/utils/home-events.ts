export const HOME_DASHBOARD_REFRESH_EVENT = 'home-dashboard:refresh'
export const HOME_INTAKE_DATA_CHANGED_EVENT = 'home-intake:changed'
export const FOOD_EXPIRY_CHANGED_EVENT = 'food-expiry:changed'

type HomeDashboardEventName =
  | typeof HOME_DASHBOARD_REFRESH_EVENT
  | typeof HOME_INTAKE_DATA_CHANGED_EVENT
  | typeof FOOD_EXPIRY_CHANGED_EVENT

export interface HomeDashboardEventPayload {
  date?: string
  force?: boolean
}

type Listener = (payload?: HomeDashboardEventPayload) => void

const listenersByEvent = new Map<HomeDashboardEventName, Set<Listener>>()

function getListeners(event: HomeDashboardEventName): Set<Listener> {
  let next = listenersByEvent.get(event)
  if (!next) {
    next = new Set()
    listenersByEvent.set(event, next)
  }
  return next
}

export function onHomeDashboardEvent(
  event: HomeDashboardEventName,
  listener: Listener,
): () => void {
  const set = getListeners(event)
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) {
      listenersByEvent.delete(event)
    }
  }
}

export function emitHomeDashboardEvent(
  event: HomeDashboardEventName,
  payload?: HomeDashboardEventPayload,
): void {
  const set = listenersByEvent.get(event)
  if (!set || set.size === 0) return
  for (const listener of Array.from(set)) {
    listener(payload)
  }
}

export function emitHomeDashboardRefreshEvent(payload?: HomeDashboardEventPayload): void {
  emitHomeDashboardEvent(HOME_DASHBOARD_REFRESH_EVENT, payload)
}

export function emitHomeIntakeDataChangedEvent(payload?: HomeDashboardEventPayload): void {
  emitHomeDashboardEvent(HOME_INTAKE_DATA_CHANGED_EVENT, payload)
}

export function emitFoodExpiryChangedEvent(payload?: HomeDashboardEventPayload): void {
  emitHomeDashboardEvent(FOOD_EXPIRY_CHANGED_EVENT, payload)
}
