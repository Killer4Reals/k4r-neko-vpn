import { useEffect, useRef, useState } from "react";
import { isMuted, muteTemporarily, play } from "./sound";

type Props = {
  /** Запрет запущен — держим сцену «в бою». */
  active: boolean;
  /** Счётчик нажатий: каждое нажатие проигрывает удар заново. */
  hits: number;
};

const KICK = Array.from({ length: 9 }, (_, i) => `/fx/kick-${i + 1}.webp`);
const RKN = Array.from({ length: 9 }, (_, i) => `/fx/rkn-${i + 1}.webp`);

/**
 * Бой с РКН: маскот бьёт ногой, бюрократия разлетается вместе с бумагами.
 * Кадры — из нарисованных спрайтов, эффекты и звук — код.
 */
export function FightScene({ active, hits }: Props) {
  const [frame, setFrame] = useState(0);
  const [flash, setFlash] = useState(false);
  const [quiet, setQuiet] = useState(isMuted());
  const timers = useRef<number[]>([]);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  const fire = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    if (reduce.current) return;
    play("whoosh");
    // 9 кадров удара: замах → контакт → отлёт
    for (let i = 0; i < KICK.length; i++) {
      const id = window.setTimeout(() => {
        setFrame(i);
        if (i === 4) {
          play("impact");
          setFlash(true);
        }
        if (i === 5) {
          play("papers");
          window.setTimeout(() => setFlash(false), 220);
        }
      }, i * 65);
      timers.current.push(id);
    }
    const end = window.setTimeout(() => setFrame(0), KICK.length * 65 + 420);
    timers.current.push(end);
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
    <div className={`fight${active ? " fight-live" : ""}${flash ? " fight-hit" : ""}`}>
      <img className="fight-hero" src="/fx/hero.webp" alt="" draggable={false} />
      <img className="fight-mascot" src={KICK[frame]} alt="" draggable={false} />
      <img className="fight-rkn" src={RKN[Math.min(8, frame)]} alt="" draggable={false} />
      {flash && <span className="fight-flash" aria-hidden />}
      <div className="fight-bar">
        <span className="fight-status">{active ? "РКН в нокдауне" : "РКН на страже"}</span>
        <button className="fight-mute" onClick={toggleQuiet} title={quiet ? "Включить звук" : "Выключить звук"}>
          {quiet ? "🔇" : "🔊"}
        </button>
      </div>
    </div>
  );
}
