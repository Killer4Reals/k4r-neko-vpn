package ink.k4r.nekoneko.vpn

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.VpnService
import io.nekohasekai.libbox.CommandClient
import io.nekohasekai.libbox.CommandClientHandler
import io.nekohasekai.libbox.CommandClientOptions
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.NeighborUpdateListener
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.SetupOptions
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.SystemProxyStatus
import io.nekohasekai.libbox.TunOptions
import java.io.File
import java.net.Inet4Address
import java.net.Inet6Address

/**
 * Обёртка над ядром sing-box (libbox.aar). Ядро само просит у нас TUN-интерфейс
 * через [PlatformInterface.openTun] — его создаёт VpnService, а ядру достаётся
 * готовый файловый дескриптор. Всё остальное ядро делает само.
 */
class SfBox(private val service: VpnService) {

    private var server: CommandServer? = null
    private var hole: android.os.ParcelFileDescriptor? = null
    private var client: CommandClient? = null

    /** Запускает конфиг. Ошибку не глотаем: пусть вызывающий покажет её честно. */
    fun start(config: String, include: List<String>, exclude: List<String>, dns: String) {
        ensureSetup()
        val platform = Platform(service, include, exclude, dns)
        val handler = Handler()
        val box = Libbox.newCommandServer(handler, platform)
        box.start()
        // Пустой объект, а не null: ядро читает его поля сразу, без проверки
        box.startOrReloadService(config, OverrideOptions())
        server = box
        // Счётчики трафика берём у самого ядра: файлы /sys/class/net на Android
        // закрыты, а ядро знает свои байты точно.
        val options = CommandClientOptions().apply {
            statusInterval = 1000
            addCommand(Libbox.CommandStatus)
        }
        val traffic = Libbox.newCommandClient(TrafficHandler(), options)
        traffic.connect()
        client = traffic
    }

    fun stop() {
        try {
            hole?.close()
        } catch (e: Exception) {
        }
        hole = null
        try {
            client?.disconnect()
        } catch (e: Exception) {
        }
        client = null
        try {
            server?.closeService()
        } catch (e: Exception) {
            // ядро могло уже упасть; это не повод падать приложению
        }
        try {
            server?.close()
        } catch (e: Exception) {
        }
        server = null
    }

    /**
     * Kill switch: поднимаем VPN без ядра. Маршруты забирают весь трафик,
     * а читать из интерфейса некому — значит пакеты просто пропадают.
     * Так человек не уходит «в открытое море» после обрыва туннеля.
     */
    fun blackhole(include: List<String>, exclude: List<String>) {
        stop()
        val builder = service.Builder()
            .setSession("K4R Neko VPN (блокировка)")
            .addAddress("172.19.0.1", 30)
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)
            .setMtu(1350)
            .setBlocking(true)
        for (pkg in include) {
            try {
                builder.addAllowedApplication(pkg)
            } catch (e: Exception) {
            }
        }
        for (pkg in exclude) {
            try {
                builder.addDisallowedApplication(pkg)
            } catch (e: Exception) {
            }
        }
        hole = builder.establish()
    }

    fun version(): String = try {
        Libbox.version()
    } catch (e: Throwable) {
        "?"
    }

    private fun ensureSetup() {
        val base = File(service.filesDir, "sing-box")
        val work = File(service.noBackupFilesDir, "sing-box")
        val temp = File(service.cacheDir, "sing-box")
        for (dir in listOf(base, work, temp)) dir.mkdirs()
        Libbox.setup(
            SetupOptions().apply {
                basePath = base.absolutePath
                workingPath = work.absolutePath
                tempPath = temp.absolutePath
                // На Android ядро само не может читать маршруты — правим под платформу
                fixAndroidStack = true
            }
        )
    }

    /** Что система сообщает ядру: TUN, маршруты, список приложений. */
    private class Platform(
        private val service: VpnService,
        private val include: List<String>,
        private val exclude: List<String>,
        private val dns: String,
    ) : PlatformInterface {

        private var tunFd: Int? = null

        override fun openTun(options: TunOptions): Int {
            fun iterate(
                iterator: io.nekohasekai.libbox.RoutePrefixIterator,
                action: (io.nekohasekai.libbox.RoutePrefix) -> Unit,
            ) {
                while (iterator.hasNext()) action(iterator.next())
            }

            val builder = service.Builder()
            builder.setSession("K4R Neko VPN")
            builder.setMtu(options.mtu.takeIf { it > 0 } ?: 9000)
            iterate(options.inet4Address) { builder.addAddress(it.address(), it.prefix()) }
            iterate(options.inet6Address) { builder.addAddress(it.address(), it.prefix()) }
            iterate(options.inet4RouteAddress) { builder.addRoute(it.address(), it.prefix()) }
            iterate(options.inet6RouteAddress) { builder.addRoute(it.address(), it.prefix()) }
            if (options.autoRoute) {
                builder.addRoute("0.0.0.0", 0)
            }
            if (dns.isNotEmpty()) {
                dns.split(',', ' ').filter { it.isNotBlank() }.forEach { builder.addDnsServer(it.trim()) }
            }
            // Разделение по программам: ровно те же два режима, что в Windows-версии
            for (pkg in include) {
                try {
                    builder.addAllowedApplication(pkg)
                } catch (e: Exception) {
                }
            }
            for (pkg in exclude) {
                try {
                    builder.addDisallowedApplication(pkg)
                } catch (e: Exception) {
                }
            }
            if (options.strictRoute) builder.setBlocking(true)
            // Имя интерфейса система выбирает сама: запоминаем, что появилось
            val before = Traffic.tunNames()
            val fd = builder.establish() ?: error("система не дала создать VPN-интерфейс")
            Traffic.interfaceName = (Traffic.tunNames() - before).firstOrNull()
                ?: Traffic.tunNames().firstOrNull()
            val raw = fd.detachFd()
            tunFd = raw
            return raw
        }

        override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

        override fun autoDetectInterfaceControl(fd: Int) {
            service.protect(fd)
        }

        override fun usePlatformBridge(): Boolean = false

        override fun usePlatformShell(): Boolean = false

        override fun checkPlatformShell() {}

        override fun lookupSFTPServer(): String = ""

        override fun includeAllNetworks(): Boolean = false

        /** Ни один метод ниже не бросает исключение: ядро зовёт их из Go, и
         *  выброшенное исключение убивает процесс целиком. */
        override fun readWIFIState(): io.nekohasekai.libbox.WIFIState {
            val manager = service.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
            val info = try {
                manager.connectionInfo
            } catch (e: Exception) {
                null
            }
            val ssid = info?.ssid?.trim('"').orEmpty()
            val bssid = info?.bssid.orEmpty()
            return io.nekohasekai.libbox.WIFIState(ssid, bssid)
        }

        /** Имена интерфейсов, которые ядро должно пропускать мимо туннеля. */
        override fun registerMyInterface(name: String) {
            myInterfaces += name
        }

        private val myInterfaces = mutableSetOf<String>()
        private val monitors = mutableMapOf<InterfaceUpdateListener, ConnectivityManager.NetworkCallback>()

        /**
         * Ядру нужно знать, через какой интерфейс выходить наружу: без этого
         * прямой сокет уходит обратно в туннель и разрешение имён зацикливается.
         */
        override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
            val manager = service.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = report(manager, network, listener)

                override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) =
                    report(manager, network, listener)

                override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
                    report(manager, network, listener)
            }
            manager.registerDefaultNetworkCallback(callback)
            monitors[listener] = callback
            manager.activeNetwork?.let { report(manager, it, listener) }
        }

        private fun report(manager: ConnectivityManager, network: Network, listener: InterfaceUpdateListener) {
            val properties = manager.getLinkProperties(network) ?: return
            val name = properties.interfaceName ?: return
            if (name in myInterfaces || name.startsWith("tun")) return
            val capabilities = manager.getNetworkCapabilities(network)
            val metered = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) != true
            val index = try {
                java.net.NetworkInterface.getByName(name)?.index ?: 0
            } catch (e: Exception) {
                0
            }
            listener.updateDefaultInterface(name, index, metered, false)
        }

        override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
            val manager = service.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            monitors.remove(listener)?.let {
                try {
                    manager.unregisterNetworkCallback(it)
                } catch (e: Exception) {
                }
            }
        }

        override fun startNeighborMonitor(listener: NeighborUpdateListener) {}

        override fun closeNeighborMonitor(listener: NeighborUpdateListener) {}

        override fun sendNotification(notification: io.nekohasekai.libbox.Notification) {}

        override fun cancelNotification(tag: String, id: Int) {}

        /** Список интерфейсов системы в том виде, в каком его ждёт ядро. */
        override fun getInterfaces(): io.nekohasekai.libbox.NetworkInterfaceIterator {
            val out = mutableListOf<io.nekohasekai.libbox.NetworkInterface>()
            val system = java.net.NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            for (entry in system) {
                val model = io.nekohasekai.libbox.NetworkInterface()
                model.name = entry.name
                model.index = entry.index
                model.mtu = try {
                    entry.mtu
                } catch (e: Exception) {
                    0
                }
                model.flags = entry.flagsValue()
                val addresses = entry.interfaceAddresses.mapNotNull { address ->
                    val host = address.address
                    val prefix = when (host) {
                        is Inet4Address, is Inet6Address -> address.networkPrefixLength.toInt()
                        else -> return@mapNotNull null
                    }
                    // зона (fe80::1%dummy0) в префикс не влезает — ядро падает
                    "${host.hostAddress.substringBefore('%')}/$prefix"
                }
                model.addresses = StringList(addresses)
                model.dnsServer = StringList(emptyList())
                model.gateway = StringList(emptyList())
                model.metered = false
                out += model
            }
            return object : io.nekohasekai.libbox.NetworkInterfaceIterator {
                private var position = 0

                override fun hasNext(): Boolean = position < out.size

                override fun next(): io.nekohasekai.libbox.NetworkInterface = out[position++]
            }
        }

        override fun findConnectionOwner(
            ipProtocol: Int,
            sourceAddress: String,
            sourcePort: Int,
            destinationAddress: String,
            destinationPort: Int,
        ): io.nekohasekai.libbox.ConnectionOwner = io.nekohasekai.libbox.ConnectionOwner()

        override fun openShellSession(
            user: io.nekohasekai.libbox.PlatformUser,
            command: String,
            args: StringIterator,
            workingDir: String,
            terminalWidth: Int,
            terminalHeight: Int,
        ): io.nekohasekai.libbox.ShellSession =
            throw UnsupportedOperationException("оболочки на телефоне нет")

        override fun lookupUser(username: String): io.nekohasekai.libbox.PlatformUser =
            io.nekohasekai.libbox.PlatformUser()

        override fun readSystemSSHHostKey(): String = ""

        override fun tailscaleHostname(): String = ""

        override fun underNetworkExtension(): Boolean = false

        override fun localDNSTransport(): io.nekohasekai.libbox.LocalDNSTransport? = null

        override fun createBridge(options: io.nekohasekai.libbox.BridgeOptions): io.nekohasekai.libbox.BridgeSession =
            throw UnsupportedOperationException("мост между приложениями не нужен")

        override fun clearDNSCache() {}
    }

    /** Ядро присылает счётчики раз в секунду — показываем их как есть. */
    private class TrafficHandler : CommandClientHandler {
        override fun writeStatus(status: io.nekohasekai.libbox.StatusMessage) {
            if (!status.trafficAvailable) return
            TunnelState.traffic(
                rx = status.downlinkTotal,
                tx = status.uplinkTotal,
                rxSpeed = status.downlink,
                txSpeed = status.uplink,
            )
        }

        override fun writeLogs(logs: io.nekohasekai.libbox.LogIterator) {}
        override fun writeConnectionEvents(events: io.nekohasekai.libbox.ConnectionEvents) {}
        override fun writeGroups(groups: io.nekohasekai.libbox.OutboundGroupIterator) {}
        override fun writeOutbounds(items: io.nekohasekai.libbox.OutboundGroupItemIterator) {}
        override fun initializeClashMode(modes: StringIterator, current: String) {}
        override fun updateClashMode(mode: String) {}
        override fun setDefaultLogLevel(level: Int) {}
        override fun clearLogs() {}
        override fun connected() {}
        override fun disconnected(message: String) {}
    }

    /** События от ядра: перезапуск профиля, остановка, системный прокси. */
    private class Handler : CommandServerHandler {
        /** Журнал ядра уходит в logcat: без него отказы не разобрать. */
        override fun writeDebugMessage(message: String) {
            android.util.Log.d("K4R-engine", message)
        }

        override fun serviceReload() {}

        override fun serviceStop() {}

        override fun setSystemProxyEnabled(enabled: Boolean) {}

        override fun triggerNativeCrash() {}

        override fun connectSSHAgent(): Int = -1

        override fun getSystemProxyStatus(): SystemProxyStatus =
            SystemProxyStatus().apply {
                available = false
                enabled = false
            }
    }
}

/** Простой итератор строк: ядро просит их через gomobile-интерфейс. */
private class StringList(private val items: List<String>) : StringIterator {
    private var position = 0

    override fun hasNext(): Boolean = position < items.size

    override fun len(): Int = items.size - position

    override fun next(): String = items[position++]
}

/** Флаги интерфейса в том же виде, что у Go: up = 1. */
private fun java.net.NetworkInterface.flagsValue(): Int {
    var value = 0
    if (isUp) value = value or 0x1
    if (isLoopback) value = value or 0x8
    if (isPointToPoint) value = value or 0x10
    if (supportsMulticast()) value = value or 0x1000
    return value
}
