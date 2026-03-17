/**
 * Hook system — lifecycle hooks that plugins can register.
 */

export type HookEvent =
  | "message:incoming"
  | "message:outgoing"
  | "provider:before_complete"
  | "provider:after_complete"
  | "channel:connected"
  | "channel:disconnected";

export type HookHandler = (event: HookEvent, data: unknown) => Promise<void>;

export interface HookRegistry {
  register(event: HookEvent, handler: HookHandler): void;
  emit(event: HookEvent, data: unknown): Promise<void>;
}
