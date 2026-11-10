import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

/** Exercise the registered menu and dialog with the page's module loader. */
function clientFixture(responses, language = 'zh', storage = new Map()) {
  const calls = []
  const slots = new Map()
  const effects = []
  const components = new Map()
  const refTargets = new Map()
  const focusEvents = []
  const longTimers = []
  let dictionary
  let plugin
  let currentComponent
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  }
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState(initial) {
      const { states } = currentComponent
      const index = currentComponent.stateCursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef(current) {
      const { refs } = currentComponent
      const index = currentComponent.refCursor++
      if (!(index in refs)) refs[index] = { current }
      return refs[index]
    },
    useEffect(effect, dependencies) {
      const { effectStates } = currentComponent
      const index = currentComponent.effectCursor++
      const previous = effectStates[index]
      if (previous && dependencies && dependencies.length === previous.dependencies?.length && dependencies.every((value, at) => Object.is(value, previous.dependencies[at]))) return
      effectStates[index] = { dependencies }
      effects.push(() => {
        previous?.cleanup?.()
        effectStates[index].cleanup = effect()
      })
    },
  }
  const document = {
    activeElement: null,
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  }
  runInNewContext(source, {
    document,
    localStorage,
    window: {
      localStorage,
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: {
        load(module) {
          plugin = module.factory((name) => {
            assert.equal(name, 'react')
            return React
          })
        },
      },
      setTimeout: (callback, delay = 0) => {
        if (delay <= 10) return setImmediate(callback)
        const timer = { deferred: true, callback, delay }
        longTimers.push(timer)
        return timer
      },
      clearTimeout: (timer) => { if (!timer?.deferred) clearImmediate(timer) },
      requestAnimationFrame: (callback) => setImmediate(callback),
      cancelAnimationFrame: clearImmediate,
    },
    async fetch(path, options) {
      calls.push({ path, ...options })
      const response = responses.shift()
      assert.ok(response, `Unexpected request: ${path}`)
      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        statusText: response.statusText ?? '',
        json: async () => response.payload,
      }
    },
  })
  plugin.apply({
    get: () => ({
      register(_namespace, locales) { dictionary = locales[language] },
      bind: () => (key, values = {}) => dictionary[key].replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match)),
    }),
    effect: (effect) => effect(),
    slots: {
      inject: (_name, effect) => effect(),
      register: ({ name }, component) => slots.set(name, component),
    },
  })

  function render(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(render)
    if (typeof node.type === 'function') {
      if (!components.has(node.type)) components.set(node.type, { states: [], refs: [], effectStates: [] })
      const hooks = components.get(node.type)
      hooks.stateCursor = 0
      hooks.refCursor = 0
      hooks.effectCursor = 0
      const previous = currentComponent
      currentComponent = hooks
      let child
      try { child = node.type(node.props) } finally { currentComponent = previous }
      return render(child)
    }
    if (node.props.ref && typeof node.props.ref === 'object') {
      const ref = node.props.ref
      if (!refTargets.has(ref)) {
        const target = {
          id: node.props.id,
          isConnected: true,
          focus() {
            document.activeElement = target
            focusEvents.push(target.id)
          },
        }
        refTargets.set(ref, target)
      }
      ref.current = refTargets.get(ref)
    }
    return { ...node, children: node.children.map(render) }
  }

  function text(node) {
    if (node === null || node === undefined) return ''
    if (Array.isArray(node)) return node.map(text).join(' ')
    if (typeof node !== 'object') return String(node)
    return text(node.children)
  }

  function renderDialog() {
    const dialog = render(slots.get('shell.overlay')())
    effects.splice(0).forEach((effect) => effect())
    return dialog
  }

  function findAll(node, predicate) {
    if (node === null || typeof node !== 'object') return []
    if (Array.isArray(node)) return node.flatMap((child) => findAll(child, predicate))
    return [...(predicate(node) ? [node] : []), ...findAll(node.children, predicate)]
  }

  function renderMenu(sessionId = 'test-session') {
    return render(slots.get('sidebar.workspaces.session.menu.item')({ sessionId }))
  }

  function clickMenuDelete(sessionId = 'test-session') {
    const menu = renderMenu(sessionId)
    findAll(menu, (node) => node.type === 'button' && node.props['aria-label'] === dictionary['menu.delete'])[0].props.onClick()
  }

  async function openDialog(sessionId = 'test-session') {
    clickMenuDelete(sessionId)
    renderDialog()
    // Let the token request, the plan request and an optional refresh settle.
    await new Promise((resolve) => setImmediate(resolve))
    return text(renderDialog())
  }

  async function confirmDeletion() {
    let dialog = renderDialog()
    findAll(dialog, (node) => node.props.id === 'dsd-ack')[0].props.onChange({ target: { checked: true } })
    dialog = renderDialog()
    findAll(dialog, (node) => node.type === 'button' && text(node) === dictionary['dialog.delete'])[0].props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    return text(renderDialog())
  }

  return {
    calls, openDialog, confirmDeletion, renderDialog, renderMenu, clickMenuDelete, findAll, text, focusEvents, storage, longTimers,
    reload: (nextResponses) => clientFixture(nextResponses, language, storage),
  }
}

const token = (value) => ({ status: 200, payload: { ok: true, token: value } })
const forbidden = (code) => ({ status: 403, payload: { ok: false, error: { code, message: code } } })
const deletablePlan = () => ({ status: 200, payload: { ok: true, value: { canDelete: true } } })
const deleted = () => ({ status: 200, payload: { ok: true, value: { warnings: [] } } })
const preferenceKey = 'dsh-session-delete:skip-confirmation:v1'

function setSkipConfirmation(fixture, checked) {
  const input = fixture.findAll(fixture.renderDialog(), (node) => node.props.id === 'dsd-skip-confirmation')[0]
  assert.ok(input, 'the confirmation dialog must offer the opt-out checkbox')
  input.props.onChange({ target: { checked } })
}

function clickPermanentlyDelete(fixture) {
  const button = fixture.findAll(fixture.renderDialog(), (node) => node.type === 'button' && fixture.text(node) === '永久删除')[0]
  assert.ok(button)
  button.props.onClick()
}

function modalDialogs(fixture) {
  return fixture.findAll(fixture.renderDialog(), (node) => node.props.role === 'dialog')
}

test('dialog refreshes a stale token once and uses the new token to check the session', async () => {
  const fixture = clientFixture([
    token('old-token'),
    forbidden('FORBIDDEN_TOKEN'),
    token('new-token'),
    { status: 200, payload: { ok: true, value: { canDelete: false, blocked: { code: 'NOT_MATERIALIZED' } } } },
  ])
  const text = await fixture.openDialog()
  assert.match(text, /尚无已落盘的日志/)
  assert.equal(fixture.calls.length, 4)
  assert.equal(fixture.calls[1].headers['x-dsh-session-delete-token'], 'old-token')
  assert.equal(fixture.calls[3].headers['x-dsh-session-delete-token'], 'new-token')
  assert.ok(fixture.calls.every((call) => call.credentials === 'same-origin'))
})

test('dialog reports rejected request origins without refreshing the token or retrying', async () => {
  const fixture = clientFixture([token('token'), forbidden('FORBIDDEN_ORIGIN')])
  const text = await fixture.openDialog()
  assert.equal(fixture.calls.length, 2)
  assert.match(text, /拒绝了当前页面的请求来源/)
  assert.doesNotMatch(text, /令牌已失效|请刷新页面/)
})

test('dialog stops after one failed token refresh and explains token expiration', async () => {
  const fixture = clientFixture([
    token('old-token'), forbidden('FORBIDDEN_TOKEN'),
    token('new-token'), forbidden('FORBIDDEN_TOKEN'),
  ])
  const text = await fixture.openDialog()
  assert.equal(fixture.calls.length, 4)
  assert.match(text, /授权令牌已失效/)
})

test('dialog distinguishes unavailable tokens from expired tokens', async () => {
  const fixture = clientFixture([{ status: 503, payload: { ok: false } }])
  const text = await fixture.openDialog()
  assert.equal(fixture.calls.length, 1)
  assert.match(text, /无法获取删除会话的授权令牌/)
  assert.doesNotMatch(text, /令牌已失效|请刷新页面/)
})

test('English dialog also distinguishes request-origin rejection from token expiration', async () => {
  const fixture = clientFixture([forbidden('FORBIDDEN_ORIGIN')], 'en')
  const text = await fixture.openDialog()
  assert.equal(fixture.calls.length, 1)
  assert.match(text, /rejected this page’s request origin/)
  assert.doesNotMatch(text, /token has expired|Refresh the page/)
})

test('loaded idle sessions show the release warning and require acknowledgment before deletion', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: { live: true, canDelete: true } } },
  ])
  const text = await fixture.openDialog()
  assert.match(text, /已加载到内存，但当前没有运行中的任务/)
  assert.match(text, /先释放会话，再永久删除日志及全部消息/)
  assert.match(text, /无需切换会话或重启/)
  let dialog = fixture.renderDialog()
  const checkbox = fixture.findAll(dialog, (node) => node.type === 'input' && node.props.type === 'checkbox')[0]
  const deleteButton = () => fixture.findAll(dialog, (node) => node.type === 'button' && fixture.text(node) === '永久删除')[0]
  assert.ok(checkbox)
  assert.equal(checkbox.props.checked, false)
  assert.equal(deleteButton().props.disabled, false)
  deleteButton().props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fixture.calls.length, 2, 'an unacknowledged click must not submit deletion')
  checkbox.props.onChange({ target: { checked: true } })
  dialog = fixture.renderDialog()
  assert.equal(deleteButton().props.disabled, false)
  assert.equal(fixture.calls.length, 2)
})

test('unacknowledged deletion clicks repeat the reminder and focus without submitting, then acknowledgment allows one deletion', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: { canDelete: true } } },
    { status: 200, payload: { ok: true, value: { warnings: [] } } },
  ])
  await fixture.openDialog()
  const findDeleteButton = (dialog) => fixture.findAll(dialog, (node) => node.type === 'button' && fixture.text(node) === '永久删除')[0]
  const findCheckbox = (dialog) => fixture.findAll(dialog, (node) => node.props.id === 'dsd-ack')[0]
  const findReminder = (dialog) => fixture.findAll(dialog, (node) => node.props.id === 'dsd-ack-reminder')[0]
  const findAcknowledgmentGroup = (dialog) => fixture.findAll(dialog, (node) => node.props.className?.split(' ').includes('dsd-ack-group'))[0]

  let dialog = fixture.renderDialog()
  assert.equal(findDeleteButton(dialog).props.disabled, false)
  assert.equal(findCheckbox(dialog).props.checked, false)
  assert.equal(findReminder(dialog), undefined)

  findDeleteButton(dialog).props.onClick()
  dialog = fixture.renderDialog()
  assert.equal(fixture.calls.length, 2)
  assert.equal(findCheckbox(dialog).props['aria-invalid'], true)
  assert.equal(findCheckbox(dialog).props['aria-describedby'], findReminder(dialog).props.id)
  assert.equal(findReminder(dialog).props.role, 'alert')
  assert.match(fixture.text(findReminder(dialog)), /请先勾选“我已理解此操作无法撤销”/)
  assert.equal(fixture.focusEvents.filter((id) => id === 'dsd-ack').length, 1)
  const firstAttemptClass = findAcknowledgmentGroup(dialog).props.className

  findDeleteButton(dialog).props.onClick()
  dialog = fixture.renderDialog()
  assert.equal(fixture.calls.length, 2, 'repeated unchecked attempts must never call the delete endpoint')
  assert.notEqual(findAcknowledgmentGroup(dialog).props.className, firstAttemptClass, 'repeated attempts restart the reminder animation')
  assert.match(findAcknowledgmentGroup(dialog).props.className, /is-invalid/)
  assert.equal(fixture.focusEvents.filter((id) => id === 'dsd-ack').length, 2)
  assert.ok(findReminder(dialog))

  findCheckbox(dialog).props.onChange({ target: { checked: true } })
  dialog = fixture.renderDialog()
  assert.equal(findCheckbox(dialog).props.checked, true)
  assert.equal(findCheckbox(dialog).props['aria-invalid'], undefined)
  assert.equal(findCheckbox(dialog).props['aria-describedby'], undefined)
  assert.equal(findReminder(dialog), undefined)
  assert.doesNotMatch(findAcknowledgmentGroup(dialog).props.className, /is-invalid/)
  findDeleteButton(dialog).props.onClick()
  dialog = fixture.renderDialog()
  const busyButton = fixture.findAll(dialog, (node) => node.type === 'button' && fixture.text(node) === '正在删除…')[0]
  assert.equal(busyButton.props.disabled, true)
  await new Promise((resolve) => setImmediate(resolve))
  const deleteCalls = fixture.calls.filter((call) => call.path === '/api/dsh-session-delete/delete')
  assert.equal(deleteCalls.length, 1)
  assert.deepEqual(JSON.parse(deleteCalls[0].body), { sessionId: 'test-session', confirm: true })
  assert.match(fixture.text(fixture.renderDialog()), /会话已删除/)
})

test('loaded sessions with active tasks remain blocked without deletion controls', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: {
      live: true,
      canDelete: false,
      blocked: { code: 'ACTIVE' },
      activity: [{ kind: 'turn', items: [{ label: '正在生成回复' }] }],
    } } },
  ])
  const text = await fixture.openDialog()
  assert.match(text, /有正在进行的工作：对话生成 \(正在生成回复\)/)
  assert.match(text, /等待完成或先停止相关任务，再重新检查/)
  assert.doesNotMatch(text, /当前没有运行中的任务|请先切换到其他会话/)
  const dialog = fixture.renderDialog()
  assert.equal(fixture.findAll(dialog, (node) => node.type === 'input' && node.props.type === 'checkbox').length, 0)
  assert.equal(fixture.findAll(dialog, (node) => node.type === 'button' && fixture.text(node) === '永久删除').length, 0)
  assert.equal(fixture.calls.length, 2)
})

test('release failures show a clear message after the user confirms deletion', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: { live: true, canDelete: true } } },
    { status: 409, payload: { ok: false, error: { code: 'AGENT_RELEASE_FAILED', message: 'internal details' } } },
  ])
  await fixture.openDialog()
  const text = await fixture.confirmDeletion()
  assert.equal(fixture.calls[2].path, '/api/dsh-session-delete/delete')
  assert.equal(JSON.parse(fixture.calls[2].body).confirm, true)
  assert.match(text, /无法安全释放该会话，已保存的日志和消息均保留，未执行永久删除/)
  assert.match(text, /若会话暂时未出现在列表中，请刷新页面后重新检查/)
  assert.doesNotMatch(text, /internal details|请稍后重新检查/)
})

test('unsupported session release gives an actionable error without switching advice', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: { live: true, canDelete: false, blocked: { code: 'AGENT_RELEASE_UNAVAILABLE' } } } },
  ])
  const text = await fixture.openDialog()
  assert.match(text, /当前版本无法安全释放该会话，未执行永久删除/)
  assert.match(text, /请更新删除插件或 Harness 后重试/)
  assert.doesNotMatch(text, /请先切换到其他会话/)
})

test('activity labels are localized and maintenance waits for state updates to finish', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: {
      canDelete: false,
      blocked: { code: 'ACTIVE' },
      activity: [
        { kind: 'maintenance' }, { kind: 'turn' }, { kind: 'job' },
        { kind: 'subagent' }, { kind: 'schedule' },
        { kind: 'internal-provider', items: [{ id: 'private-job-id' }] },
      ],
    } } },
  ])
  const text = await fixture.openDialog()
  for (const label of ['正在更新会话状态', '对话生成', '后台任务', '子智能体', '计划任务', '运行中的工作']) assert.ok(text.includes(label))
  assert.match(text, /等待完成/)
  assert.doesNotMatch(text, /maintenance|turn|job|subagent|schedule|internal-provider|private-job-id/)
})

test('an in-progress deletion is reported by both plan and delete responses', async () => {
  const blocked = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: { canDelete: false, blocked: { code: 'DELETE_IN_PROGRESS', message: 'internal details' } } } },
  ])
  assert.match(await blocked.openDialog(), /该会话正在删除，请稍候/)

  const conflict = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: { canDelete: true } } },
    { status: 409, payload: { ok: false, error: { code: 'DELETE_IN_PROGRESS', message: 'internal details' } } },
  ])
  await conflict.openDialog()
  const text = await conflict.confirmDeletion()
  assert.match(text, /该会话正在删除，请稍候/)
  assert.doesNotMatch(text, /internal details/)
})

test('successful deletion reports a lock-release warning with restart guidance', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: { canDelete: true } } },
    { status: 200, payload: { ok: true, value: { warnings: [{ code: 'WRITE_LEASE_RELEASE_FAILED', message: '锁仍被占用' }] } } },
  ])
  await fixture.openDialog()
  const text = await fixture.confirmDeletion()
  assert.match(text, /会话已删除，但删除锁释放失败：锁仍被占用。请重启 Harness。/)
})

test('opt-out is saved only after acknowledged deletion succeeds, then skips the modal on this page and after reload', async () => {
  const fixture = clientFixture([token('token'), deletablePlan(), deleted(), deleted()])
  await fixture.openDialog()
  const option = fixture.findAll(fixture.renderDialog(), (node) => node.props.id === 'dsd-skip-confirmation')[0]
  assert.equal(option.props.checked, false)
  assert.match(fixture.text(fixture.renderDialog()), /以后删除不再弹出确认框/)
  setSkipConfirmation(fixture, true)
  assert.equal(fixture.storage.get(preferenceKey), undefined)
  await fixture.confirmDeletion()
  assert.equal(fixture.storage.get(preferenceKey), 'true')
  const close = fixture.findAll(fixture.renderDialog(), (node) => node.type === 'button' && fixture.text(node) === '关闭')[0]
  close.props.onClick()

  fixture.clickMenuDelete('next-session')
  assert.equal(modalDialogs(fixture).length, 0)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(modalDialogs(fixture).length, 0)
  assert.equal(fixture.calls.filter((call) => call.path.endsWith('/plan')).length, 1)
  const nextCall = fixture.calls.at(-1)
  assert.equal(nextCall.path, '/api/dsh-session-delete/delete')
  assert.deepEqual(JSON.parse(nextCall.body), { sessionId: 'next-session', confirm: true })
  assert.ok(fixture.findAll(fixture.renderDialog(), (node) => node.props.role === 'status').length > 0)

  const reloaded = fixture.reload([token('fresh-token'), deleted()])
  await reloaded.openDialog('after-reload')
  assert.equal(modalDialogs(reloaded).length, 0)
  assert.deepEqual(reloaded.calls.map((call) => call.path), ['/api/dsh-session-delete/token', '/api/dsh-session-delete/delete'])
  assert.deepEqual(JSON.parse(reloaded.calls[1].body), { sessionId: 'after-reload', confirm: true })
})

test('unchecked acknowledgment and cancelling the dialog cannot save the opt-out', async () => {
  const fixture = clientFixture([token('token'), deletablePlan()])
  await fixture.openDialog()
  setSkipConfirmation(fixture, true)
  clickPermanentlyDelete(fixture)
  fixture.renderDialog()
  assert.equal(fixture.calls.filter((call) => call.path.endsWith('/delete')).length, 0)
  assert.equal(fixture.storage.get(preferenceKey), undefined)
  const cancel = fixture.findAll(fixture.renderDialog(), (node) => node.type === 'button' && fixture.text(node) === '取消')[0]
  cancel.props.onClick()
  assert.equal(modalDialogs(fixture).length, 0)
  assert.equal(fixture.storage.get(preferenceKey), undefined)
  const reloaded = fixture.reload([token('fresh-token'), deletablePlan()])
  await reloaded.openDialog()
  assert.equal(modalDialogs(reloaded).length, 1)
})

test('failed acknowledged deletion cannot save the opt-out', async () => {
  const fixture = clientFixture([
    token('token'), deletablePlan(),
    { status: 409, payload: { ok: false, error: { code: 'ACTIVE', details: { activity: [{ kind: 'turn' }] } } } },
  ])
  await fixture.openDialog()
  setSkipConfirmation(fixture, true)
  const text = await fixture.confirmDeletion()
  assert.match(text, /有正在进行的工作/)
  assert.equal(fixture.storage.get(preferenceKey), undefined)
  const reloaded = fixture.reload([token('fresh-token'), deletablePlan()])
  await reloaded.openDialog()
  assert.equal(modalDialogs(reloaded).length, 1)
})

test('successful deletion keeps confirmation enabled unless the user selects the opt-out', async () => {
  const fixture = clientFixture([token('token'), deletablePlan(), deleted()])
  await fixture.openDialog()
  await fixture.confirmDeletion()
  assert.equal(fixture.storage.get(preferenceKey), undefined)
  const reloaded = fixture.reload([token('fresh-token'), deletablePlan()])
  await reloaded.openDialog()
  assert.equal(modalDialogs(reloaded).length, 1)
})

test('only the exact stored true value opts out of the confirmation dialog', async () => {
  for (const value of ['false', 'TRUE', '1', 'yes', '']) {
    const fixture = clientFixture([token('token'), deletablePlan()], 'zh', new Map([[preferenceKey, value]]))
    await fixture.openDialog()
    assert.equal(modalDialogs(fixture).length, 1, `unexpected opt-out for ${JSON.stringify(value)}`)
    assert.equal(fixture.calls.at(-1).path, '/api/dsh-session-delete/plan')
  }
})

test('direct deletion rejects active sessions with a nonmodal alert and retains the opt-out', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 409, payload: { ok: false, error: { code: 'ACTIVE', details: { activity: [{ kind: 'turn' }] } } } },
  ], 'zh', new Map([[preferenceKey, 'true']]))
  const text = await fixture.openDialog()
  assert.equal(modalDialogs(fixture).length, 0)
  assert.match(text, /有正在进行的工作/)
  assert.ok(fixture.findAll(fixture.renderDialog(), (node) => node.props.role === 'alert').length > 0)
  assert.equal(fixture.calls.filter((call) => call.path.endsWith('/plan')).length, 0)
  assert.equal(fixture.storage.get(preferenceKey), 'true')
})

test('double-clicking direct deletion submits the same session only once', async () => {
  const fixture = clientFixture([token('token'), deleted()], 'zh', new Map([[preferenceKey, 'true']]))
  const button = fixture.findAll(fixture.renderMenu(), (node) => node.type === 'button' && node.props['aria-label'] === '删除会话')[0]
  button.props.onClick()
  button.props.onClick()
  fixture.renderDialog()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fixture.calls.filter((call) => call.path.endsWith('/delete')).length, 1)
  assert.equal(modalDialogs(fixture).length, 0)
  assert.match(fixture.text(fixture.renderDialog()), /会话已删除/)
})

test('the restore action clears the preference and the next deletion opens the confirmation dialog', async () => {
  const fixture = clientFixture([token('token'), deletablePlan()], 'zh', new Map([[preferenceKey, 'true']]))
  const restore = fixture.findAll(fixture.renderMenu(), (node) => node.type === 'button' && fixture.text(node) === '恢复删除确认提示')[0]
  assert.ok(restore)
  restore.props.onClick()
  assert.equal(fixture.storage.get(preferenceKey), undefined)
  assert.equal(fixture.findAll(fixture.renderMenu(), (node) => node.type === 'button' && fixture.text(node) === '恢复删除确认提示').length, 0)
  await fixture.openDialog()
  assert.equal(modalDialogs(fixture).length, 1)
  assert.equal(fixture.calls.filter((call) => call.path.endsWith('/delete')).length, 0)
})

test('a preference write failure preserves successful deletion but keeps future confirmation enabled', async () => {
  const storage = new Map()
  storage.set = () => { throw new Error('storage unavailable') }
  const fixture = clientFixture([token('token'), deletablePlan(), deleted(), deletablePlan()], 'zh', storage)
  await fixture.openDialog()
  setSkipConfirmation(fixture, true)
  const text = await fixture.confirmDeletion()
  assert.match(text, /会话已删除，但未能保存此设置。下次删除仍会显示确认框/)
  assert.equal(storage.get(preferenceKey), undefined)
  assert.doesNotMatch(text, /此设备后续将直接删除/)
  fixture.findAll(fixture.renderDialog(), (node) => node.type === 'button' && fixture.text(node) === '关闭')[0].props.onClick()
  await fixture.openDialog('next-session')
  assert.equal(modalDialogs(fixture).length, 1)
  assert.equal(fixture.calls.filter((call) => call.path.endsWith('/delete')).length, 1)
  assert.equal(fixture.calls.at(-1).path, '/api/dsh-session-delete/plan')
})

test('a restore preference write failure still restores confirmation for the current page', async () => {
  const storage = new Map([[preferenceKey, 'true']])
  storage.delete = () => { throw new Error('storage unavailable') }
  const fixture = clientFixture([token('token'), deletablePlan()], 'zh', storage)
  const restore = fixture.findAll(fixture.renderMenu(), (node) => node.type === 'button' && node.props['aria-label'] === '恢复删除确认提示')[0]
  restore.props.onClick()
  assert.equal(storage.get(preferenceKey), 'true', 'the inaccessible persisted preference is unchanged')
  const notice = fixture.findAll(fixture.renderDialog(), (node) => node.props.role === 'alert')[0]
  assert.match(fixture.text(notice), /已为当前页面恢复确认，但未能保存设置/)
  assert.equal(fixture.longTimers.length, 0, 'restore failures must remain visible until dismissed')
  await fixture.openDialog()
  assert.equal(modalDialogs(fixture).length, 1)
  assert.equal(fixture.calls.at(-1).path, '/api/dsh-session-delete/plan')
  assert.equal(fixture.calls.filter((call) => call.path.endsWith('/delete')).length, 0)
})

test('direct deletion cleanup warnings stay visible in a nonmodal alert until dismissed', async () => {
  const fixture = clientFixture([
    token('token'),
    { status: 200, payload: { ok: true, value: { warnings: [{ code: 'WRITE_LEASE_RELEASE_FAILED', message: '锁仍被占用' }] } } },
  ], 'zh', new Map([[preferenceKey, 'true']]))
  await fixture.openDialog()
  assert.equal(modalDialogs(fixture).length, 0)
  const notice = fixture.findAll(fixture.renderDialog(), (node) => node.props.role === 'alert')[0]
  assert.match(fixture.text(notice), /会话已删除，但删除锁释放失败：锁仍被占用。请重启 Harness/)
  assert.equal(fixture.longTimers.length, 0)
  const dismiss = fixture.findAll(notice, (node) => node.type === 'button' && node.props['aria-label'] === '关闭')[0]
  dismiss.props.onClick()
  assert.equal(fixture.findAll(fixture.renderDialog(), (node) => node.props.role === 'alert').length, 0)
})
