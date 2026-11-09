"use client";

import { useEffect } from "react";
import { captureRep } from "@/lib/rep-client";

// Remembers a sales-rep code from ?rep=code for 30 days (first rep wins), so it is still there when the customer pays.
export default function RepCapture() {
  useEffect(() => {
    try { captureRep(window.location.search, localStorage); } catch { /* storage blocked: the link just will not be remembered */ }
  }, []);
  return null;
}
