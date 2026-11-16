package ink.k4r.nekoneko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.DnsCatalog
import ink.k4r.nekoneko.data.DnsEntry
import ink.k4r.nekoneko.data.Lang
import android.app.Activity
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import ink.k4r.nekoneko.data.Backup
import ink.k4r.nekoneko.data.Day
import ink.k4r.nekoneko.data.Store
import ink.k4r.nekoneko.data.Usage
import ink.k4r.nekoneko.vpn.Diag

/**
 * Настройки: DNS, защита от утечек, тема оформления и сведения о сборке.
 * Каталог DNS тот же, что на ПК, чтобы выбор не зависел от платформы.
 */
@Composable
fun SettingsScreen(
    store: Store,
    theme: String,
    onTheme: (String) -> Unit,
    lang: String = Lang.SYSTEM,
    onLang: (String) -> Unit = {},
) {
    val russian = LocalConfiguration.current.locales[0].language == "ru"
    var dns by remember { mutableStateOf(store.dns) }
    var ipv6 by remember { mutableStateOf(store.blockIpv6) }
    var kill by remember { mutableStateOf(store.killSwitch) }
    var own by remember { mutableStateOf("") }
    var autoStart by remember { mutableStateOf(store.autoStart) }
    var usage by remember { mutableStateOf(store.usage()) }
    var backupNote by remember { mutableStateOf("") }
    val context = LocalContext.current
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        backupNote = try {
            context.contentResolver.openOutputStream(uri)?.use { out ->
                out.write(store.exportBackup().toByteArray(Charsets.UTF_8))
            }
            context.getString(R.string.backup_saved)
        } catch (e: Exception) {
            context.getString(R.string.backup_fail, e.javaClass.simpleName)
        }
    }
    val opener = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        backupNote = try {
            val text = context.contentResolver.openInputStream(uri)?.use { input ->
                input.readBytes().toString(Charsets.UTF_8)
            }.orEmpty()
            val snapshot = Backup.parse(text)
            if (snapshot == null || snapshot.isEmpty) {
                context.getString(R.string.backup_bad)
            } else {
                store.restoreBackup(snapshot)
                // Показываем восстановленное сразу: тумблеры, тема и язык
                dns = store.dns
                ipv6 = store.blockIpv6
                autoStart = store.autoStart
                kill = store.killSwitch
                onTheme(store.theme)
                // Язык применяется пересозданием активити — пусть решает App
                if (store.lang != lang) onLang(store.lang)
                context.getString(R.string.backup_restored)
            }
        } catch (e: Exception) {
            context.getString(R.string.backup_fail, e.javaClass.simpleName)
        }
    }
    var diagOpen by remember { mutableStateOf(false) }
    var diagLines by remember { mutableStateOf(Diag.lines()) }
    // Журнал открыт — подтягиваем новые строки, закрыт — не тратим батарею
    // Цифры по дням обновляем, пока экран открыт: после подключения они растут
    LaunchedEffect(Unit) {
        while (true) {
            usage = store.usage()
            delay(3000)
        }
    }

    LaunchedEffect(diagOpen) {
        while (diagOpen) {
            diagLines = Diag.lines()
            delay(1000)
        }
    }

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
            Panel(stringResource(R.string.set_lang)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((id, label) in listOf(
                        Lang.SYSTEM to stringResource(R.string.lang_system),
                        Lang.RU to stringResource(R.string.lang_ru),
                        Lang.EN to stringResource(R.string.lang_en),
                    )) {
                        FilterChip(
                            selected = lang == id,
                            onClick = { onLang(id) },
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
            Panel(stringResource(R.string.set_kill)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(R.string.set_killswitch),
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = 13.sp,
                        )
                        Text(
                            text = stringResource(R.string.set_killswitch_hint),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.sp,
                        )
                    }
                    Switch(
                        checked = kill,
                        onCheckedChange = {
                            kill = it
                            store.killSwitch = it
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
            Panel(stringResource(R.string.set_days)) {
                val week = Usage.window(usage, 7)
                if (week.isEmpty()) {
                    Text(
                        text = stringResource(R.string.days_empty),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.sp,
                    )
                } else {
                    val peak = Usage.peak(week).coerceAtLeast(1)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Bottom,
                    ) {
                        for (day in week) {
                            DayColumn(day, peak, Modifier.weight(1f))
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = stringResource(R.string.days_total, bytes(Usage.total(week))),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.sp,
                    )
                }
            }
        }

        item {
            Spacer(Modifier.height(6.dp))
            Panel(stringResource(R.string.set_diag)) {
                Text(
                    text = stringResource(R.string.set_diag_hint),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                )
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { diagOpen = !diagOpen }) {
                        Text(
                            text = stringResource(if (diagOpen) R.string.diag_hide else R.string.diag_show),
                            fontSize = 12.sp,
                        )
                    }
                    if (diagOpen) {
                        TextButton(onClick = {
                            Diag.clear()
                            diagLines = emptyList()
                        }) {
                            Text(text = stringResource(R.string.diag_clear), fontSize = 12.sp)
                        }
                    }
                }
                if (diagOpen) {
                    if (diagLines.isEmpty()) {
                        Text(
                            text = stringResource(R.string.diag_empty),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.sp,
                        )
                    } else {
                        for (line in diagLines.takeLast(40)) {
                            Text(
                                text = line,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 9.5.sp,
                            )
                        }
                    }
                }
            }
        }

        item {
            Spacer(Modifier.height(6.dp))
            Panel(stringResource(R.string.set_backup)) {
                Text(
                    text = stringResource(R.string.set_backup_hint),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                )
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { saver.launch("k4r-neko-backup.json") }) {
                        Text(text = stringResource(R.string.backup_save), fontSize = 12.sp)
                    }
                    TextButton(onClick = { opener.launch(arrayOf("application/json", "text/plain", "*/*")) }) {
                        Text(text = stringResource(R.string.backup_open), fontSize = 12.sp)
                    }
                }
                if (backupNote.isNotBlank()) {
                    Text(
                        text = backupNote,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.sp,
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

/** Столбик одного дня: высота — доля от самого полного дня недели. */
@Composable
private fun DayColumn(day: Day, peak: Long, modifier: Modifier = Modifier) {
    val share = (day.total.toFloat() / peak).coerceIn(0f, 1f)
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // подпись стоит прямо над своим столбиком: так видно и день, и объём
        Text(
            text = if (day.total > 0) bytes(day.total) else "",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 8.sp,
            maxLines = 1,
        )
        Spacer(Modifier.height(2.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(4.dp + 44.dp * share)
                .clip(RoundedCornerShape(4.dp))
                .background(
                    if (day.total > 0) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.surfaceVariant
                ),
        )
        Spacer(Modifier.height(3.dp))
        Text(
            text = day.day.takeLast(2),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 9.sp,
        )
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
