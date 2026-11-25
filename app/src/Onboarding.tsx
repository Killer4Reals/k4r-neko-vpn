import { useState } from "react";
import { needOnboard, nextStep, ONBOARD_KEY, ONBOARD_STEPS } from "./firstRun";

/**
 * Первый запуск: три карточки от маскота. Не тур по кнопкам, а три мысли —
 * «что это», «что защищено», «что никуда не уходит». Пропуск доступен сразу.
 */
export function Onboarding(p: { t: (k: string) => string; onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = ONBOARD_STEPS[i];
  const last = i === ONBOARD_STEPS.length - 1;
  const done = () => {
    localStorage.setItem(ONBOARD_KEY, "1");
    p.onDone();
  };
  return (
    <div className="onboard" role="dialog" aria-modal="true">
      <div className="onboard-card">
        <img className="onboard-pose" src={`/fx/pose-${step.pose}.webp`} alt="" draggable={false} />
        <h2>{p.t(step.titleKey)}</h2>
        <p>{p.t(step.bodyKey)}</p>
        <div className="onboard-dots" aria-hidden="true">
          {ONBOARD_STEPS.map((s, n) => (
            <span key={s.titleKey} data-on={n === i} />
          ))}
        </div>
        <div className="onboard-actions">
          <button className="ghost-btn" onClick={done}>
            {p.t("obSkip")}
          </button>
          <button className="btn primary" onClick={() => (last ? done() : setI(nextStep(i, 1)))}>
            {p.t(last ? "obStart" : "obNext")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Показывать ли онбординг сейчас: читает флаг из localStorage. */
export function shouldOnboard(): boolean {
  return needOnboard(localStorage.getItem(ONBOARD_KEY));
}
