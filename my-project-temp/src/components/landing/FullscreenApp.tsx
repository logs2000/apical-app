"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/apical/app-shell";
import { useAuth } from "@/components/auth/AuthDialog";

/**
 * FullscreenApp — overlays the entire viewport with the real Apical app shell
 * when the user has launched the web app. Mimics opening the actual product.
 */
export function FullscreenApp() {
  const { appOpen, closeApp, user } = useAuth();

  // Lock the underlying landing page's scroll while the app overlay is open —
  // otherwise the wheel "leaks" through and scrolls the hidden marketing page.
  React.useEffect(() => {
    if (!appOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [appOpen]);

  return (
    <AnimatePresence>
      {appOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[200] bg-background"
        >
          <AppShell user={user} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
