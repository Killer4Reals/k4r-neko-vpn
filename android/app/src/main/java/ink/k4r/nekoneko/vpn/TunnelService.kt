package ink.k4r.nekoneko.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import ink.k4r.nekoneko.MainActivity
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.Store
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL

/**
 * Туннель на Android. В отличие от Windows адаптер создаёт система через
 * VpnService, поэтому вся настройка адресов и маршрутов идёт здесь, а ядру
 * достаётся готовый файловый дескриптор.
 */
class TunnelService : VpnService() {

    companion object {
        const val ACTION_START = "ink.k4r.nekoneko.START"
        const val ACTION_STOP = "ink.k4r.nekoneko.STOP"
        private const val CHANNEL = "tunnel"
        private const val NOTE_ID = 1
    }

    private var engine: SfBox? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start()
            ACTION_STOP -> stop()
        }
        return START_STICKY
    }

    private fun start() {
        TunnelState.set(TunnelState.Phase.Connecting)
        startForeground(NOTE_ID, notification(getString(R.string.notify_connecting), getString(R.string.notify_connecting_text)))
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        scope.launch {
            try {
                val store = Store(this@TunnelService)
                val profile = store.profile() ?: error("нет сервера: сначала загрузи подписку")
                val chosen = store.chosen()
                val include = if (store.splitMode == "only") chosen.toList() else emptyList()
                val exclude = if (store.splitMode == "only") emptyList() else chosen.toList()
                val config = Config.build(profile, store.dns, store.blockIpv6)
                val box = SfBox(this@TunnelService)
                box.start(config, include, exclude, store.dns)
                engine = box
                // Как на ПК: «защищено» — не по факту запуска, а по живому ответу
                // из интернета через туннель.
                var alive = false
                for (attempt in 1..8) {
                    delay(1200)
                    if (reachable()) {
                        alive = true
                        break
                    }
                }
                if (!alive) {
                    box.stop()
                    engine = null
                    TunnelState.set(TunnelState.Phase.Error, getString(R.string.err_no_answer))
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    return@launch
                }
                TunnelState.set(TunnelState.Phase.Connected)
                updateNotification(getString(R.string.notify_connected), profile.name)
            } catch (e: Throwable) {
                android.util.Log.d("K4R-service", "сбой запуска: ${e.javaClass.simpleName}: ${e.message}")
                // Честно: не «защищено», а ошибка с причиной
                engine?.stop()
                engine = null
                TunnelState.set(TunnelState.Phase.Error, e.message ?: e.javaClass.simpleName)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    private fun stop() {
        engine?.stop()
        engine = null
        TunnelState.set(TunnelState.Phase.Idle)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        engine?.stop()
        engine = null
        if (TunnelState.state.value.phase != TunnelState.Phase.Error) {
            TunnelState.set(TunnelState.Phase.Idle)
        }
        super.onDestroy()
    }

    override fun onRevoke() {
        // Система отобрала VPN (другое приложение или ручное отключение)
        stop()
        super.onRevoke()
    }

    /** Простой живой запрос: прошёл — значит трафик действительно идёт. */
    private fun reachable(): Boolean = try {
        android.util.Log.d("K4R-ready", "пробую api.ipify.org")
        val connection = (URL("https://api.ipify.org").openConnection() as HttpURLConnection).apply {
            connectTimeout = 4000
            readTimeout = 4000
            setRequestProperty("User-Agent", "K4R-Neko-VPN/0.1")
        }
        connection.inputStream.bufferedReader().use { it.readText() }.isNotBlank()
    } catch (e: Throwable) {
        android.util.Log.d("K4R-ready", "нет ответа: ${e.javaClass.simpleName}: ${e.message}")
        false
    } finally {
        // соединение закрывается сборщиком; отдельный disconnect не нужен
    }

    private fun channel(): String {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, getString(R.string.channel_tunnel), NotificationManager.IMPORTANCE_LOW)
            )
        }
        return CHANNEL
    }

    private fun notification(title: String, text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, TunnelService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, channel())
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, getString(R.string.disconnect), stop).build())
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(title: String, text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTE_ID, notification(title, text))
    }
}
