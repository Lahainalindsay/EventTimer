export interface ErrorEvent {
  context: string;
  message: string;
  event_id?: string;
  display_id?: string;
  error_code?: string;
  error_details?: string;
  error_hint?: string;
  timestamp: string;
}

export function reportError(event: ErrorEvent): void {
  if (process.env.NODE_ENV === "development") {
    console.error("[EventTimer]", event);
  }
  // TODO Phase 6: send to error monitoring service
}
