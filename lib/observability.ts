export interface ErrorEvent {
  context: string;
  message: string;
  event_id?: string;
  display_id?: string;
  timestamp: string;
}

export function reportError(event: ErrorEvent): void {
  if (process.env.NODE_ENV === "development") {
    console.error("[EventTimer]", event.context, event.message);
  }
  // TODO Phase 6: send to error monitoring service
}
