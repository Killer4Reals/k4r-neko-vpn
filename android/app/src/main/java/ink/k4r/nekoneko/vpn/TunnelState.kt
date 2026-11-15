package ink.k4r.nekoneko.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Одно место, где живёт состояние туннеля. «Защищено» ставится только после
 * того, как ядро реально стартовало — не по нажатию кнопки.
 */
object TunnelState {

    enum class Phase { Idle, Connecting, Connected, Error }

    data class State(
        val phase: Phase = Phase.Idle,
        val reason: String = "",
        /** Всего принято и отдано через туннель, байты. */
        val rx: Long = 0,
        val tx: Long = 0,
        /** Скорость за последнюю секунду, байты в секунду. */
        val rxSpeed: Long = 0,
        val txSpeed: Long = 0,
        /** Туннель упал, но VPN держим: трафик никуда не идёт (kill switch). */
        val blocked: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun set(phase: Phase, reason: String = "") {
        _state.value = State(phase, reason)
    }

    /** Туннель упал, а мы при этом держим блокировку трафика. */
    fun setBlocked(reason: String) {
        _state.value = State(Phase.Error, reason, blocked = true)
    }

    /** Обновляем только счётчики, не трогая состояние туннеля. */
    fun traffic(rx: Long, tx: Long, rxSpeed: Long, txSpeed: Long) {
        _state.value = _state.value.copy(rx = rx, tx = tx, rxSpeed = rxSpeed, txSpeed = txSpeed)
    }
}
