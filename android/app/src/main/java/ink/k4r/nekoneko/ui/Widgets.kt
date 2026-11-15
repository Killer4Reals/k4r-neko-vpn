package ink.k4r.nekoneko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Общая «карточка»: тёмная подложка, мелкий заголовок, строки внутри. */
@Composable
fun Panel(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text(
            text = title,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        content()
    }
}

/** Строка «подпись — значение». */
@Composable
fun InfoLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(
            text = label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
            modifier = Modifier.weight(1f),
        )
        Text(text = value, color = MaterialTheme.colorScheme.onSurface, fontSize = 12.sp)
    }
}

/** Заголовок раздела на экране. */
@Composable
fun SectionTitle(text: String) {
    Text(
        text = text,
        color = MaterialTheme.colorScheme.onBackground,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        modifier = Modifier.padding(top = 12.dp, bottom = 10.dp),
    )
}

/** Байты в человеческий вид: 1,2 ГБ. */
fun bytes(value: Long): String {
    if (value <= 0) return "0"
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var rest = value.toDouble()
    var index = 0
    while (rest >= 1024 && index < units.lastIndex) {
        rest /= 1024
        index++
    }
    return "%.1f %s".format(rest, units[index])
}

/** Сколько дней осталось; «—», если срок не задан. */
fun daysLeft(expire: Long, dayUnit: String, hourUnit: String): String {
    if (expire <= 0) return "—"
    val left = expire * 1000 - System.currentTimeMillis()
    if (left <= 0) return "0"
    val days = left / 86_400_000
    val hours = (left % 86_400_000) / 3_600_000
    return if (days > 0) "$days $dayUnit" else "$hours $hourUnit"
}
