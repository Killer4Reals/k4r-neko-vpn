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

    /** Одна попытка за раз: иначе сторож сети и кнопка запускают две. */
    private val active = java.util.concurrent.atomic.AtomicBoolean(false)

    /** Сколько раз пробовали сами после возврата сети. */
    private var retries = 0

    /** Сторож сети: ждём, когда связь вернётся, и пробуем снова. */
    private var watcher: android.net.ConnectivityManager.NetworkCallback? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start()
            ACTION_STOP -> stop()
        }
        return START_STICKY
    }

    private fun start() {
        if (!active.compareAndSet(false, true)) {
            Diag.add("попытка уже идёт — второй раз не начинаем")
            return
        }
        TunnelState.set(TunnelState.Phase.Connecting)
        try {
            startForeground(NOTE_ID, notification(getString(R.string.notify_connecting), getString(R.string.notify_connecting_text)))
        } catch (e: Throwable) {
            // Система может не разрешить службу переднего плана (например,
            // сразу после загрузки). Это не повод падать: говорим причину.
            Diag.add("службу не поднять: ${e.javaClass.simpleName}")
            active.set(false)
            TunnelState.set(TunnelState.Phase.Error, getString(R.string.err_service))
            stopSelf()
            return
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        scope.launch {
            try {
                val store = Store(this@TunnelService)
                val list = store.attempts()
                if (list.isEmpty()) error(getString(R.string.err_no_servers))
                val chosen = store.chosen()
                // Себя всегда держим внутри туннеля: иначе проверка IP и
                // спидтест мерили бы прямое соединение и врали бы человеку.
                val include = if (store.splitMode == "only") (chosen + packageName).toList() else emptyList()
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
                    box.onTraffic = { rx, tx -> count(rx, tx) }
                    try {
                        box.start(Config.build(profile, store.dns, store.blockIpv6), include, exclude, store.dns)
                    } catch (e: Throwable) {
                        reason = e.message ?: e.javaClass.simpleName
                        box.stop()
                        continue
                    }
                    engine = box
                    // Ядро может умереть уже после успешного запуска: тогда
                    // честно переводим в «Ошибка» и держим трафик, если включён
                    // kill switch, — иначе человек думает, что он под защитой.
                    box.onStop = { reason -> coreStopped(reason, include, exclude) }
                    if (alive()) {
                        store.selected = "${profile.host}:${profile.port}"
                        // Туннель поднялся: сторож сети и счётчик попыток больше
                        // не нужны, иначе он дёрнет запуск уже во время работы
                        unwatchNetwork()
                        retries = 0
                        Diag.add("туннель поднят на ${Diag.server(profile.name)}")
                        TunnelState.set(TunnelState.Phase.Connected)
                        updateNotification(getString(R.string.notify_connected), profile.name)
                        return@launch
                    }
                    box.stop()
                    engine = null
                }
                Diag.add("ни один сервер не ответил: $reason")
                active.set(false)
                fail(reason, include, exclude)
                return@launch
            } catch (e: Throwable) {
                android.util.Log.d("K4R-service", "сбой запуска: ${e.javaClass.simpleName}: ${e.message}")
                // Честно: не «защищено», а ошибка с причиной
                active.set(false)
                fail(e.message ?: e.javaClass.simpleName, emptyList(), emptyList())
            }
        }
    }

    /** Ядро остановилось само: показываем причину и, если нужно, блокируем трафик. */
    private fun coreStopped(reason: String, include: List<String>, exclude: List<String>) {
        android.util.Log.d("K4R-service", "ядро остановилось: $reason")
        engine?.stop()
        engine = null
        flush()
        active.set(false)
        retries = 0
        fail(reason, include, exclude)
    }

    // Учёт трафика: копим в памяти и пишем в настройки не чаще раза в 20 секунд,
    // чтобы не дёргать диск каждую секунду.
    private var lastRx = 0L
    private var lastTx = 0L
    private var pendingRx = 0L
    private var pendingTx = 0L
    private var ticks = 0

    private fun count(rx: Long, tx: Long) {
        // Ядро может начать счёт заново после перезапуска профиля: тогда
        // счётчики уменьшились, и разницу считать нельзя.
        if (rx >= lastRx) pendingRx += rx - lastRx
        if (tx >= lastTx) pendingTx += tx - lastTx
        lastRx = rx
        lastTx = tx
        ticks++
        if (ticks >= 20) flush()
    }

    private fun flush() {
        ticks = 0
        val rx = pendingRx
        val tx = pendingTx
        pendingRx = 0
        pendingTx = 0
        if (rx > 0 || tx > 0) Store(this).addUsage(rx, tx)
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
                watchNetwork()
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
        unwatchNetwork()
        active.set(false)
        retries = 0
        engine?.stop()
        engine = null
        blocker?.stop()
        blocker = null
        TunnelState.set(TunnelState.Phase.Idle)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        flush()
        engine?.stop()
        engine = null
        // Без этого блокировка пережила бы остановку службы и оставила
        // человека без интернета до перезагрузки.
        blocker?.stop()
        blocker = null
        unwatchNetwork()
        active.set(false)
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
     * Пока трафик заблокирован, ждём возврата сети: человек вышел из метро или
     * включил Wi-Fi — соединение должно подняться само, а не требовать заново
     * нажимать кнопку. Пробуем не больше трёх раз, чтобы не крутиться в цикле.
     */
    private fun watchNetwork() {
        if (watcher != null) return
        val manager = getSystemService(android.net.ConnectivityManager::class.java) ?: return
        // Слушаем не «сеть по умолчанию» — ею после блокировки стал наш же
        // пустой VPN, и он никуда не пропадает. Нужны обычные сети без VPN:
        // запоминаем, какие уже есть, и ждём появления новой.
        val known = try {
            manager.allNetworks.map { it.networkHandle }.toSet()
        } catch (e: Throwable) {
            emptySet()
        }
        val request = android.net.NetworkRequest.Builder()
            .addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .build()
        val callback = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                if (retries >= 3) return
                if (network.networkHandle in known) return
                retries++
                Diag.add("сеть вернулась — пробуем ещё раз ($retries из 3)")
                start()
            }
        }
        try {
            manager.registerNetworkCallback(request, callback)
            watcher = callback
            Diag.add("ждём возврата сети")
        } catch (e: Throwable) {
            Diag.add("сторож сети не поставлен: ${e.javaClass.simpleName}")
        }
    }

    private fun unwatchNetwork() {
        val callback = watcher ?: return
        watcher = null
        try {
            getSystemService(android.net.ConnectivityManager::class.java)?.unregisterNetworkCallback(callback)
        } catch (e: Throwable) {
            // уже снят системой
        }
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
