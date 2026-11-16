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

    /** Блокировка трафика после обрыва: держим ссылку, иначе её нечем снять. */
    private var blocker: SfBox? = null

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
                val list = store.attempts()
                if (list.isEmpty()) error(getString(R.string.err_no_servers))
                val chosen = store.chosen()
                val include = if (store.splitMode == "only") chosen.toList() else emptyList()
                val exclude = if (store.splitMode == "only") emptyList() else chosen.toList()
                var reason = getString(R.string.err_no_answer)
                Diag.add("пробуем ${Diag.server(list.first().name)}")
                for ((index, profile) in list.withIndex()) {
                    if (index > 0) {
                        // Человек должен видеть, что происходит: «не ответил, пробую другой»
                        TunnelState.set(TunnelState.Phase.Connecting, getString(R.string.trying_server, profile.name))
                        updateNotification(getString(R.string.notify_connecting), profile.name)
                        Diag.add("предыдущий не ответил, пробуем ${Diag.server(profile.name)}")
                    }
                    val box = SfBox(this@TunnelService)
                    try {
                        box.start(Config.build(profile, store.dns, store.blockIpv6), include, exclude, store.dns)
                    } catch (e: Throwable) {
                        reason = e.message ?: e.javaClass.simpleName
                        box.stop()
                        continue
                    }
                    engine = box
                    if (alive()) {
                        store.selected = "${profile.host}:${profile.port}"
                        Diag.add("туннель поднят на ${Diag.server(profile.name)}")
                        TunnelState.set(TunnelState.Phase.Connected)
                        updateNotification(getString(R.string.notify_connected), profile.name)
                        return@launch
                    }
                    box.stop()
                    engine = null
                }
                Diag.add("ни один сервер не ответил: $reason")
                fail(reason, include, exclude)
                return@launch
            } catch (e: Throwable) {
                android.util.Log.d("K4R-service", "сбой запуска: ${e.javaClass.simpleName}: ${e.message}")
                // Честно: не «защищено», а ошибка с причиной
                fail(e.message ?: e.javaClass.simpleName, emptyList(), emptyList())
            }
        }
    }

    /**
     * Туннель не поднялся. Если включён kill switch — оставляем VPN, который
     * ничего не пропускает, и говорим об этом прямо. Иначе отпускаем трафик.
     */
    private fun fail(reason: String, include: List<String>, exclude: List<String>) {
        Diag.add("отказ: $reason")
        engine?.stop()
        engine = null
        val store = Store(this)
        if (store.killSwitch) {
            try {
                blocker?.stop()
                blocker = SfBox(this).also { it.blackhole(include, exclude) }
                TunnelState.setBlocked(getString(R.string.err_blocked, reason))
                updateNotification(getString(R.string.notify_blocked), reason)
                return
            } catch (e: Throwable) {
                android.util.Log.d("K4R-service", "блокировку не поставить: ${e.message}")
            }
        }
        TunnelState.set(TunnelState.Phase.Error, reason)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun stop() {
        Diag.add("выключено человеком")
        engine?.stop()
        engine = null
        blocker?.stop()
        blocker = null
        TunnelState.set(TunnelState.Phase.Idle)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        engine?.stop()
        engine = null
        // Без этого блокировка пережила бы остановку службы и оставила
        // человека без интернета до перезагрузки.
        blocker?.stop()
        blocker = null
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

    /**
     * Живой ли туннель. Проверяем не «открылся ли сокет» — ядро принимает
     * соединение само и отвечает согласием даже когда сервер мёртв, — а пришли
     * ли настоящие данные. Запрос идёт по адресу, без DNS: иначе мёртвый
     * туннель подвешивает разрешение имени на десятки секунд.
     */
    private suspend fun alive(): Boolean {
        for (attempt in 1..2) {
            delay(800)
            if (reachable()) return true
        }
        return false
    }

    private fun reachable(): Boolean = try {
        val task = java.util.concurrent.Executors.newSingleThreadExecutor().submit<Boolean> {
            val connection = (URL("http://1.1.1.1/cdn-cgi/trace").openConnection() as HttpURLConnection).apply {
                connectTimeout = 4000
                readTimeout = 4000
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "K4R-Neko-VPN/0.1")
            }
            try {
                val code = connection.responseCode
                code in 200..399 && connection.inputStream.read() >= 0
            } finally {
                connection.disconnect()
            }
        }
        try {
            task.get(5, java.util.concurrent.TimeUnit.SECONDS)
        } catch (e: java.util.concurrent.TimeoutException) {
            task.cancel(true)
            false
        }
    } catch (e: Throwable) {
        android.util.Log.d("K4R-ready", "нет ответа: ${e.javaClass.simpleName}: ${e.message}")
        false
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
