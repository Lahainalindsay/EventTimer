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
  if (event.context === "event_creation") {
    console.error("[EventTimer:create-event]", {
      context: event.context,
      message: event.message,
      event_id: event.event_id,
      error_code: event.error_code,
      error_details: event.error_details,
      error_hint: event.error_hint,
      timestamp: event.timestamp,
    });
  } else if (process.env.NODE_ENV === "development") {
    console.error("[EventTimer]", event);
  }
  // TODO Phase 6: send to error monitoring service
}
