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

/**
 * Туннель на Android. Отличие от Windows: адаптер создаём через VpnService,
 * а не через WinAPI, поэтому вся настройка адресов и маршрутов идёт здесь.
 *
 * Пока это каркас: сервис поднимает уведомление и подготовленный интерфейс.
 * Подключение движка sing-box (libbox) — следующий шаг, см. ADR-005.
 */
class TunnelService : VpnService() {

    companion object {
        const val ACTION_START = "ink.k4r.nekoneko.START"
        const val ACTION_STOP = "ink.k4r.nekoneko.STOP"
        private const val CHANNEL = "tunnel"
        private const val NOTE_ID = 1
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start()
            ACTION_STOP -> stop()
        }
        return START_STICKY
    }

    private fun start() {
        startForeground(NOTE_ID, notification())
        // TODO(шаг 3 плана): Builder с адресом 10.10.0.1/32, DNS из каталога,
        // allowed/disallowed приложениями, затем передача fd в sing-box.
    }

    private fun stop() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, getString(R.string.channel_tunnel), NotificationManager.IMPORTANCE_LOW)
            )
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, TunnelService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.notify_connected))
            .setContentText(getString(R.string.notify_connected_text))
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, getString(R.string.disconnect), stop).build())
            .setOngoing(true)
            .build()
    }
}
