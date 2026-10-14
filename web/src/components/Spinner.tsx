import { LoaderCircle } from "lucide-react";

export function Spinner({
  label = "Loading",
  inline = false,
  full = false,
}: {
  label?: string;
  inline?: boolean;
  full?: boolean;
}) {
  return (
    <span
      className={`loading-indicator${inline ? " loading-inline" : ""}${full ? " loading-page" : ""}`}
      role="status"
      aria-label={label}
    >
      <LoaderCircle className="loading-spinner" aria-hidden="true" />
    </span>
  );
}
