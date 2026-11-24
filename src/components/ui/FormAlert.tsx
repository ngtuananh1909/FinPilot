/**
 * Always-mounted live region so screen readers announce a message that appears later.
 * Renders the visible box only when there is a message.
 */
export function FormAlert({ message, tone = "error", id }: { message: string | null | undefined; tone?: "error" | "info"; id?: string }) {
  const style =
    tone === "error"
      ? "border-error/40 bg-error-container text-on-error-container"
      : "border-outline-variant bg-surface-container-low text-on-surface";
  return (
    <div role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} id={id}>
      {message ? <p className={`rounded-control border px-4 py-3 text-body-md ${style}`}>{message}</p> : null}
    </div>
  );
}
