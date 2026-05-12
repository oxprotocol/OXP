package dev.oxp.jetbrains.edh

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.util.Alarm
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Project-scoped poller that picks up an EDH marker written by
 * `oxp dev` *after* the project window is already open.
 *
 * [EdhStartupActivity] only runs at project-open time. When the user
 * launches `oxp dev` from a terminal while the IDE is already showing
 * the project, IntelliJ just focuses the existing window — no
 * project-open event fires, so the marker on disk is never consumed.
 *
 * This service closes that gap: it polls [EdhMarker.path] every
 * [POLL_INTERVAL_MS] for the project's lifetime and attaches the
 * session as soon as a fresh, matching marker shows up.
 *
 * If a session is already connected or connecting, ticks are no-ops —
 * [EdhMarker.consumeIfMatches] only deletes the marker when it is
 * actually consumed, so this is safe to race with [EdhStartupActivity].
 */
@Service(Service.Level.PROJECT)
class EdhMarkerWatcher(private val project: Project) : Disposable {

    private val alarm = Alarm(Alarm.ThreadToUse.POOLED_THREAD, this)
    private val running = AtomicBoolean(false)

    fun start() {
        if (!running.compareAndSet(false, true)) return
        schedule()
    }

    private fun schedule() {
        if (project.isDisposed || alarm.isDisposed) return
        alarm.addRequest(::tickAndReschedule, POLL_INTERVAL_MS)
    }

    private fun tickAndReschedule() {
        try {
            tick()
        } catch (t: Throwable) {
            thisLogger().warn("EdhMarkerWatcher tick failed", t)
        } finally {
            schedule()
        }
    }

    private fun tick() {
        if (project.isDisposed) return
        val basePath = project.basePath ?: return
        val session = project.getService(OxpDevSession::class.java)

        // Already attached or attaching — let it run, no work to do.
        val status = session.status
        if (status is OxpDevSession.Status.Connecting ||
            status is OxpDevSession.Status.Connected
        ) return

        val payload = EdhMarker.consumeIfMatches(basePath) ?: return
        if (payload.wsUrl.isBlank()) return

        thisLogger().info(
            "OXP EDH: late marker observed for $basePath, attaching to ${payload.wsUrl}"
        )
        session.attach(payload)

        ApplicationManager.getApplication().invokeLater {
            ToolWindowManager.getInstance(project)
                .getToolWindow("OXP Dev")
                ?.activate(null, true)
        }
    }

    override fun dispose() {
        // Alarm is parented on `this` and disposed automatically.
    }

    private companion object {
        const val POLL_INTERVAL_MS = 500
    }
}
