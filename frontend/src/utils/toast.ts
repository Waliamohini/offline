/**
 * src/utils/toast.ts
 * ==================
 * Centralised toast helper.  Import and call anywhere in the frontend.
 *
 * Install once:  npm install react-hot-toast
 * Add <Toaster /> once in App.tsx (already done).
 *
 * Usage:
 *   import { toast, validateLength, toastApiError } from "@/utils/toast";
 *   toast.success("Logs uploaded!");
 *   toast.error("Something went wrong.");
 *   toast.fieldError("Input text is too long.");
 *
 *   // Before any log upload / chat-paste submission:
 *   if (!validateLogRow(inputText, outputText)) return;
 */

import _toast, { type ToastOptions } from "react-hot-toast";

// ─────────────────────────────────────────────────────────────────────────────
//  Field-length limits
//  These match the Postgres TEXT columns — no hard cap, but we warn early
//  because very large inputs/outputs slow down JSONB indexing and the UI.
// ─────────────────────────────────────────────────────────────────────────────

/** Soft warn threshold for a single log input/output cell (characters). */
export const LOG_FIELD_WARN  = 10_000;

/** Hard error threshold — we block submission above this. */
export const LOG_FIELD_MAX   = 50_000;

/** Max total paste size for the chat-history textarea (characters). */
export const CHAT_PASTE_MAX  = 200_000;

// ─────────────────────────────────────────────────────────────────────────────
//  Core validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a generic field length.
 * Shows a toast and returns false when over the limit.
 * Returns true when the value is within the limit.
 */
export function validateLength(
  fieldLabel: string,
  value: string,
  maxLength: number,
): boolean {
  if (value.length <= maxLength) return true;
  _toast.error(
    `${fieldLabel} is too long — ${value.length.toLocaleString()} chars entered, max is ${maxLength.toLocaleString()}.`,
    { duration: 5000, id: `len-${fieldLabel}` },
  );
  return false;
}

/**
 * Validate a single log row's input and output fields before upload.
 * Shows a descriptive toast for each field that is over the limit.
 * Returns true only when both fields are within limits.
 *
 * @example
 *   if (!validateLogRow(inputText, outputText)) return;
 */
export function validateLogRow(input: string, output: string): boolean {
  let ok = true;

  if (input.length > LOG_FIELD_MAX) {
    _toast.error(
      `Input field is too large (${input.length.toLocaleString()} chars). Max is ${LOG_FIELD_MAX.toLocaleString()}. Trim before uploading.`,
      { duration: 6000, id: "log-input-size" },
    );
    ok = false;
  } else if (input.length > LOG_FIELD_WARN) {
    _toast(
      `⚠️ Input field is large (${input.length.toLocaleString()} chars). Consider trimming for better performance.`,
      { duration: 4000, id: "log-input-warn", icon: "⚠️" },
    );
    // warn only — don't block
  }

  if (output.length > LOG_FIELD_MAX) {
    _toast.error(
      `Output field is too large (${output.length.toLocaleString()} chars). Max is ${LOG_FIELD_MAX.toLocaleString()}. Trim before uploading.`,
      { duration: 6000, id: "log-output-size" },
    );
    ok = false;
  } else if (output.length > LOG_FIELD_WARN) {
    _toast(
      `⚠️ Output field is large (${output.length.toLocaleString()} chars). Consider trimming for better performance.`,
      { duration: 4000, id: "log-output-warn", icon: "⚠️" },
    );
  }

  return ok;
}

/**
 * Validate a chat-history paste blob before sending to /sdcc/ingest-chat.
 * Returns false (with a toast) if the paste is over CHAT_PASTE_MAX.
 */
export function validateChatPaste(text: string): boolean {
  if (text.length <= CHAT_PASTE_MAX) return true;
  _toast.error(
    `Chat history is too large (${(text.length / 1000).toFixed(0)} KB). Paste a smaller excerpt or split it into multiple uploads.`,
    { duration: 6000, id: "chat-paste-size" },
  );
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Server-error extractor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull the human-readable message from an Axios/fetch error and show it as a
 * toast.  The backend returns detail as a plain string.
 */
export function toastApiError(err: unknown, fallback = "Something went wrong."): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detail = (err as any)?.response?.data?.detail;
  const msg = typeof detail === "string" ? detail : fallback;
  _toast.error(msg, { duration: 5000 });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Re-export hot-toast API so callers only need one import
// ─────────────────────────────────────────────────────────────────────────────

export const toast = {
  success:    _toast.success,
  error:      _toast.error,
  loading:    _toast.loading,
  dismiss:    _toast.dismiss,
  promise:    _toast.promise,
  /** Convenience: ⚠️ icon, 4-second duration, for field-level validation */
  fieldError: (msg: string, opts?: ToastOptions) =>
    _toast.error(msg, { duration: 4000, icon: "⚠️", ...opts }),
};

export default toast;