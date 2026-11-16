package ink.k4r.nekoneko.ui

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.Flags
import ink.k4r.nekoneko.data.Ping
import ink.k4r.nekoneko.data.SubscriptionParser
import ink.k4r.nekoneko.data.Speed
import ink.k4r.nekoneko.data.Profile
import ink.k4r.nekoneko.data.Store
import ink.k4r.nekoneko.data.SubscriptionClient
import ink.k4r.nekoneko.vpn.TunnelService
import ink.k4r.nekoneko.vpn.TunnelState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Главный экран. Показывает только то, что знает: список приходит из подписки,
 * «Защищено» — от живого ответа через туннель, адрес — от реального запроса.
 */
@Composable
fun HomeScreen(store: Store) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val russian = LocalConfiguration.current.locales[0].language == "ru"
    val clipboard = LocalClipboardManager.current

    val tunnel = TunnelState.state
    var phase by remember { mutableStateOf(tunnel.value.phase) }
    var reason by remember { mutableStateOf(tunnel.value.reason) }
    var rx by remember { mutableStateOf(tunnel.value.rx) }
    var tx by remember { mutableStateOf(tunnel.value.tx) }
    var blocked by remember { mutableStateOf(tunnel.value.blocked) }
    var rxSpeed by remember { mutableStateOf(tunnel.value.rxSpeed) }
    var txSpeed by remember { mutableStateOf(tunnel.value.txSpeed) }
    LaunchedEffect(Unit) {
        tunnel.collect {
            phase = it.phase
            reason = it.reason
            blocked = it.blocked
            rx = it.rx
            tx = it.tx
            rxSpeed = it.rxSpeed
            txSpeed = it.txSpeed
        }
    }

    var url by remember { mutableStateOf(store.subUrl) }
    var subs by remember { mutableStateOf(store.subList()) }
    var activeUrl by remember { mutableStateOf(store.subUrl) }
    var profiles by remember { mutableStateOf(store.profiles()) }
    var picked by remember { mutableStateOf(store.profile()?.id.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var title by remember { mutableStateOf(store.subTitle) }
    var used by remember { mutableStateOf(store.subUsed) }
    var total by remember { mutableStateOf(store.subTotal) }
    var expire by remember { mutableStateOf(store.subExpire) }
    var ip by remember { mutableStateOf("") }
    var ipBusy by remember { mutableStateOf(false) }
    var speedBusy by remember { mutableStateOf(false) }
    var speed by remember { mutableStateOf("") }
    // Отклик серверов: id → подпись. Меряем по нажатию, а не пачкой при загрузке
    val pings = remember { mutableStateMapOf<String, String>() }
    var pingAll by remember { mutableStateOf(false) }

    val askPermission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_START),
            )
        } else {
            message = context.getString(R.string.err_permission)
        }
    }

    fun startTunnel() {
        val intent = VpnService.prepare(context)
        if (intent == null) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_START),
            )
        } else {
            askPermission.launch(intent)
        }
    }

    /** Открыть другую подписку из списка: и данные, и серверы с ней. */
    fun openSub(target: String) {
        store.activeSub = target
        activeUrl = target
        url = store.subUrl
        title = store.subTitle
        used = store.subUsed
        total = store.subTotal
        expire = store.subExpire
        profiles = store.profiles()
        picked = store.profile()?.id.orEmpty()
        pings.clear()
        message = ""
    }

    fun load() {
        if (busy) return
        busy = true
        message = ""
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { SubscriptionClient.fetch(url, store.hwid) }
                if (result.profiles.isEmpty()) error(context.getString(R.string.err_no_servers))
                store.subUrl = url.trim()
                store.subBody = result.profiles.joinToString("\n") { it.raw }
                store.subFetched = System.currentTimeMillis()
                store.subRefresh = result.refreshHint
                store.subTitle = result.title.orEmpty()
                title = result.title.orEmpty()
                used = result.info?.used ?: 0
                total = result.info?.total ?: 0
                expire = result.info?.expire ?: 0
                store.subUsed = used
                store.subTotal = total
                store.subExpire = expire
                profiles = result.profiles
                if (profiles.none { it.id == picked }) {
                    // «Авто-выбор сервера» от провайдера — не сервер, берём настоящий
                    val first = store.defaultProfile(profiles) ?: profiles.first()
                    picked = first.id
                    store.selected = "${first.host}:${first.port}"
                }
                subs = store.subList()
                activeUrl = store.subUrl
                message = context.getString(R.string.sub_loaded)
            } catch (e: Throwable) {
                message = explain(context, e)
            } finally {
                busy = false
            }
        }
    }

    /**
     * Замер всех серверов сразу. Идём по три за раз: и быстро, и не открываем
     * десятки соединений к чужим адресам одновременно.
     */
    fun pingAllServers() {
        if (pingAll) return
        pingAll = true
        val list = profiles
        for (profile in list) pings[profile.id] = "…"
        scope.launch {
            list.chunked(3).forEach { group ->
                group.map { profile ->
                    async(Dispatchers.IO) {
                        val ms = Ping.measure(profile.host, profile.port)
                        profile.id to Ping.label(ms, russian)
                    }
                }.awaitAll().forEach { (id, label) -> pings[id] = label }
            }
            pingAll = false
        }
    }

    fun runSpeed() {
        if (speedBusy) return
        speedBusy = true
        speed = ""
        scope.launch {
            val result = Speed.measure(onSpeed = { live ->
                speed = Speed.label(live, russian)
            })
            speed = if (result == null) {
                context.getString(R.string.speed_fail)
            } else {
                Speed.label(result, russian)
            }
            speedBusy = false
        }
    }

    fun checkIp() {
        if (ipBusy) return
        ipBusy = true
        scope.launch {
            ip = try {
                withContext(Dispatchers.IO) { fetchIp() }
            } catch (e: Throwable) {
                context.getString(R.string.ip_error)
            }
            ipBusy = false
        }
    }

    // Адрес выхода спрашиваем сами, как только туннель поднялся: человек
    // подключился, чтобы адрес сменился, — пусть увидит это сразу.
    LaunchedEffect(phase) {
        if (phase != TunnelState.Phase.Connected) {
            ip = ""
            return@LaunchedEffect
        }
        if (ipBusy) return@LaunchedEffect
        ipBusy = true
        ip = try {
            withContext(Dispatchers.IO) { fetchIp() }
        } catch (e: Throwable) {
            context.getString(R.string.ip_error)
        }
        ipBusy = false
    }

    // Подписка сама обновляется при запуске: адрес есть, а профилей нет
    // или прошло больше, чем просил провайдер.
    LaunchedEffect(Unit) {
        val stale = System.currentTimeMillis() - store.subFetched > store.subRefresh * 3_600_000L
        if (url.isNotBlank() && (profiles.isEmpty() || stale)) load()
    }

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Text(
            text = stringResource(R.string.app_name),
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.SemiBold,
            fontSize = 18.sp,
            modifier = Modifier.padding(top = 12.dp),
        )
        Spacer(Modifier.height(6.dp))

        Box(
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .size(168.dp)
                .clip(RoundedCornerShape(50))
                .background(MaterialTheme.colorScheme.surface)
                .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50)),
            contentAlignment = Alignment.Center,
        ) {
            val art = when (phase) {
                TunnelState.Phase.Connected -> R.drawable.mascot_connected
                TunnelState.Phase.Error -> R.drawable.mascot_error
                else -> R.drawable.mascot_idle
            }
            Image(
                painter = painterResource(art),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(0.88f),
            )
        }

        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(
                when (phase) {
                    TunnelState.Phase.Idle -> R.string.state_off
                    TunnelState.Phase.Connecting -> R.string.state_connecting
                    TunnelState.Phase.Connected -> R.string.state_connected
                    TunnelState.Phase.Error -> R.string.state_error
                }
            ),
            color = if (phase == TunnelState.Phase.Error) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        )
        if (reason.isNotEmpty()) {
            Text(
                text = reason,
                color = if (phase == TunnelState.Phase.Error) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 11.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }

        Spacer(Modifier.height(8.dp))
        Button(
            onClick = {
                if (blocked) {
                    context.startService(
                        Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_STOP)
                    )
                } else if (phase == TunnelState.Phase.Connected || phase == TunnelState.Phase.Connecting) {
                    context.startService(
                        Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_STOP)
                    )
                } else {
                    startTunnel()
                }
            },
            enabled = blocked || profiles.isNotEmpty() || phase == TunnelState.Phase.Connected,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            ),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.align(Alignment.CenterHorizontally).fillMaxWidth(0.75f),
        ) {
            Text(
                text = stringResource(
                    when {
                        blocked -> R.string.unblock
                        phase == TunnelState.Phase.Connected ||
                            phase == TunnelState.Phase.Connecting -> R.string.disconnect
                        else -> R.string.connect
                    }
                ),
                color = if (profiles.isEmpty() && phase == TunnelState.Phase.Idle)
                    MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.SemiBold,
            )
        }

        if (message.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = message,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 11.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }

        Spacer(Modifier.height(10.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxSize()) {
            item {
                Panel(title.ifBlank { stringResource(R.string.panel_sub) }) {
                    InfoLine(
                        stringResource(R.string.row_traffic),
                        when {
                            total > 0 -> "${bytes(used)} / ${bytes(total)}"
                            used > 0 -> bytes(used)
                            else -> "—"
                        },
                    )
                    InfoLine(
                        stringResource(R.string.row_expire),
                        if (expire <= 0) "—" else daysLeft(
                            expire,
                            stringResource(R.string.unit_days),
                            stringResource(R.string.unit_hours),
                        ),
                    )
                    InfoLine(stringResource(R.string.row_servers), profiles.size.toString())
                }
            }
            if (phase == TunnelState.Phase.Connected) {
                item {
                    Panel(stringResource(R.string.panel_traffic)) {
                        InfoLine(
                            stringResource(R.string.row_rx),
                            if (rx > 0) "${bytes(rx)}  ·  ${bytes(rxSpeed)}/s" else "—",
                        )
                        InfoLine(
                            stringResource(R.string.row_tx),
                            if (tx > 0) "${bytes(tx)}  ·  ${bytes(txSpeed)}/s" else "—",
                        )
                        Spacer(Modifier.height(4.dp))
                        Button(
                            onClick = { runSpeed() },
                            enabled = !speedBusy,
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = stringResource(if (speedBusy) R.string.speed_busy else R.string.speed_run),
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                        if (speed.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = stringResource(R.string.speed_result, speed),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }
            }
            item {
                Panel(stringResource(R.string.panel_ip)) {
                    InfoLine(stringResource(R.string.row_ip), ip.ifBlank { "—" })
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { checkIp() },
                            enabled = !ipBusy,
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = stringResource(if (ipBusy) R.string.ip_busy else R.string.ip_check),
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                }
            }
            item {
                Panel(stringResource(R.string.panel_sub_link)) {
                    if (subs.isNotEmpty()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                        ) {
                            for (item in subs) {
                                FilterChip(
                                    selected = item.url == activeUrl,
                                    onClick = { openSub(item.url) },
                                    label = { Text(item.label(), fontSize = 11.sp) },
                                )
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                    }
                    OutlinedTextField(
                        value = url,
                        onValueChange = { url = it },
                        singleLine = true,
                        label = { Text(stringResource(R.string.sub_hint), fontSize = 11.sp) },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(6.dp))
                    Button(
                        onClick = { load() },
                        enabled = !busy && url.isNotBlank(),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(if (busy) R.string.sub_loading else R.string.sub_load), fontSize = 13.sp)
                    }
                    if (subs.isNotEmpty()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = {
                                // поле пустое — вводим новую ссылку
                                url = ""
                                message = ""
                            }) {
                                Text(stringResource(R.string.sub_add), fontSize = 11.sp)
                            }
                            if (url.isNotBlank()) {
                                TextButton(onClick = {
                                    // Перенести подписку на другой телефон: скопировать проще, чем набирать
                                    clipboard.setText(AnnotatedString(url))
                                    message = context.getString(R.string.sub_copied)
                                }) {
                                    Text(stringResource(R.string.sub_copy), fontSize = 11.sp)
                                }
                            }
                            // На телефоне вставлять ссылку долгим нажатием неудобно.
                            // Буфер читаем только по нажатию: система показывает
                            // «приложение читает буфер», и делать это без спроса нельзя
                            TextButton(onClick = {
                                val pasted = clipboard.getText()?.text?.trim().orEmpty()
                                if (pasted.contains("://")) {
                                    url = pasted
                                    message = ""
                                } else {
                                    message = context.getString(R.string.sub_paste_empty)
                                }
                            }) {
                                Text(stringResource(R.string.sub_paste), fontSize = 11.sp)
                            }
                            if (activeUrl.isNotBlank()) {
                                TextButton(onClick = {
                                    val target = activeUrl
                                    store.forgetSub(target)
                                    subs = store.subList()
                                    val next = subs.firstOrNull()?.url.orEmpty()
                                    if (next.isNotEmpty()) {
                                        openSub(next)
                                    } else {
                                        activeUrl = ""
                                        url = ""
                                        title = ""
                                        used = 0
                                        total = 0
                                        expire = 0
                                        picked = ""
                                        profiles = emptyList()
                                    }
                                }) {
                                    Text(stringResource(R.string.sub_forget), fontSize = 11.sp)
                                }
                            }
                        }
                    }
                }
            }
            if (profiles.isNotEmpty()) {
                item {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    ) {
                        Text(
                            text = stringResource(R.string.panel_servers, profiles.size),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 11.sp,
                            modifier = Modifier.weight(1f),
                        )
                        // Один замер на каждый сервер: по одному пальцем — долго
                        if (!pingAll) {
                            TextButton(onClick = { pingAllServers() }) {
                                Text(text = stringResource(R.string.servers_ping_all), fontSize = 11.sp)
                            }
                        } else {
                            Text(
                                text = stringResource(R.string.servers_pinging),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }
                items(profiles, key = { it.id }) { profile ->
                    ServerRow(
                        profile = profile,
                        active = profile.id == picked,
                        ping = pings[profile.id],
                        onClick = {
                            picked = profile.id
                            store.selected = "${profile.host}:${profile.port}"
                            pings[profile.id] = "…"
                            scope.launch {
                                val ms = withContext(Dispatchers.IO) { Ping.measure(profile.host, profile.port) }
                                pings[profile.id] = Ping.label(ms, russian)
                            }
                        },
                    )
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun ServerRow(
    profile: Profile,
    active: Boolean,
    ping: String?,
    onClick: () -> Unit,
) {
    val cc = Flags.ccFromName(profile.name)
    val bg = if (active) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = Flags.emoji(cc) ?: "🌐", fontSize = 18.sp)
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = Flags.stripCc(profile.name).ifEmpty { profile.host },
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 14.sp,
            )
            Text(
                text = "${profile.host}:${profile.port}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.5.sp,
            )
        }
        if (ping != null) {
            Text(text = ping, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.5.sp)
            Spacer(Modifier.width(8.dp))
        }
        if (active) {
            Text(
                text = stringResource(R.string.chosen),
                color = MaterialTheme.colorScheme.primary,
                fontSize = 11.sp,
            )
        }
    }
}

/**
 * Ошибка сети словами человека. Java-сообщения вида «For input string: "8099http:"»
 * ничего не объясняют, поэтому переводим частые случаи, остальное оставляем как есть.
 */
private fun explain(context: android.content.Context, e: Throwable): String = when {
    // Провайдер прислал заглушку: причину переводим в действие, а не в его текст
    e is IllegalStateException && e.message != null -> when (SubscriptionParser.kindOf(e.message.orEmpty())) {
        SubscriptionParser.Kind.DEVICES -> context.getString(R.string.err_device_limit)
        SubscriptionParser.Kind.EXPIRED -> context.getString(R.string.err_sub_expired)
        SubscriptionParser.Kind.OTHER -> context.getString(R.string.err_no_servers_provider, e.message.orEmpty())
    }
    else -> when (e) {
        is java.net.MalformedURLException, is IllegalArgumentException ->
            context.getString(R.string.err_bad_url)
        is java.net.UnknownHostException -> context.getString(R.string.err_no_host, e.message.orEmpty())
        is java.net.SocketTimeoutException -> context.getString(R.string.err_timeout)
        is java.io.IOException -> context.getString(R.string.err_network, e.message.orEmpty())
        else -> e.message ?: e.javaClass.simpleName
    }
}

private fun fetchIp(): String {
    val connection = (URL("https://api.ipify.org").openConnection() as HttpURLConnection).apply {
        connectTimeout = 10000
        readTimeout = 12000
        setRequestProperty("User-Agent", "K4R-Neko-VPN/0.1")
    }
    return try {
        connection.inputStream.bufferedReader().use { it.readText() }.trim()
    } finally {
        connection.disconnect()
    }
}
