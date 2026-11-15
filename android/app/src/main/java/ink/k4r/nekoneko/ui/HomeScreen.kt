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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.Flags
import ink.k4r.nekoneko.data.Profile
import ink.k4r.nekoneko.data.Store
import ink.k4r.nekoneko.data.SubscriptionClient
import ink.k4r.nekoneko.vpn.TunnelService
import ink.k4r.nekoneko.vpn.TunnelState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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

    val tunnel = TunnelState.state
    var phase by remember { mutableStateOf(tunnel.value.phase) }
    var reason by remember { mutableStateOf(tunnel.value.reason) }
    var rx by remember { mutableStateOf(tunnel.value.rx) }
    var tx by remember { mutableStateOf(tunnel.value.tx) }
    var rxSpeed by remember { mutableStateOf(tunnel.value.rxSpeed) }
    var txSpeed by remember { mutableStateOf(tunnel.value.txSpeed) }
    LaunchedEffect(Unit) {
        tunnel.collect {
            phase = it.phase
            reason = it.reason
            rx = it.rx
            tx = it.tx
            rxSpeed = it.rxSpeed
            txSpeed = it.txSpeed
        }
    }

    var url by remember { mutableStateOf(store.subUrl) }
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
                    picked = profiles.first().id
                    store.selected = "${profiles.first().host}:${profiles.first().port}"
                }
                message = context.getString(R.string.sub_loaded, profiles.size)
            } catch (e: Throwable) {
                message = e.message ?: e.javaClass.simpleName
            } finally {
                busy = false
            }
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
                if (phase == TunnelState.Phase.Connected || phase == TunnelState.Phase.Connecting) {
                    context.startService(
                        Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_STOP)
                    )
                } else {
                    startTunnel()
                }
            },
            enabled = profiles.isNotEmpty() || phase == TunnelState.Phase.Connected,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            ),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.align(Alignment.CenterHorizontally).fillMaxWidth(0.75f),
        ) {
            Text(
                text = stringResource(
                    if (phase == TunnelState.Phase.Connected || phase == TunnelState.Phase.Connecting)
                        R.string.disconnect else R.string.connect
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
                }
            }
            if (profiles.isNotEmpty()) {
                item {
                    Text(
                        text = stringResource(R.string.panel_servers, profiles.size),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                items(profiles, key = { it.id }) { profile ->
                    ServerRow(profile, active = profile.id == picked) {
                        picked = profile.id
                        store.selected = "${profile.host}:${profile.port}"
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun ServerRow(profile: Profile, active: Boolean, onClick: () -> Unit) {
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
        if (active) {
            Text(
                text = stringResource(R.string.chosen),
                color = MaterialTheme.colorScheme.primary,
                fontSize = 11.sp,
            )
        }
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
