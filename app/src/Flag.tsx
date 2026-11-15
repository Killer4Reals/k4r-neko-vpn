// Маленький флаг страны. Картинки локальные (public/flags), поэтому окно
// не ходит в интернет за иконками. Если страны нет в наборе — показываем
// привычные две буквы, чтобы список не разъезжался.

type Props = {
  /** двухбуквенный код страны, например fi */
  cc: string | null;
  size?: "sm" | "md";
  dim?: boolean;
};

export function Flag({ cc, size = "md", dim = false }: Props) {
  // код страны — ровно две латинские буквы; всё остальное (эмодзи, «VPN») не флаг
  const code = cc && /^[a-z]{2}$/i.test(cc) ? cc.toLowerCase() : null;
  if (!code) {
    // страны не нашлось: свой значок глобуса, чтобы список не разъезжался и
    // рядом с настоящими флагами не торчала плашка с буквами
    return (
      <span className="flag flag-globe" data-size={size} data-dim={dim} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.6 2.6 15 0 18M12 3c-2.6 2.6-2.6 15 0 18" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flag" data-size={size} data-dim={dim} aria-hidden="true">
      <img src={`flags/${code}.svg`} alt="" draggable={false} loading="lazy" />
    </span>
  );
}
