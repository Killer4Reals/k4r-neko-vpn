package ink.k4r.nekoneko.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Палитра та же, что в Windows-версии: фиолетовый маскот, неоново-зелёный акцент.
private val Night = darkColorScheme(
    primary = Color(0xFF39FF14),
    onPrimary = Color(0xFF06110A),
    secondary = Color(0xFF9B5CFF),
    background = Color(0xFF0B0D12),
    onBackground = Color(0xFFE9ECF2),
    surface = Color(0xFF141821),
    onSurface = Color(0xFFE9ECF2),
    surfaceVariant = Color(0xFF1B2130),
    onSurfaceVariant = Color(0xFF9AA3B4),
    error = Color(0xFFFF7A85),
)

// «Неон»: тот же маскот, но фон уходит в фиолетовый.
private val Neon = darkColorScheme(
    primary = Color(0xFF39FF14),
    onPrimary = Color(0xFF07110B),
    secondary = Color(0xFFC08BFF),
    background = Color(0xFF120A1E),
    onBackground = Color(0xFFF1E9FF),
    surface = Color(0xFF1C1130),
    onSurface = Color(0xFFF1E9FF),
    surfaceVariant = Color(0xFF2A1B45),
    onSurfaceVariant = Color(0xFFB9A7D6),
    error = Color(0xFFFF8A9B),
)

// «День»: светлая, но не белая — глаза не режет.
private val Day = lightColorScheme(
    primary = Color(0xFF128A3A),
    onPrimary = Color(0xFFFFFFFF),
    secondary = Color(0xFF6A33C9),
    background = Color(0xFFF6F5FA),
    onBackground = Color(0xFF14161C),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF14161C),
    surfaceVariant = Color(0xFFE8E6F1),
    onSurfaceVariant = Color(0xFF5A6172),
    error = Color(0xFFB3261E),
)

/** Три темы, как на ПК: ночь, неон, день. */
@Composable
fun NekoTheme(theme: String = "night", content: @Composable () -> Unit) {
    val scheme = when (theme) {
        "neon" -> Neon
        "day" -> Day
        else -> Night
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
