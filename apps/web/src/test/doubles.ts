// TEST-ONLY. The shape a DOM test captures from a mocked `toast(...)`.

/** One captured `toast(...)` call. */
export interface CapturedToast {
  title?: string;
  description?: string;
  variant?: string;
}
