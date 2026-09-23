export function when(d: string | Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const STATUS_TONE: Record<string, string> = {
  ready: "warn",
  running: "",
  queued: "",
  failed: "bad",
  approved: "good",
  posted: "good",
  rejected: "",
};
