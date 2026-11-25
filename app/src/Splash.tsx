/**
 * Заставка первого кадра: тёмный фон, маскот в кольце и тонкая полоса.
 * Живёт отдельно от окна, чтобы подключение не начиналось «из пустоты».
 */
export function Splash() {
  return (
    <div className="splash" aria-hidden="true">
      <div className="splash-mark">
        <span className="splash-ring" />
        <img src="/mascot/glyph-on.png" alt="" />
      </div>
      <div className="splash-name">K4R Neko VPN</div>
      <div className="splash-bar"><i /></div>
    </div>
  );
}
