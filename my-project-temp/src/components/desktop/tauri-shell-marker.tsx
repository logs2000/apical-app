"use client";

import { useEffect } from "react";
import { IS_TAURI } from "@/lib/desktop/tauri-bridge";

/** Sets `data-tauri` on `<html>` so globals-tauri.css overrides apply. */
export function TauriShellMarker() {
  useEffect(() => {
    if (!IS_TAURI) return;
    document.documentElement.setAttribute("data-tauri", "");
    return () => {
      document.documentElement.removeAttribute("data-tauri");
    };
  }, []);

  return null;
}
