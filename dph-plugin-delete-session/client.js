/**
 * Delete Session — Client half.
 *
 * Registers one row in the legacy Session context-menu slot (before the built-in
 * Archive action) and one frame-wide confirmation dialog in `shell.overlay`.
 * The row is the entry point; the dialog confirms deletion by default. An
 * explicit, saved local preference allows subsequent direct deletions. The Host
 * requires a same-origin request, a per-process token, and `confirm: true`.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-session-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-session-delete'
    const API = '/api/dsh-session-delete'
    const SKIP_CONFIRMATION_KEY = 'dsh-session-delete:skip-confirmation:v1'

    const en = {
      'menu.delete': 'Delete session',
      'menu.delete.title': 'Permanently delete this session',
      'menu.restoreConfirmation': 'Restore delete confirmation',
      'dialog.title': 'Delete session permanently?',
      'dialog.warning': 'Deleting removes the session and all its messages. Archiving only hides the session; deletion cannot be undone.',
      'dialog.loading': 'Checking what will be deleted…',
      'dialog.session': 'Session',
      'dialog.untitled': 'Untitled session',
      'dialog.messages': 'Events stored',
      'dialog.size': 'Stored size',
      'dialog.created': 'Created',
      'dialog.cwd': 'Working directory',
      'dialog.status': 'Status',
      'dialog.archived': 'Archived',
      'dialog.pinned': 'Pinned',
      'dialog.childWarning': 'This session has {count} child session(s). They will remain, but their parent link will be missing.',
      'dialog.parentWarning': 'This session is a child of another session. The parent will no longer be able to open it.',
      'dialog.deletes': 'Permanently deletes',
      'dialog.deleteLog': 'The session-owned log directory: all messages, tool calls, system prompts, checkpoints, and stored format generations.',
      'dialog.deleteCache': 'The derived projection cache for this session.',
      'dialog.deleteWorkspace': 'This session’s workspace membership, archive entry, and pin.',
      'dialog.keeps': 'Leaves in place',
      'dialog.keepAttachments': 'Content-addressed attachments that other sessions may still use.',
      'dialog.keepChildren': 'Child sessions and their logs.',
      'dialog.ack': 'I understand this cannot be undone.',
      'dialog.skipConfirmation': 'Do not show the deletion confirmation again',
      'dialog.skipConfirmationHelp': 'After this deletion succeeds, choosing “Delete session” will permanently delete sessions directly on this device.',
      'dialog.skipConfirmationSaved': 'Future deletions on this device will run directly. Use “Restore delete confirmation” in the session menu to show this dialog again.',
      'dialog.preferenceSaveFailed': 'The session was deleted, but this preference could not be saved. Future deletions will still ask for confirmation.',
      'dialog.confirmationRestored': 'Delete confirmation restored.',
      'dialog.confirmationRestoreFailed': 'Confirmation is restored for this page, but could not be saved. Check the setting again after restarting.',
      'dialog.cancel': 'Cancel',
      'dialog.delete': 'Delete permanently',
      'dialog.deleting': 'Deleting…',
      'dialog.close': 'Close',
      'dialog.retry': 'Retry',
      'dialog.recheck': 'Check again',
      'dialog.blocked': 'This session cannot be deleted right now.',
      'dialog.active': 'This session has work in progress: {activity}. Wait for it to finish or stop the relevant tasks, then check again.',
      'dialog.activity': 'running work',
      'dialog.activity.turn': 'reply generation',
      'dialog.activity.job': 'background task',
      'dialog.activity.subagent': 'subagent',
      'dialog.activity.schedule': 'scheduled task',
      'dialog.activity.maintenance': 'updating session state',
      'dialog.live': 'This session is loaded in memory and cannot currently be closed safely. Check again shortly.',
      'dialog.loadedIdle': 'This session is loaded in memory but has no running tasks. Confirming deletion will close the session, then permanently delete its log and all messages. You do not need to switch sessions or restart Harness.',
      'dialog.releaseFailed': 'The session could not be released safely. Its stored log and messages were kept; permanent deletion did not run. If the session is missing from the list, refresh the page and check again.',
      'dialog.releaseUnavailable': 'This version cannot safely release the session. Permanent deletion did not run. Update the deletion plugin or Harness and try again.',
      'dialog.deleteInProgress': 'This session is being deleted. Please wait.',
      'dialog.notMaterialized': 'The session has no stored log yet.',
      'dialog.unsupported': 'This session uses a storage layout that this plugin does not support.',
      'dialog.notFound': 'The session no longer exists.',
      'dialog.activityFailed': 'The running-work check failed: {message}',
      'dialog.stalePage': 'The delete-session token has expired. Refresh the page and try again.',
      'dialog.forbiddenOrigin': 'The Host rejected this page’s request origin. Open Harness through its desktop app or local web address. If this persists, check plugin compatibility.',
      'dialog.tokenUnavailable': 'Could not obtain the delete-session token. Check that the plugin is enabled and the Host is available, then try again.',
      'dialog.ackRequired': 'First select “I understand this cannot be undone.”',
      'dialog.deleteFailed': 'Delete failed: {message}',
      'dialog.unknownError': 'Unknown error',
      'dialog.success': 'Session deleted.',
      'dialog.successBody': 'The session was removed from the sidebar. Its log and derived projection cache were deleted.',
      'dialog.alreadyGone': 'The session log was already gone.',
      'dialog.warningTitle': 'Cleanup notes',
      'dialog.warning.detach': 'Workspace membership could not be fully cleaned: {message}. It will be reconciled on the next restart.',
      'dialog.warning.archive': 'The archive entry could not be cleaned: {message}. It will be reconciled on the next restart.',
      'dialog.warning.pin': 'The pin could not be cleaned: {message}. It will be reconciled on the next restart.',
      'dialog.warning.cache': 'The derived projection cache could not be deleted: {message}.',
      'dialog.warning.cacheUnavailable': 'The projection cache was not available; no cache record was deleted.',
      'dialog.warning.verify': 'The session log path still exists after deletion completed.',
      'dialog.warning.emit': 'The sidebar refresh notification could not be sent. Refresh the page to update the list.',
      'dialog.warning.workspace': 'The workspace registry was not available; workspace metadata was not cleaned.',
      'dialog.warning.leaseRelease': 'The session was deleted, but its deletion lock could not be released: {message}. Restart Harness.',
      'dialog.warning.other': '{message}',
      'dialog.bytes': '{value}',
      'dialog.count': '{count}',
    }

    const zh = {
      'menu.delete': '删除会话',
      'menu.delete.title': '永久删除此会话',
      'menu.restoreConfirmation': '恢复删除确认提示',
      'dialog.title': '永久删除会话？',
      'dialog.warning': '删除会移除该会话及其全部消息。归档只是隐藏会话；删除无法撤销。',
      'dialog.loading': '正在检查将要删除的内容…',
      'dialog.session': '会话',
      'dialog.untitled': '未命名会话',
      'dialog.messages': '已存储事件',
      'dialog.size': '存储大小',
      'dialog.created': '创建时间',
      'dialog.cwd': '工作目录',
      'dialog.status': '状态',
      'dialog.archived': '已归档',
      'dialog.pinned': '已置顶',
      'dialog.childWarning': '该会话有 {count} 个子会话。子会话会保留，但它们指向该会话的父级链接将缺失。',
      'dialog.parentWarning': '该会话是另一个会话的子会话。删除后，父会话将无法再打开它。',
      'dialog.deletes': '将永久删除',
      'dialog.deleteLog': '会话专属日志目录：全部消息、工具调用、系统提示、检查点以及已存储的格式版本。',
      'dialog.deleteCache': '该会话的派生投影缓存。',
      'dialog.deleteWorkspace': '该会话的工作区归属、归档记录与置顶记录。',
      'dialog.keeps': '将保留',
      'dialog.keepAttachments': '可能仍被其他会话使用的按内容寻址的附件。',
      'dialog.keepChildren': '子会话及其日志。',
      'dialog.ack': '我已理解此操作无法撤销。',
      'dialog.skipConfirmation': '以后删除不再弹出确认框',
      'dialog.skipConfirmationHelp': '本次删除成功后，在这台设备上点击“删除会话”将直接永久删除。',
      'dialog.skipConfirmationSaved': '此设备后续将直接删除。需要恢复时，请在会话菜单中选择“恢复删除确认提示”。',
      'dialog.preferenceSaveFailed': '会话已删除，但未能保存此设置。下次删除仍会显示确认框。',
      'dialog.confirmationRestored': '已恢复删除确认提示。',
      'dialog.confirmationRestoreFailed': '已为当前页面恢复确认，但未能保存设置。下次启动后请重新检查。',
      'dialog.cancel': '取消',
      'dialog.delete': '永久删除',
      'dialog.deleting': '正在删除…',
      'dialog.close': '关闭',
      'dialog.retry': '重试',
      'dialog.recheck': '重新检查',
      'dialog.blocked': '当前无法删除该会话。',
      'dialog.active': '该会话有正在进行的工作：{activity}。请等待完成或先停止相关任务，再重新检查。',
      'dialog.activity': '运行中的工作',
      'dialog.activity.turn': '对话生成',
      'dialog.activity.job': '后台任务',
      'dialog.activity.subagent': '子智能体',
      'dialog.activity.schedule': '计划任务',
      'dialog.activity.maintenance': '正在更新会话状态',
      'dialog.live': '该会话已加载到内存，但当前无法安全关闭，暂不能删除。请稍后重新检查。',
      'dialog.loadedIdle': '该会话已加载到内存，但当前没有运行中的任务。确认删除后将先释放会话，再永久删除日志及全部消息，无需切换会话或重启。',
      'dialog.releaseFailed': '无法安全释放该会话，已保存的日志和消息均保留，未执行永久删除。若会话暂时未出现在列表中，请刷新页面后重新检查。',
      'dialog.releaseUnavailable': '当前版本无法安全释放该会话，未执行永久删除。请更新删除插件或 Harness 后重试。',
      'dialog.deleteInProgress': '该会话正在删除，请稍候。',
      'dialog.notMaterialized': '该会话尚无已落盘的日志。',
      'dialog.unsupported': '该会话使用的存储布局不受此插件支持。',
      'dialog.notFound': '该会话已不存在。',
      'dialog.activityFailed': '运行状态检查失败：{message}',
      'dialog.stalePage': '删除会话的授权令牌已失效。请刷新页面后重试。',
      'dialog.forbiddenOrigin': 'Host 拒绝了当前页面的请求来源。请通过 Harness 桌面客户端或本机网页地址访问；若仍失败，请检查插件兼容性。',
      'dialog.tokenUnavailable': '无法获取删除会话的授权令牌。请确认插件已启用且 Host 可用，然后重试。',
      'dialog.ackRequired': '请先勾选“我已理解此操作无法撤销”。',
      'dialog.deleteFailed': '删除失败：{message}',
      'dialog.unknownError': '未知错误',
      'dialog.success': '会话已删除。',
      'dialog.successBody': '该会话已从侧边栏移除，其日志与派生投影缓存已删除。',
      'dialog.alreadyGone': '会话日志此前已经不存在。',
      'dialog.warningTitle': '清理提示',
      'dialog.warning.detach': '工作区归属未能完全清理：{message}。将在下次重启时自动校正。',
      'dialog.warning.archive': '归档记录未能清理：{message}。将在下次重启时自动校正。',
      'dialog.warning.pin': '置顶记录未能清理：{message}。将在下次重启时自动校正。',
      'dialog.warning.cache': '派生投影缓存未能删除：{message}。',
      'dialog.warning.cacheUnavailable': '投影缓存当前不可用，未删除缓存记录。',
      'dialog.warning.verify': '删除完成后，会话日志路径仍然存在。',
      'dialog.warning.emit': '侧边栏刷新通知发送失败。请刷新页面以更新列表。',
      'dialog.warning.workspace': '工作区注册表当前不可用，未清理工作区元数据。',
      'dialog.warning.leaseRelease': '会话已删除，但删除锁释放失败：{message}。请重启 Harness。',
      'dialog.warning.other': '{message}',
      'dialog.bytes': '{value}',
      'dialog.count': '{count}',
    }

    const CSS = `
.dsd-menu-item{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:32px;margin:0;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;pointer-events:auto}
.dsd-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dsd-menu-item:disabled{opacity:.55;cursor:default}
.dsd-menu-item.restore-confirmation{color:var(--dsw-alias-label-secondary)}
.dsd-menu-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsd-menu-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}
.dsd-scrim{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;box-sizing:border-box;padding:24px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 32%,transparent);pointer-events:auto}
.dsd-dialog{box-sizing:border-box;width:min(600px,100%);max-height:calc(100vh - 48px);overflow:auto;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 18px 60px color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent);font-size:13px;line-height:20px}
.dsd-dialog:focus{outline:none}
.dsd-title{margin:0 0 8px;font-size:16px;line-height:24px;font-weight:600}
.dsd-warning{margin:0 0 14px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsd-alert{margin:0 0 14px;padding:10px 12px;border-radius:8px;font-size:13px;line-height:20px}
.dsd-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsd-alert.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}
.dsd-alert.success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}
.dsd-loading{display:flex;align-items:center;gap:10px;padding:10px 0;color:var(--dsw-alias-label-secondary)}
.dsd-spinner{width:16px;height:16px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dsd-spin .8s linear infinite;flex:none}
@keyframes dsd-spin{to{transform:rotate(360deg)}}
.dsd-meta{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 14px;margin:0 0 14px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dsd-meta dt{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsd-meta dd{margin:0;min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsd-badges{display:inline-flex;flex-wrap:wrap;gap:6px}
.dsd-badge{padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
.dsd-section{margin:0 0 14px}
.dsd-section h3{margin:0 0 6px;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsd-section ul{margin:0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsd-section li+li{margin-top:3px}
.dsd-ack{display:flex;align-items:flex-start;gap:8px;margin:0 0 14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}
.dsd-ack input{margin:2px 0 0;accent-color:var(--dsw-alias-state-error-primary);flex:none}
.dsd-ack-group{margin:0 0 14px}
.dsd-ack-group .dsd-ack{margin-bottom:0}
.dsd-ack-group.is-invalid{border-radius:4px;outline:1px solid var(--dsw-alias-state-error-primary);outline-offset:6px;animation:dsd-ack-shake .32s ease-in-out}
.dsd-ack-group.is-invalid.shake-repeat{animation-name:dsd-ack-shake-repeat}
.dsd-ack-group.is-invalid .dsd-ack{color:var(--dsw-alias-state-error-primary)}
.dsd-ack-reminder{margin:6px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dsd-skip{margin:0 0 14px}
.dsd-skip .dsd-ack{margin-bottom:0}
.dsd-skip-help{margin:4px 0 0 22px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
@keyframes dsd-ack-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-4px)}40%,80%{transform:translateX(4px)}}
@keyframes dsd-ack-shake-repeat{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-4px)}40%,80%{transform:translateX(4px)}}
@media(prefers-reduced-motion:reduce){.dsd-ack-group.is-invalid,.dsd-ack-group.is-invalid.shake-repeat{animation:none}}
.dsd-footer{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.dsd-btn{box-sizing:border-box;min-height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsd-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.dsd-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsd-btn:disabled{opacity:.55;cursor:default}
.dsd-btn.needs-ack{opacity:.65}
.dsd-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsd-btn.danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.dsd-warnings{margin:12px 0 0;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.dsd-warnings ul{margin:4px 0 0;padding-left:18px}
.dsd-notices{position:fixed;right:24px;bottom:24px;z-index:1100;display:grid;gap:10px;width:min(380px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;pointer-events:auto}
.dsd-notice{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 8px 28px color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);font-size:13px;line-height:20px}
.dsd-notice.error,.dsd-notice.warning{border-color:var(--dsw-alias-state-error-primary)}
.dsd-notice-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsd-notice-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dsd-notice p{margin:4px 0 0;overflow-wrap:anywhere}
.dsd-notice ul{margin:6px 0 0;padding-left:18px}
.dsd-muted{color:var(--dsw-alias-label-secondary)}
`

    // ---------------------------------------------------------------------
    // Module-level store. The menu entry and the dialog are separate slot
    // entries, so the request must live outside either React tree.
    // ---------------------------------------------------------------------

    let pending = null
    let nextRequestId = 0
    const listeners = new Set()
    const planInflight = new Map()
    const deletionInflight = new Map()
    let forceConfirmation = false
    let skipConfirmation = readSkipConfirmation()
    let notices = []
    let nextNoticeId = 0
    const noticeTimers = new Map()

    function readSkipConfirmation() {
      if (forceConfirmation) return false
      try {
        return window.localStorage.getItem(SKIP_CONFIRMATION_KEY) === 'true'
      } catch {
        return false
      }
    }

    function refreshPreference() {
      const next = readSkipConfirmation()
      if (skipConfirmation !== next) {
        skipConfirmation = next
        notify()
      }
      return next
    }

    function saveSkipConfirmation(value) {
      // Restoring confirmation must work for this page even if storage fails.
      if (!value) forceConfirmation = true
      try {
        if (value) window.localStorage.setItem(SKIP_CONFIRMATION_KEY, 'true')
        else window.localStorage.removeItem(SKIP_CONFIRMATION_KEY)
        forceConfirmation = false
        refreshPreference()
        return true
      } catch {
        if (!value) refreshPreference()
        return false
      }
    }

    function dismissNotice(id) {
      window.clearTimeout(noticeTimers.get(id))
      noticeTimers.delete(id)
      notices = notices.filter((notice) => notice.id !== id)
      notify()
    }

    function setNotice(id, patch) {
      notices = notices.map((notice) => notice.id === id ? { ...notice, ...patch } : notice)
      notify()
      if (patch.kind === 'success') noticeTimers.set(id, window.setTimeout(() => dismissNotice(id), 5000))
    }

    function addNotice(patch) {
      const id = ++nextNoticeId
      notices = [...notices, { id, ...patch }]
      notify()
      if (patch.kind === 'success') noticeTimers.set(id, window.setTimeout(() => dismissNotice(id), 5000))
      return id
    }

    function submitDeletion(sessionId) {
      if (deletionInflight.has(sessionId)) return deletionInflight.get(sessionId)
      const task = apiCall('/delete', { sessionId, confirm: true }).finally(() => {
        deletionInflight.delete(sessionId)
        notify()
      })
      deletionInflight.set(sessionId, task)
      notify()
      return task
    }

    async function deleteDirectly({ sessionId, displayTitle }, t) {
      if (deletionInflight.has(sessionId)) return
      const id = addNotice({ kind: 'pending', title: t('dialog.deleting'), sessionTitle: displayTitle })
      try {
        const value = await submitDeletion(sessionId)
        const warnings = Array.isArray(value?.warnings) ? value.warnings : []
        setNotice(id, { kind: warnings.length > 0 ? 'warning' : 'success', title: t('dialog.success'), warnings })
      } catch (error) {
        setNotice(id, { kind: 'error', title: errorMessage(error, t) })
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function getPending() {
      return pending
    }

    function notify() {
      for (const listener of listeners) {
        try {
          listener()
        } catch {
          // A listener must not break the other entries.
        }
      }
    }

    function setPending(next) {
      pending = next
      notify()
    }

    function updatePending(requestId, patch) {
      if (pending === null || pending.requestId !== requestId) return
      setPending({ ...pending, ...patch })
    }

    function openDialog({ sessionId, displayTitle }) {
      const requestId = ++nextRequestId
      setPending({
        requestId,
        sessionId,
        displayTitle: typeof displayTitle === 'string' ? displayTitle : '',
        phase: 'planning',
        plan: null,
        error: null,
      })
    }

    function closeDialog() {
      setPending(null)
    }

    function usePending() {
      return React.useSyncExternalStore(subscribe, getPending, getPending)
    }

    function renderNotices(items, t) {
      if (items.length === 0) return null
      return h('div', { className: 'dsd-notices' }, items.map((notice) => h('div', {
        key: notice.id,
        className: `dsd-notice ${notice.kind}`,
        role: notice.kind === 'error' || notice.kind === 'warning' ? 'alert' : 'status',
      },
      h('div', { className: 'dsd-notice-head' },
        h('strong', null, notice.title),
        notice.kind !== 'pending' ? h('button', {
          type: 'button', className: 'dsd-notice-close', 'aria-label': t('dialog.close'), onClick: () => dismissNotice(notice.id),
        }, '×') : null,
      ),
      notice.sessionTitle ? h('p', null, notice.sessionTitle) : null,
      notice.warnings?.length > 0 ? h('ul', null, notice.warnings.map((warning, index) => h('li', { key: index }, warningMessage(warning, t)))) : null,
      )))
    }

    // ---------------------------------------------------------------------
    // Host bridge. The token is minted per Host process and available only to
    // a same-origin page. A stale token after Host HMR is refreshed once.
    // ---------------------------------------------------------------------

    class ApiError extends Error {
      constructor(code, message, details = undefined, status = 0) {
        super(message)
        this.name = 'ApiError'
        this.code = code
        this.details = details
        this.status = status
      }
    }

    let tokenCache = null
    let tokenInflight = null

    function asApiError(error) {
      if (error instanceof ApiError) return error
      if (error instanceof Error) return new ApiError('NETWORK', error.message)
      return new ApiError('UNKNOWN', String(error))
    }

    async function getToken(refresh = false) {
      if (!refresh && typeof tokenCache === 'string' && tokenCache !== '') return tokenCache
      if (tokenInflight !== null) return tokenInflight
      tokenInflight = (async () => {
        let response
        try {
          response = await fetch(`${API}/token`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
          })
        } catch (error) {
          throw new ApiError('NETWORK', error instanceof Error ? error.message : String(error))
        }
        let payload = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        if (!response.ok || payload === null || payload.ok !== true || typeof payload.token !== 'string') {
          const detail = payload !== null && payload.error !== undefined ? payload.error : undefined
          throw new ApiError(
            detail?.code ?? 'TOKEN_UNAVAILABLE',
            detail?.message ?? 'Could not obtain the delete-session token.',
            detail?.details,
            response.status,
          )
        }
        tokenCache = payload.token
        return tokenCache
      })().finally(() => {
        tokenInflight = null
      })
      return tokenInflight
    }

    async function apiCall(path, body, retry = true) {
      let token
      try {
        token = await getToken(!retry)
      } catch (error) {
        throw asApiError(error)
      }
      let response
      try {
        response = await fetch(`${API}${path}`, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'content-type': 'application/json',
            'x-dsh-session-delete-token': token,
          },
          body: JSON.stringify(body),
        })
      } catch (error) {
        throw new ApiError('NETWORK', error instanceof Error ? error.message : String(error))
      }

      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }

      if (response.status === 403 && payload?.error?.code === 'FORBIDDEN_TOKEN' && retry) {
        tokenCache = null
        return apiCall(path, body, false)
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        const detail = payload !== null && payload.error !== undefined ? payload.error : undefined
        throw new ApiError(
          detail?.code ?? `HTTP_${response.status}`,
          detail?.message ?? (response.statusText || 'The Host rejected the request.'),
          detail?.details,
          response.status,
        )
      }
      return payload.value
    }

    function requestPlan(requestId, sessionId, force = false) {
      if (!force && planInflight.has(requestId)) return planInflight.get(requestId)
      if (force) planInflight.delete(requestId)
      updatePending(requestId, { phase: 'planning', plan: null, error: null })
      const task = (async () => {
        try {
          const value = await apiCall('/plan', { sessionId })
          updatePending(requestId, { phase: 'ready', plan: value, error: null })
          return value
        } catch (error) {
          updatePending(requestId, { phase: 'error', plan: null, error: asApiError(error) })
          return undefined
        } finally {
          planInflight.delete(requestId)
        }
      })()
      planInflight.set(requestId, task)
      return task
    }

    // ---------------------------------------------------------------------
    // Small formatting helpers.
    // ---------------------------------------------------------------------

    function formatBytes(value, t) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
      if (value < 1024) return t('dialog.bytes', { value: `${value} B` })
      const units = ['KB', 'MB', 'GB', 'TB']
      let amount = value
      let unit = 'B'
      for (const next of units) {
        if (amount < 1024) break
        amount /= 1024
        unit = next
      }
      return t('dialog.bytes', { value: `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}` })
    }

    function formatCount(value, t) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
      return t('dialog.count', { count: new Intl.NumberFormat().format(value) })
    }

    function formatDate(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
      try {
        return new Date(value).toLocaleString()
      } catch {
        return '—'
      }
    }

    function formatActivity(activity, t) {
      if (!Array.isArray(activity) || activity.length === 0) return ''
      const kinds = {
        turn: 'dialog.activity.turn',
        job: 'dialog.activity.job',
        subagent: 'dialog.activity.subagent',
        schedule: 'dialog.activity.schedule',
        maintenance: 'dialog.activity.maintenance',
      }
      return activity
        .map((entry) => {
          if (entry === null || typeof entry !== 'object') return ''
          const kind = t(Object.hasOwn(kinds, entry.kind) ? kinds[entry.kind] : 'dialog.activity')
          const items = Array.isArray(entry.items)
            ? entry.items
              .map((item) => (item !== null && typeof item === 'object' ? item.label ?? '' : ''))
              .filter((item) => typeof item === 'string' && item !== '')
            : []
          return items.length > 0 ? `${kind} (${items.join(', ')})` : kind
        })
        .filter((entry) => entry !== '')
        .join('; ')
    }

    function warningMessage(warning, t) {
      const message = warning !== null && typeof warning === 'object' && typeof warning.message === 'string'
        ? warning.message
        : ''
      switch (warning?.code) {
        case 'PREFERENCE_SAVE_FAILED':
          return t('dialog.preferenceSaveFailed')
        case 'WORKSPACE_DETACH_FAILED':
          return t('dialog.warning.detach', { message })
        case 'UNARCHIVE_FAILED':
          return t('dialog.warning.archive', { message })
        case 'UNPIN_FAILED':
          return t('dialog.warning.pin', { message })
        case 'PROJECTION_CACHE_FAILED':
          return t('dialog.warning.cache', { message })
        case 'PROJECTION_CACHE_UNAVAILABLE':
          return t('dialog.warning.cacheUnavailable')
        case 'VERIFY_FAILED':
          return t('dialog.warning.verify')
        case 'EVENT_EMIT_FAILED':
          return t('dialog.warning.emit')
        case 'WORKSPACE_UNAVAILABLE':
          return t('dialog.warning.workspace')
        case 'WRITE_LEASE_RELEASE_FAILED':
          return t('dialog.warning.leaseRelease', { message })
        default:
          return message === '' ? t('dialog.unknownError') : t('dialog.warning.other', { message })
      }
    }

    function blockedMessage(plan, t) {
      const blocked = plan !== null && typeof plan === 'object' ? plan.blocked : null
      if (blocked === null || typeof blocked !== 'object') return t('dialog.blocked')
      switch (blocked.code) {
        case 'LIVE':
          return t('dialog.live')
        case 'AGENT_RELEASE_FAILED':
          return t('dialog.releaseFailed')
        case 'AGENT_RELEASE_UNAVAILABLE':
          return t('dialog.releaseUnavailable')
        case 'DELETE_IN_PROGRESS':
          return t('dialog.deleteInProgress')
        case 'ACTIVE':
          return t('dialog.active', { activity: formatActivity(plan.activity, t) || t('dialog.activity') })
        case 'NOT_MATERIALIZED':
          return t('dialog.notMaterialized')
        case 'UNSUPPORTED_STORAGE':
        case 'UNEXPECTED_LAYOUT':
          return t('dialog.unsupported')
        case 'ACTIVITY_CHECK_FAILED':
          return t('dialog.activityFailed', { message: blocked.message ?? t('dialog.unknownError') })
        default:
          return typeof blocked.message === 'string' && blocked.message !== '' ? blocked.message : t('dialog.blocked')
      }
    }

    function errorMessage(error, t) {
      const api = asApiError(error)
      switch (api.code) {
        case 'NOT_FOUND':
          return t('dialog.notFound')
        case 'LIVE':
          return t('dialog.live')
        case 'AGENT_RELEASE_FAILED':
          return t('dialog.releaseFailed')
        case 'AGENT_RELEASE_UNAVAILABLE':
          return t('dialog.releaseUnavailable')
        case 'DELETE_IN_PROGRESS':
          return t('dialog.deleteInProgress')
        case 'ACTIVE':
          return t('dialog.active', { activity: formatActivity(api.details?.activity, t) || t('dialog.activity') })
        case 'NOT_MATERIALIZED':
          return t('dialog.notMaterialized')
        case 'UNSUPPORTED_STORAGE':
        case 'UNEXPECTED_LAYOUT':
        case 'INVALID_SESSION_ID':
          return t('dialog.unsupported')
        case 'ACTIVITY_CHECK_FAILED':
          return t('dialog.activityFailed', { message: api.message })
        case 'FORBIDDEN_TOKEN':
          return t('dialog.stalePage')
        case 'FORBIDDEN_ORIGIN':
          return t('dialog.forbiddenOrigin')
        case 'TOKEN_UNAVAILABLE':
          return t('dialog.tokenUnavailable')
        case 'CONFIRMATION_REQUIRED':
          return t('dialog.ackRequired')
        case 'DELETE_FAILED':
          return t('dialog.deleteFailed', { message: api.message })
        default:
          return typeof api.message === 'string' && api.message !== '' ? api.message : t('dialog.unknownError')
      }
    }

    // ---------------------------------------------------------------------
    // Menu row.
    // ---------------------------------------------------------------------

    function TrashGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M6 2h4l.5 1H13v1.5H3V3h2.5L6 2Zm-2 4h8l-.7 8H4.7L4 6Z',
          fill: 'currentColor',
        }),
      )
    }

    function DeleteMenuItem(props) {
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
      const displayTitle = typeof props.displayTitle === 'string' ? props.displayTitle : ''
      const t = props.t
      const skip = React.useSyncExternalStore(subscribe, () => skipConfirmation, () => false)
      const deleting = React.useSyncExternalStore(subscribe, () => deletionInflight.has(sessionId), () => false)
      const pair = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : [true, () => {}]
      const open = Array.isArray(pair) ? pair[0] : true
      const setOpen = Array.isArray(pair) && typeof pair[1] === 'function' ? pair[1] : () => {}
      if (sessionId === undefined || open === false) return null
      const select = () => {
        if (deletionInflight.has(sessionId)) return
        try {
          setOpen(false)
        } catch {
          // The menu may already be closing; opening the dialog still works.
        }
        if (refreshPreference()) void deleteDirectly({ sessionId, displayTitle }, t)
        else openDialog({ sessionId, displayTitle })
      }
      const deleteItem = h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          tabIndex: -1,
          className: 'dsd-menu-item',
          disabled: deleting,
          title: t('menu.delete.title'),
          'aria-label': t('menu.delete'),
          onClick: select,
        },
        h('span', { className: 'dsd-menu-icon' }, h(TrashGlyph, null)),
        h('span', null, t('menu.delete')),
      )
      if (!skip) return deleteItem
      return h(React.Fragment, null, deleteItem, h('button', {
        type: 'button', role: 'menuitem', tabIndex: -1, className: 'dsd-menu-item restore-confirmation',
        'aria-label': t('menu.restoreConfirmation'),
        onClick: () => {
          try { setOpen(false) } catch { /* The menu may already be closing. */ }
          const saved = saveSkipConfirmation(false)
          addNotice({ kind: saved ? 'success' : 'warning', title: t(saved ? 'dialog.confirmationRestored' : 'dialog.confirmationRestoreFailed') })
        },
      }, t('menu.restoreConfirmation')))
    }

    // ---------------------------------------------------------------------
    // Confirmation dialog.
    // ---------------------------------------------------------------------

    function DeleteDialog({ t }) {
      const pending = usePending()
      const currentNotices = React.useSyncExternalStore(subscribe, () => notices, () => notices)
      const [ack, setAck] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [deleteError, setDeleteError] = React.useState(null)
      const [ackAttempts, setAckAttempts] = React.useState(0)
      const [skipFutureConfirmation, setSkipFutureConfirmation] = React.useState(false)
      const [skipSaved, setSkipSaved] = React.useState(false)
      const dialogRef = React.useRef(null)
      const ackRef = React.useRef(null)
      const previousFocus = React.useRef(null)

      const requestId = pending?.requestId

      React.useEffect(() => {
        if (pending === null || typeof requestId !== 'number') return undefined
        previousFocus.current = document.activeElement
        setAck(false)
        setBusy(false)
        setResult(null)
        setDeleteError(null)
        setAckAttempts(0)
        setSkipFutureConfirmation(false)
        setSkipSaved(false)
        void requestPlan(requestId, pending.sessionId)
        const timer = window.setTimeout(() => {
          try {
            dialogRef.current?.focus?.({ preventScroll: true })
          } catch {
            // Focus is best-effort.
          }
        }, 0)
        return () => window.clearTimeout(timer)
        // The request id is the dialog's identity; a later plan update must not
        // reset the acknowledgement the user just made.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [requestId])

      React.useEffect(() => {
        if (ackAttempts === 0 || ack) return
        // Return focus to the required control on every unacknowledged attempt.
        ackRef.current?.focus?.({ preventScroll: true })
        ackRef.current?.scrollIntoView?.({ block: 'nearest' })
      }, [ackAttempts, ack])

      React.useEffect(() => {
        if (pending === null) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (!busy) close()
            return
          }
          if (event.key !== 'Tab') return
          const node = dialogRef.current
          if (node === null) return
          const focusable = [...node.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
          if (focusable.length === 0) {
            event.preventDefault()
            node.focus()
            return
          }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
        // Re-bind when busy changes so Escape obeys the current lock.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [pending, busy])

      if (pending === null) return renderNotices(currentNotices, t)

      const close = () => {
        if (busy) return
        const previous = previousFocus.current
        const sessionId = pending.sessionId
        closeDialog()
        window.setTimeout(() => {
          try {
            if (previous !== null && previous !== undefined && previous.isConnected) {
              previous.focus?.({ preventScroll: true })
              return
            }
            const row = document.querySelector(`[data-row-key="session:${sessionId}"]`)
            row?.focus?.({ preventScroll: true })
          } catch {
            // Focus is best-effort.
          }
        }, 0)
      }

      const plan = pending.phase === 'ready' && pending.plan !== null && typeof pending.plan === 'object'
        ? pending.plan
        : null
      const canDelete = plan !== null && plan.canDelete === true && result === null
      const blocked = plan !== null && plan.canDelete !== true
      const title = (plan?.title || pending.displayTitle || t('dialog.untitled'))
      const confirm = async () => {
        if (!canDelete || busy || deletionInflight.has(pending.sessionId)) return
        if (!ack) {
          setAckAttempts((attempts) => attempts + 1)
          return
        }
        setBusy(true)
        setDeleteError(null)
        const rememberChoice = skipFutureConfirmation
        try {
          const value = await submitDeletion(pending.sessionId)
          if (rememberChoice) {
            const saved = saveSkipConfirmation(true)
            setSkipSaved(saved)
            setResult(saved ? value : { ...value, warnings: [...(Array.isArray(value?.warnings) ? value.warnings : []), { code: 'PREFERENCE_SAVE_FAILED' }] })
          } else setResult(value)
        } catch (error) {
          setDeleteError(asApiError(error))
        } finally {
          setBusy(false)
        }
      }

      const warningRows = result !== null && Array.isArray(result.warnings) ? result.warnings : []
      const planMeta = plan !== null
        ? h(
          'dl',
          { className: 'dsd-meta' },
          h('dt', null, t('dialog.session')),
          h('dd', null, title),
          h('dt', null, t('dialog.messages')),
          h('dd', null, formatCount(plan.eventCount, t)),
          h('dt', null, t('dialog.size')),
          h('dd', null, formatBytes(plan.sizeBytes, t)),
          h('dt', null, t('dialog.created')),
          h('dd', null, formatDate(plan.createdAt)),
          plan.cwd !== null && plan.cwd !== undefined
            ? h(React.Fragment, { key: 'cwd' }, h('dt', null, t('dialog.cwd')), h('dd', null, String(plan.cwd)))
            : null,
          plan.archived === true || plan.pinned === true
            ? h(React.Fragment, { key: 'status' },
              h('dt', null, t('dialog.status')),
              h('dd', null, h('span', { className: 'dsd-badges' },
                plan.archived === true ? h('span', { className: 'dsd-badge' }, t('dialog.archived')) : null,
                plan.pinned === true ? h('span', { className: 'dsd-badge' }, t('dialog.pinned')) : null,
              )),
            )
            : null,
        )
        : null

      const childNote = plan !== null && typeof plan.childSessionCount === 'number' && plan.childSessionCount > 0
        ? h('div', { className: 'dsd-alert warn', role: 'note' }, t('dialog.childWarning', { count: plan.childSessionCount }))
        : null
      const parentNote = plan !== null && typeof plan.parentSessionId === 'string' && plan.parentSessionId !== ''
        ? h('div', { className: 'dsd-alert warn', role: 'note' }, t('dialog.parentWarning'))
        : null
      const loadedIdleNote = canDelete && plan.live === true
        ? h('div', { className: 'dsd-alert warn', role: 'note' }, t('dialog.loadedIdle'))
        : null

      const body = (() => {
        if (result !== null) {
          return h(
            React.Fragment,
            null,
            h('div', { className: 'dsd-alert success', role: 'status' }, t('dialog.success')),
            h('p', { className: 'dsd-warning' }, t('dialog.successBody')),
            skipSaved ? h('p', { className: 'dsd-warning' }, t('dialog.skipConfirmationSaved')) : null,
            result.alreadyGone === true ? h('p', { className: 'dsd-muted' }, t('dialog.alreadyGone')) : null,
            warningRows.length > 0
              ? h('div', { className: 'dsd-warnings' },
                h('strong', null, t('dialog.warningTitle')),
                h('ul', null, warningRows.map((warning, index) => h('li', { key: `w${index}` }, warningMessage(warning, t)))),
              )
              : null,
          )
        }
        if (pending.phase === 'planning') {
          return h('div', { className: 'dsd-loading', role: 'status' }, h('span', { className: 'dsd-spinner', 'aria-hidden': true }), t('dialog.loading'))
        }
        if (pending.phase === 'error') {
          return h('div', { className: 'dsd-alert error', role: 'alert' }, errorMessage(pending.error, t))
        }
        if (plan === null) {
          return h('div', { className: 'dsd-alert error', role: 'alert' }, t('dialog.unknownError'))
        }
        return h(
          React.Fragment,
          null,
          h('p', { className: 'dsd-warning', id: 'dsd-dialog-desc' }, t('dialog.warning')),
          planMeta,
          childNote,
          parentNote,
          loadedIdleNote,
          blocked
            ? h('div', { className: 'dsd-alert error', role: 'alert' }, blockedMessage(plan, t))
            : h(
              React.Fragment,
              null,
              h('div', { className: 'dsd-section' },
                h('h3', null, t('dialog.deletes')),
                h('ul', null,
                  h('li', null, t('dialog.deleteLog')),
                  h('li', null, t('dialog.deleteCache')),
                  h('li', null, t('dialog.deleteWorkspace')),
                ),
              ),
              h('div', { className: 'dsd-section' },
                h('h3', null, t('dialog.keeps')),
                h('ul', null,
                  h('li', null, t('dialog.keepAttachments')),
                  h('li', null, t('dialog.keepChildren')),
                ),
              ),
              h('div', {
                className: `dsd-ack-group${ackAttempts > 0 && !ack ? ` is-invalid${ackAttempts % 2 === 0 ? ' shake-repeat' : ''}` : ''}`,
              },
                h('label', { className: 'dsd-ack' },
                  h('input', {
                    ref: ackRef,
                    type: 'checkbox',
                    id: 'dsd-ack',
                    checked: ack,
                    disabled: busy,
                    'aria-required': true,
                    'aria-invalid': ackAttempts > 0 && !ack ? true : undefined,
                    'aria-describedby': ackAttempts > 0 && !ack ? 'dsd-ack-reminder' : undefined,
                    onChange: (event) => {
                      setAck(event.target.checked)
                      setAckAttempts(0)
                    },
                  }),
                  h('span', null, t('dialog.ack')),
                ),
                ackAttempts > 0 && !ack
                  ? h('p', { id: 'dsd-ack-reminder', className: 'dsd-ack-reminder', role: 'alert' }, t('dialog.ackRequired'))
                  : null,
              ),
              h('div', { className: 'dsd-skip' },
                h('label', { className: 'dsd-ack' },
                  h('input', {
                    type: 'checkbox', id: 'dsd-skip-confirmation',
                    checked: skipFutureConfirmation, disabled: busy,
                    'aria-describedby': 'dsd-skip-confirmation-help',
                    onChange: (event) => setSkipFutureConfirmation(event.target.checked),
                  }),
                  h('span', null, t('dialog.skipConfirmation')),
                ),
                h('p', { className: 'dsd-skip-help', id: 'dsd-skip-confirmation-help' }, t('dialog.skipConfirmationHelp')),
              ),
              deleteError !== null
                ? h('div', { className: 'dsd-alert error', role: 'alert' }, errorMessage(deleteError, t))
                : null,
            ),
        )
      })()

      const footerButtons = []
      if (result !== null) {
        footerButtons.push(h('button', { key: 'close', type: 'button', className: 'dsd-btn', onClick: close }, t('dialog.close')))
      } else {
        footerButtons.push(h('button', { key: 'cancel', type: 'button', className: 'dsd-btn', disabled: busy, onClick: close }, t('dialog.cancel')))
        if (canDelete) {
          footerButtons.push(h('button', {
            key: 'delete',
            type: 'button',
            className: `dsd-btn danger${!ack ? ' needs-ack' : ''}`,
            disabled: busy,
            title: !ack ? t('dialog.ackRequired') : undefined,
            onClick: () => void confirm(),
          }, busy ? t('dialog.deleting') : t('dialog.delete')))
        }
        if (blocked || pending.phase === 'error') {
          footerButtons.push(h('button', {
            key: 'recheck',
            type: 'button',
            className: 'dsd-btn',
            disabled: busy,
            onClick: () => void requestPlan(pending.requestId, pending.sessionId, true),
          }, t('dialog.recheck')))
        }
      }

      return h(React.Fragment, null, h(
        'div',
        {
          className: 'dsd-scrim',
          role: 'presentation',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) close()
          },
        },
        h(
          'div',
          {
            ref: dialogRef,
            className: 'dsd-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dsd-dialog-title',
            'aria-describedby': plan !== null ? 'dsd-dialog-desc' : undefined,
            'aria-busy': busy ? 'true' : undefined,
            tabIndex: -1,
          },
          h('h2', { className: 'dsd-title', id: 'dsd-dialog-title' }, t('dialog.title')),
          body,
          h('div', { className: 'dsd-footer', style: { marginTop: '16px' } }, footerButtons),
        ),
      ), renderNotices(currentNotices, t))
    }

    // ---------------------------------------------------------------------
    // Plugin entry.
    // ---------------------------------------------------------------------

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale === undefined) return
        ctx.effect(() => locale.register(NS, { en, zh }), 'dsh-session-delete: locale')
        const t = locale.bind(NS)

        ctx.effect(() => {
          const onStorage = (event) => {
            if (event.key === SKIP_CONFIRMATION_KEY || event.key === null) refreshPreference()
          }
          window.addEventListener?.('storage', onStorage)
          return () => {
            window.removeEventListener?.('storage', onStorage)
            for (const timer of noticeTimers.values()) window.clearTimeout(timer)
            noticeTimers.clear()
          }
        }, 'dsh-session-delete: confirmation preference')

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/dsh-session-delete'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'dsh-session-delete: dialog styles')

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'dsh-session-delete',
          order: 550,
        }, (props) => h(DeleteMenuItem, { ...props, t })))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-session-delete-dialog',
          order: 1000,
        }, () => h(DeleteDialog, { t })))
      },
    }
  },
})
