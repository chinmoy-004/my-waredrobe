"use client";

import { useCallback, useRef, useState } from "react";
import Webcam from "react-webcam";
import { motion } from "framer-motion";
import { Camera, X } from "lucide-react";

interface CameraCaptureProps {
  facingMode: "user" | "environment";
  label: string;
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

/**
 * Live wardrobe camera. Produces a bounded JPEG data URL in-session —
 * bytes only ever leave the device through the signed Cloudinary flow.
 */
export default function CameraCapture({
  facingMode,
  label,
  onCapture,
  onClose,
}: CameraCaptureProps) {
  const webcamRef = useRef<Webcam | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capture = useCallback(() => {
    const shot = webcamRef.current?.getScreenshot();
    if (shot) onCapture(shot);
    else setError("Could not capture a frame — check camera permissions.");
  }, [onCapture]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/90 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <motion.div
        initial={{ scale: 0.94, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 16 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-gold/25 bg-coal"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-gold">Live capture</p>
            <p className="mt-1 font-display text-lg text-ivory">{label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="rounded-full border border-line p-2 text-mute transition hover:border-gold/40 hover:text-ivory"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-ink">
          <Webcam
            ref={webcamRef}
            audio={false}
            mirrored={facingMode === "user"}
            screenshotFormat="image/jpeg"
            screenshotQuality={0.85}
            videoConstraints={{ facingMode, width: { ideal: 1920 }, height: { ideal: 1440 } }}
            onUserMediaError={() =>
              setError(
                "Camera unavailable. Grant permission, and make sure you are on HTTPS or localhost.",
              )
            }
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-6 rounded-xl border border-gold/30" />
          <div className="pointer-events-none absolute left-1/2 top-6 h-4 w-px -translate-x-1/2 bg-gold/60" />
          {error && (
            <div className="absolute inset-x-0 bottom-0 bg-ink/85 px-5 py-3 text-center text-xs text-gold-soft">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-4">
          <p className="text-xs text-mute">
            Center the piece inside the gilded frame. JPEG, 5 MB max.
          </p>
          <button
            type="button"
            onClick={capture}
            className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-ink transition hover:bg-gold-soft"
          >
            <Camera className="h-4 w-4" />
            Capture
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
