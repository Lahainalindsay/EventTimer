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
