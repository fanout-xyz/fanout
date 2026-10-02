"use client";

import { ClipboardPaste } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parsePaymentRequest, type PaymentRequest } from "@/lib/payment-request";
import { BackButton } from "./wallet-ui";

type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

type CameraState = "starting" | "on" | "denied" | "unavailable";

/**
 * Scan a QR to pay. Uses the browser's own QR reader where there is one (Chrome on Android),
 * otherwise jsQR on video frames (Safari). Reads Fanout pay links, plain addresses and
 * `ethereum:` URIs; anything else gets a friendly "not a payment code".
 */
export function ScanView({ onResult, onClose }: { onResult: (req: PaymentRequest) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [notPayment, setNotPayment] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) return setCamera("unavailable");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (err) {
        return setCamera(err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "unavailable");
      }
      if (stopped || !videoRef.current) return stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setCamera("on");

      const native = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
      const jsQR = native ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (stopped || done.current) return;
        if (video.readyState >= 2 && video.videoWidth) {
          let text: string | undefined;
          if (native) {
            text = (await native.detect(video).catch(() => []))[0]?.rawValue;
          } else if (jsQR && ctx) {
            // Scan a centred square at most 640px wide: plenty for a QR, cheap on phones.
            const side = Math.min(video.videoWidth, video.videoHeight, 640);
            canvas.width = canvas.height = side;
            ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, side, side);
            text = jsQR(ctx.getImageData(0, 0, side, side).data, side, side, { inversionAttempts: "dontInvert" })?.data;
          }
          if (text) {
            const req = parsePaymentRequest(text);
            if (req) {
              done.current = true;
              navigator.vibrate?.(30);
              return onResult(req);
            }
            setNotPayment(true);
          }
        }
        frame = window.setTimeout(() => void tick(), 150);
      };
      void tick();
    }

    void start();
    return () => {
      stopped = true;
      window.clearTimeout(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  function submitPasted(e: FormEvent) {
    e.preventDefault();
    const req = parsePaymentRequest(pasted);
    if (!req) return setPasteError("That isn't a payment link or an address.");
    onResult(req);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setPasted(text);
      const req = parsePaymentRequest(text);
      if (req) onResult(req);
      else setPasteError("What you copied isn't a payment link or an address.");
    } catch {
      setPasteError("Couldn't read what you copied. Paste it into the box instead.");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5 px-5 pt-4 pb-6">
      <BackButton onClick={onClose} label="Back" />
      <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">Scan to pay</h1>

      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-band-dark">
        <video ref={videoRef} playsInline muted className="size-full object-cover" aria-label="Camera view" />
        {camera === "on" && (
          <div className="pointer-events-none absolute inset-[14%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" aria-hidden />
        )}
        {camera !== "on" && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-cream" role="status">
            {camera === "starting" && <p>Starting the camera…</p>}
            {camera === "denied" && <p>Camera access is off. Allow it in your browser settings, or paste a link below.</p>}
            {camera === "unavailable" && <p>No camera here. Paste a payment link or an address below.</p>}
          </div>
        )}
      </div>
      <p className="text-center text-sm text-muted" role="status" aria-live="polite">
        {notPayment ? "That code isn't a payment. Point at a Fanout pay code." : "Point at a Fanout pay code or an address QR."}
      </p>

      <form onSubmit={submitPasted} noValidate className="grid gap-2">
        <Label htmlFor="scan-paste">Or paste a link or address</Label>
        <div className="flex gap-2">
          <Input
            id="scan-paste"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://wallet.fanout.tech/pay… or 0x…"
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              setPasteError(null);
            }}
            aria-invalid={!!pasteError}
            aria-describedby={pasteError ? "scan-paste-error" : undefined}
            className="h-12 font-mono text-[14px]"
          />
          <Button type="button" variant="secondary" size="icon" className="size-12" onClick={() => void pasteFromClipboard()} aria-label="Paste">
            <ClipboardPaste />
          </Button>
        </div>
        {pasteError && (
          <p id="scan-paste-error" className="text-sm text-danger">
            {pasteError}
          </p>
        )}
        <Button type="submit" variant="secondary" className="h-12" disabled={!pasted.trim()}>
          Continue
        </Button>
      </form>
    </div>
  );
}
