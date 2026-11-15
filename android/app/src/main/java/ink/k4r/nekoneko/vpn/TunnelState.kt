package ink.k4r.nekoneko.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Одно место, где живёт состояние туннеля. «Защищено» ставится только после
 * того, как ядро реально стартовало — не по нажатию кнопки.
 */
object TunnelState {

    enum class Phase { Idle, Connecting, Connected, Error }

    data class State(val phase: Phase = Phase.Idle, val reason: String = "")

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun set(phase: Phase, reason: String = "") {
        _state.value = State(phase, reason)
    }
}
