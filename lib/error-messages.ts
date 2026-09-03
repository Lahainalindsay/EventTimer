export function formatUserError(context: string, supabaseError?: { message?: string }): string {
  const message = supabaseError?.message?.toLowerCase() ?? "";

  if (
    message.includes("permission")
    || message.includes("not allowed")
    || message.includes("row-level security")
    || message.includes("rls")
  ) {
    return "You don't have permission to do that.";
  }

  switch (context) {
    case "runtime_mutation":
      return "Timer sync failed. Another operator may have made a change — your screen will update.";
    case "pairing_failed":
      return "Pairing failed. Check the code and try again.";
    case "display_revoked":
      return "This display has been revoked.";
    case "event_not_found":
      return "Event not found.";
    case "permission_denied":
      return "You don't have permission to do that.";
    case "template_save":
      return "Template save failed.";
    case "history_load":
      return "Could not load timing history.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function formatEventCreationError(error?: { code?: string; message?: string }): string {
  const code = error?.code?.toUpperCase() ?? "";
  const message = error?.message?.toLowerCase() ?? "";
  if (code === "PGRST202" || message.includes("could not find the function") || message.includes("does not exist")) {
    return "Event creation is not available yet. Please contact the administrator.";
  }
  if (code === "42501" || message.includes("permission") || message.includes("row-level security")) {
    return "You don't have permission to create this event.";
  }
  if (code === "22007" || code === "22023" || message.includes("event date") || message.includes("event name")) {
    return "Enter a valid event name and date.";
  }
  if (code.startsWith("23")) return "Event creation could not be completed because the data was invalid.";
  return "Event creation failed. Please try again.";
}
