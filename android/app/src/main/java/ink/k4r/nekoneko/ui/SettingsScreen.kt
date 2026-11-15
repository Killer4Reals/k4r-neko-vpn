package ink.k4r.nekoneko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.DnsCatalog
import ink.k4r.nekoneko.data.DnsEntry
import ink.k4r.nekoneko.data.Store

/**
 * Настройки: DNS, защита от утечек, тема оформления и сведения о сборке.
 * Каталог DNS тот же, что на ПК, чтобы выбор не зависел от платформы.
 */
@Composable
fun SettingsScreen(store: Store, theme: String, onTheme: (String) -> Unit) {
    val russian = LocalConfiguration.current.locales[0].language == "ru"
    var dns by remember { mutableStateOf(store.dns) }
    var ipv6 by remember { mutableStateOf(store.blockIpv6) }
    var own by remember { mutableStateOf("") }
    var autoStart by remember { mutableStateOf(store.autoStart) }

    val groups = DnsCatalog.groups

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
    ) {
        item { SectionTitle(stringResource(R.string.tab_settings)) }

        item {
            Panel(stringResource(R.string.set_theme)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((id, label) in listOf(
                        "night" to stringResource(R.string.theme_night),
                        "neon" to stringResource(R.string.theme_neon),
                        "day" to stringResource(R.string.theme_day),
                    )) {
                        FilterChip(
                            selected = theme == id,
                            onClick = {
                                store.theme = id
                                onTheme(id)
                            },
                            label = { Text(label, fontSize = 12.sp) },
                        )
                    }
                }
            }
        }

        item {
            Panel(stringResource(R.string.set_dns)) {
                Text(
                    text = stringResource(R.string.set_dns_now, DnsCatalog.find(dns)?.owner ?: dns),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                )
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = own,
                    onValueChange = { own = it },
                    singleLine = true,
                    label = { Text(stringResource(R.string.set_dns_own), fontSize = 11.sp) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(4.dp))
                androidx.compose.material3.Button(
                    onClick = {
                        val value = own.trim()
                        if (value.isNotEmpty()) {
                            dns = value
                            store.dns = value
                        }
                    },
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.set_dns_apply), fontSize = 12.sp)
                }
            }
        }

        for (group in groups) {
            item {
                Text(
                    text = if (russian) group.titleRu else group.titleEn,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 10.dp),
                )
                Text(
                    text = if (russian) group.hintRu else group.hintEn,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                )
            }
            items(group.items.size) { index ->
                val entry = group.items[index]
                DnsRow(entry, russian, dns) { value ->
                    dns = value
                    store.dns = value
                }
            }
        }

        item {
            Spacer(Modifier.height(6.dp))
            Panel(stringResource(R.string.set_leaks)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(R.string.set_ipv6),
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = 13.sp,
                        )
                        Text(
                            text = stringResource(R.string.set_ipv6_hint),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.sp,
                        )
                    }
                    Switch(
                        checked = ipv6,
                        onCheckedChange = {
                            ipv6 = it
                            store.blockIpv6 = it
                        },
                    )
                }
            }
        }

        item {
            Spacer(Modifier.height(6.dp))
            Panel(stringResource(R.string.set_start)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(R.string.set_autostart),
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = 13.sp,
                        )
                        Text(
                            text = stringResource(R.string.set_autostart_hint),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.sp,
                        )
                    }
                    Switch(
                        checked = autoStart,
                        onCheckedChange = {
                            autoStart = it
                            store.autoStart = it
                        },
                    )
                }
            }
        }

        item {
            Spacer(Modifier.height(6.dp))
            Panel(stringResource(R.string.set_about)) {
                InfoLine(stringResource(R.string.set_version), Build.APP_VERSION)
                InfoLine(stringResource(R.string.set_engine), sinkVersion())
                Text(
                    text = stringResource(R.string.set_about_text),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun DnsRow(entry: DnsEntry, russian: Boolean, current: String, onPick: (String) -> Unit) {
    val active = current == entry.plain || current == entry.doh || current == entry.dot
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(
                if (active) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface
            )
            .border(
                1.dp,
                if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(12.dp),
            )
            .padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.owner + if (entry.star) "  ★" else "",
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 13.sp,
                )
                Text(
                    text = if (russian) entry.noteRu else entry.noteEn,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                )
            }
            if (active) {
                Text("✓", color = MaterialTheme.colorScheme.primary, fontSize = 14.sp)
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for ((label, value) in listOf(
                stringResource(R.string.dns_plain) to entry.plain,
                "DoH" to entry.doh,
                "DoT" to entry.dot,
            )) {
                val picked = current == value
                Text(
                    text = label,
                    // Выбранный способ подсвечен, остальные — спокойные
                    color = if (picked) MaterialTheme.colorScheme.onPrimary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(
                            if (picked) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.surfaceVariant
                        )
                        .clickable { onPick(value) }
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                )
            }
        }
    }
}

/** Версия ядра: показываем честно, а не «1.0». */
private fun sinkVersion(): String = try {
    io.nekohasekai.libbox.Libbox.version()
} catch (e: Throwable) {
    "—"
}
