import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('notification-bus');

export type NotificationEvent =
  | { type: 'snap.ready'; snapId: string }
  | { type: 'insight.ready'; insightId: string }
  | { type: 'action.created'; actionId: string; verdict: string; ticker?: string }
  | { type: 'alert.promoted'; alertId: string; symbol: string; severity: number; thesis: string }
  | { type: 'approval.requested'; requestId: string; action: string; description: string };

export type NotificationEventType = NotificationEvent['type'];

type HandlerFor<T extends NotificationEventType> = (event: Extract<NotificationEvent, { type: T }>) => void;

export class NotificationBus {
  private readonly handlers = new Map<string, Set<(event: never) => void>>();

  /** Subscribe to a notification event type. Returns an unsubscribe function. */
  on<T extends NotificationEventType>(type: T, handler: HandlerFor<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const set = this.handlers.get(type);
    set?.add(handler as (event: never) => void);

    return () => {
      set?.delete(handler as (event: never) => void);
    };
  }

  /** Publish to all subscribers. Handler errors are caught — one bad subscriber can't break others. */
  publish(event: NotificationEvent): void {
    const set = this.handlers.get(event.type);
    if (!set || set.size === 0) return;

    for (const handler of set) {
      try {
        const result = (handler as (event: NotificationEvent) => void | Promise<void>)(event);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            logger.error('Notification handler error', { type: event.type, error: err });
          });
        }
      } catch (err) {
        logger.error('Notification handler error', { type: event.type, error: err });
      }
    }
  }
}
