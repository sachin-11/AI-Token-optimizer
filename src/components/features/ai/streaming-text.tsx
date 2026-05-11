"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

interface StreamingTextProps {
  text: string;
  active?: boolean;
  className?: string;
  chunkMs?: number;
  onComplete?: () => void;
}

export function StreamingText({
  text,
  active = true,
  className,
  chunkMs = 18,
  onComplete,
}: StreamingTextProps) {
  const [shown, setShown] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!active) {
      setShown(0);
      return;
    }
    if (!text.length) {
      setShown(0);
      return;
    }

    setShown(0);
    let i = 0;
    const id = window.setInterval(() => {
      i = Math.min(i + 2, text.length);
      setShown(i);
      if (i >= text.length) {
        window.clearInterval(id);
        onCompleteRef.current?.();
      }
    }, chunkMs);

    return () => window.clearInterval(id);
  }, [text, active, chunkMs]);

  const slice = text.slice(0, shown);
  const cursor = Boolean(active && text.length && shown < text.length);

  return (
    <p className={cn("text-sm leading-relaxed text-foreground", className)}>
      {slice}
      {cursor ? (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" aria-hidden />
      ) : null}
    </p>
  );
}
