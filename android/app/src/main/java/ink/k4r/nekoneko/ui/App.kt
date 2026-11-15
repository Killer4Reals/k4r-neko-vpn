package ink.k4r.nekoneko.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.Flags

/** Состояние туннеля. Показываем только то, что знаем наверняка. */
enum class Conn { Idle, Connecting, Connected, Error }

private data class Row(val name: String, val cc: String?, val ping: Int?)

private val demo = listOf(
    Row("Финляндия", "fi", 65),
    Row("Лондон", "gb", 84),
    Row("Нидерланды", "nl", 108),
    Row("Польша", "pl", 68),
    Row("Германия", "de", 75),
)

@Composable
fun App() {
    var conn by remember { mutableStateOf(Conn.Idle) }
    var picked by remember { mutableStateOf(0) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(R.string.app_name),
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.SemiBold,
            fontSize = 18.sp,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(18.dp))

        Box(
            modifier = Modifier
                .size(190.dp)
                .clip(RoundedCornerShape(50))
                .background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) {
            val art = when (conn) {
                Conn.Connected -> R.drawable.mascot_connected
                Conn.Error -> R.drawable.mascot_error
                else -> R.drawable.mascot_idle
            }
            Image(
                painter = painterResource(art),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(0.86f),
            )
        }

        Spacer(Modifier.height(14.dp))
        Text(
            text = stringResource(
                when (conn) {
                    Conn.Idle -> R.string.state_off
                    Conn.Connecting -> R.string.state_connecting
                    Conn.Connected -> R.string.state_connected
                    Conn.Error -> R.string.state_error
                }
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(10.dp))

        Button(
            onClick = { conn = if (conn == Conn.Connected) Conn.Idle else Conn.Connecting },
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth(0.7f),
        ) {
            Text(
                text = stringResource(if (conn == Conn.Connected) R.string.disconnect else R.string.connect),
                color = MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.SemiBold,
            )
        }

        Spacer(Modifier.height(22.dp))
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(demo.size) { index ->
                val row = demo[index]
                ServerRow(row, active = index == picked) { picked = index }
            }
        }
    }
}

@Composable
private fun ServerRow(row: Row, active: Boolean, onClick: () -> Unit) {
    val bg = if (active) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = Flags.emoji(row.cc) ?: "🌐", fontSize = 18.sp)
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = Flags.stripCc(row.name),
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 14.sp,
            )
        }
        Text(
            text = row.ping?.let { "$it" } ?: "—",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
        )
    }
}
