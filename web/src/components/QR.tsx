import { useEffect, useState } from "react";
import QRCode from "qrcode";
export function QR({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(value, {
      width: 440,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive)
          setError("QR code could not be generated. Use the text below.");
      });
    return () => {
      alive = false;
    };
  }, [value]);
  return src ? (
    <img className="qr-image" src={src} alt={label} />
  ) : (
    <p role="status">{error || "Generating QR code…"}</p>
  );
}
