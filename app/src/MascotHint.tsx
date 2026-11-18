import { useEffect, useState } from "react";

/** Какая поза маскота соответствует смыслу подсказки. */
export type Pose = 1 | 2 | 3 | 4 | 5 | 6;

type Props = {
  screen: string;
  text: string;
  pose?: Pose;
  /** Показывать автоматически при первом визите. */
  auto?: boolean;
};

/**
 * Помощник: маскот говорит, что тут можно сделать. Показывается один раз на
 * вкладку, потом живёт под кнопкой «?». Отключается насовсем одной кнопкой.
 */
export function MascotHint({ screen, text, pose = 1, auto = true }: Props) {
  const dismissedKey = `k4r.hint.dismissed.${screen}`;
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(dismissedKey) === "1";
    const seen = localStorage.getItem(`k4r.hint.seen.${screen}`) === "1";
    if (!dismissed && auto && !seen) {
      setOpen(true);
      localStorage.setItem(`k4r.hint.seen.${screen}`, "1");
    }
  }, [dismissedKey, screen, auto]);

  if (hidden) return null;

  return (
    <div className="hint-wrap">
      {!open && (
        <button className="hint-fab" onClick={() => setOpen(true)} aria-label="Подсказка">
          ?
        </button>
      )}
      {open && (
        <div className="hint-bubble" role="status">
          <img src={`/fx/pose-${pose}.webp`} alt="" draggable={false} />
          <div className="hint-body">
            <p>{text}</p>
            <div className="hint-actions">
              <button className="ghost-btn" onClick={() => setOpen(false)}>
                Понятно
              </button>
              <button
                className="ghost-btn"
                onClick={() => {
                  localStorage.setItem(dismissedKey, "1");
                  setHidden(true);
                }}
              >
                Больше не показывать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
