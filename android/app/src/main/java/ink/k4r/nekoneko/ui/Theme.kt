package ink.k4r.nekoneko.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Палитра та же, что в Windows-версии: фиолетовый маскот, неоново-зелёный акцент,
// тёмная «ночная» основа. Светлая тема — отдельным набором ниже.
private val Dark = darkColorScheme(
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

@Composable
fun NekoTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Dark, content = content)
}
