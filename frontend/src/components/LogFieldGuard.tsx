/**
 * src/components/LogFieldGuard.tsx
 * =================================
 * Drop-in wrapper for any <textarea> that holds log input or output text.
 * Shows a live character counter that turns amber → red as the user approaches
 * the field limits, and fires a toast when the hard limit is exceeded.
 *
 * Usage:
 *   <LogFieldGuard value={inputText} fieldLabel="Input" onChange={setInputText}>
 *     {(props) => <textarea {...props} placeholder="Paste log input here…" />}
 *   </LogFieldGuard>
 */

import { useEffect, useRef } from "react";
import { LOG_FIELD_WARN, LOG_FIELD_MAX, toast } from "../utils/toast";

interface LogFieldGuardProps {
  value: string;
  fieldLabel: string;
  onChange: (val: string) => void;
  /** Render prop — receives {value, onChange} to spread onto your textarea */
  children: (props: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  }) => React.ReactNode;
}

export function LogFieldGuard({
  value,
  fieldLabel,
  onChange,
  children,
}: LogFieldGuardProps) {
  const len        = value.length;
  const isWarn     = len > LOG_FIELD_WARN && len <= LOG_FIELD_MAX;
  const isOver     = len > LOG_FIELD_MAX;
  const pct        = Math.min(len / LOG_FIELD_MAX, 1);
  const lastToast  = useRef(0);

  // Fire a toast when crossing the hard limit (throttled to once per 3s)
  useEffect(() => {
    if (isOver && Date.now() - lastToast.current > 3000) {
      toast.error(
        `${fieldLabel} is too large (${len.toLocaleString()} chars). Max is ${LOG_FIELD_MAX.toLocaleString()}.`,
        { id: `guard-${fieldLabel}`, duration: 5000 },
      );
      lastToast.current = Date.now();
    }
  }, [isOver, len, fieldLabel]);

  const counterColor = isOver ? "#DC2626" : isWarn ? "#D97706" : "#8FA3BF";

  // Progress bar colour
  const barColor = isOver ? "#DC2626" : isWarn ? "#D97706" : "#005EB8";

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {children({
        value,
        onChange: (e) => onChange(e.target.value),
      })}

      {/* Only show the counter once the user has typed something meaningful */}
      {len > 100 && (
        <div style={{ marginTop: 4 }}>
          {/* Progress bar */}
          <div
            style={{
              height: 2,
              background: "#E3EAF3",
              borderRadius: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct * 100}%`,
                background: barColor,
                transition: "width 0.2s, background 0.2s",
              }}
            />
          </div>

          {/* Character count */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              fontSize: 11,
              color: counterColor,
              marginTop: 2,
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: isOver ? 700 : 500,
            }}
          >
            {len.toLocaleString()}
            {isOver
              ? ` / ${LOG_FIELD_MAX.toLocaleString()} — too large`
              : isWarn
              ? ` / ${LOG_FIELD_MAX.toLocaleString()} — getting large`
              : ` / ${LOG_FIELD_MAX.toLocaleString()}`}
          </div>
        </div>
      )}
    </div>
  );
}

export default LogFieldGuard;