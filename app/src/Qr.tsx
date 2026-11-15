import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

type Props = {
  t: (k: string) => string;
  /** Ссылка подписки или ключ vless://, который показываем. */
  value: string;
  onCopy: () => void;
};

/**
 * QR подписки: показать с экрана на телефон.
 * Рисуем в canvas, чтобы картинка не тянулась с внешнего сервиса — у нас и так
 * приватность в основе, отдавать ссылку чужому сайту нельзя.
 */
export function QrSheet({ t, value, onCopy }: Props) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canvas.current) return;
    if (!value.trim()) return;
    QRCode.toCanvas(canvas.current, value, { margin: 1, width: 260, errorCorrectionLevel: "M" }, (e) =>
      setError(e ? String(e) : ""),
    );
  }, [value]);

  return (
    <div className="qr-sheet">
      <div className="qr-box">
        {value.trim() ? (
          <canvas ref={canvas} width={260} height={260} />
        ) : (
          <div className="qr-empty">{t("qrEmpty")}</div>
        )}
      </div>
      <div className="qr-side">
        <b>{t("qrTitle")}</b>
        <p className="muted">{t("qrHint")}</p>
        <div className="qr-actions">
          <button className="btn" style={{ width: "auto", paddingInline: 14 }} onClick={onCopy}>
            {t("copyLink")}
          </button>
        </div>
        {error && <div className="muted warn-txt">{error}</div>}
      </div>
    </div>
  );
}
