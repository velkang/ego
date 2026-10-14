import { useEffect, useRef, useState } from "react";
export function Scanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    callback = useRef(onScan),
    [error, setError] = useState("");
  callback.current = onScan;
  useEffect(() => {
    let alive = true,
      stream: MediaStream | null = null,
      timer = 0;
    const stop = () => stream?.getTracks().forEach((t) => t.stop());
    async function open() {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera unavailable");
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!alive) {
        stop();
        return;
      }
      const { default: decode } = await import("jsqr");
      if (!alive) {
        stop();
        return;
      }
      const v = video.current!;
      v.srcObject = stream;
      await v.play();
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Camera processing unavailable");
      const scan = () => {
        if (!alive) return;
        if (v.readyState >= 2) {
          const scale = Math.min(1, 720 / v.videoWidth);
          canvas.width = Math.floor(v.videoWidth * scale);
          canvas.height = Math.floor(v.videoHeight * scale);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height),
            result = decode(image.data, image.width, image.height);
          if (result) {
            stop();
            callback.current(result.data);
            return;
          }
        }
        timer = window.setTimeout(scan, 200);
      };
      scan();
    }
    void open().catch(() => {
      stop();
      if (alive)
        setError("Camera unavailable. Paste the QR link or code below.");
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
      if (video.current) video.current.srcObject = null;
    };
  }, []);
  return (
    <section>
      <div className="scanner">
        <video
          ref={video}
          className="scanner-video"
          autoPlay
          muted
          playsInline
          aria-label="QR scanning camera"
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="text-button" onClick={onClose}>
        Close camera
      </button>
    </section>
  );
}
