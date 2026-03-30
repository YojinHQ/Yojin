import { describe, expect, it, vi } from 'vitest';

import { NotificationBus } from '../../src/core/notification-bus.js';
import type { NotificationEvent } from '../../src/core/notification-bus.js';

describe('NotificationBus', () => {
  it('delivers events to subscribers', () => {
    const bus = new NotificationBus();
    const handler = vi.fn();
    bus.on('snap.ready', handler);

    const event: NotificationEvent = { type: 'snap.ready', snapId: 'snap-1' };
    bus.publish(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('does not deliver events to unsubscribed handlers', () => {
    const bus = new NotificationBus();
    const handler = vi.fn();
    const unsub = bus.on('snap.ready', handler);
    unsub();

    bus.publish({ type: 'snap.ready', snapId: 'snap-2' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not deliver events of a different type', () => {
    const bus = new NotificationBus();
    const handler = vi.fn();
    bus.on('snap.ready', handler);

    bus.publish({ type: 'insight.ready', insightId: 'ins-1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers for the same event', () => {
    const bus = new NotificationBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('action.created', h1);
    bus.on('action.created', h2);

    const event: NotificationEvent = { type: 'action.created', actionId: 'act-1' };
    bus.publish(event);

    expect(h1).toHaveBeenCalledWith(event);
    expect(h2).toHaveBeenCalledWith(event);
  });

  it('catches and logs handler errors without crashing', () => {
    const bus = new NotificationBus();
    const bad = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.on('snap.ready', bad);
    bus.on('snap.ready', good);

    bus.publish({ type: 'snap.ready', snapId: 'snap-3' });

    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it('delivers approval.requested events with full payload', () => {
    const bus = new NotificationBus();
    const handler = vi.fn();
    bus.on('approval.requested', handler);

    const event: NotificationEvent = {
      type: 'approval.requested',
      requestId: 'req-1',
      action: 'trade.execute',
      description: 'Buy 100 AAPL',
    };
    bus.publish(event);

    expect(handler).toHaveBeenCalledWith(event);
  });
});
