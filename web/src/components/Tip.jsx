import { useId } from "react";

export default function Tip({ text }) {
  const tipId = useId();

  return (
    <span className="tooltip">
      <span className="tooltip-trigger" aria-describedby={tipId} tabIndex={0}>?</span>
      <span id={tipId} role="tooltip" className="tooltip-content">
        {text}
      </span>
    </span>
  );
}
