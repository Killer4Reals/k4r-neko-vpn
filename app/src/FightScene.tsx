import { useEffect, useRef, useState } from "react";
import { isMuted, muteTemporarily, play } from "./sound";

type Props = {
  /** Запрет запущен — держим сцену «в бою». */
  active: boolean;
  /** Счётчик нажатий: каждое нажатие проигрывает удар заново. */
  hits: number;
  /** Надпись о состоянии боя (локализуется на экране). */
  label: string;
  /** Одна строка пояснения рядом со сценой. */
  hint: string;
  /** Подсказка кнопки звука, когда звук выключен. */
  muteOnLabel: string;
  /** Подсказка кнопки звука, когда звук включён. */
  muteOffLabel: string;
};

/** Сколько бумажек разлетается от удара. Меньше — скучно, больше — рябь. */
const PAPERS = 10;

/**
 * Бой с РКН: маскот бьёт ногой, бюрократия разлетается вместе с бумагами.
 * Фон — нарисованная сцена целиком; поверх неё только эффекты: вспышка в точке
 * удара, тряска, разлетающиеся бумажки и звук. Так картинка остаётся картинкой,
 * а удар — ударом.
 */
export function FightScene({ active, hits, label, hint, muteOnLabel, muteOffLabel }: Props) {
  const [flash, setFlash] = useState(false);
  const [quiet, setQuiet] = useState(isMuted());
  const timers = useRef<number[]>([]);
  const reduce = useRef(false);
  const idle = !active && !flash;

  useEffect(() => {
    reduce.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  const fire = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    if (reduce.current) return;
    play("whoosh");
    const impact = window.setTimeout(() => {
      play("impact");
      setFlash(true);
    }, 130);
    const papers = window.setTimeout(() => play("papers"), 220);
    const calm = window.setTimeout(() => setFlash(false), 520);
    timers.current.push(impact, papers, calm);
  };

  // Первый заход в бой — проигрываем удар, дальше живём спокойно
  useEffect(() => {
    if (active) fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (hits > 0) fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const toggleQuiet = () => {
    const next = !quiet;
    setQuiet(next);
    muteTemporarily(next);
  };

  return (
    <div className={`fight${active ? " fight-live" : ""}${flash ? " fight-hit" : ""}${idle ? " fight-idle" : ""}`}>
      <span className="fight-art" aria-hidden>
        {flash && <span className="fight-flash" />}
        {flash && (
          <span className="fight-papers">
            {Array.from({ length: PAPERS }, (_, i) => (
              <span key={i} style={{ ["--i" as string]: i }} />
            ))}
          </span>
        )}
      </span>
      <span className="fight-copy">
        <span className="fight-status">{label}</span>
        <span className="fight-hint">{hint}</span>
      </span>
      <button className="fight-mute" onClick={toggleQuiet} title={quiet ? muteOnLabel : muteOffLabel}>
        {quiet ? "🔇" : "🔊"}
      </button>
    </div>
  );
}
