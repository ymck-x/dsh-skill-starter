// 浏览器源码，直接分发，不经任何构建步骤重写。
// 设置页「技能管理」板块：列出、编辑、新建技能，把内置技能复制成自己的。
// 文案走 DSH 的本地化服务，跟随界面语言切换。
window.__ModuleLoader__.load({ id: 'dsh-skills', factory: require => {
  const React = require('react')
  const { useState, useEffect, useCallback, useRef } = React
  const h = React.createElement
  const ROUTE = 'api/dsh-skills/manage'
  /** 字典命名空间，与宿主侧包名一致。 */
  const NS = 'dsh-skills'
  const EMPTY = { name: '', description: '', whenToUse: '', modelInvocable: true, userInvocable: true, content: '' }

  /** 英文文案。 */
  const en = {
    nav: 'Skill Manager',
    title: 'Skill Manager',
    intro: 'A skill is a short instruction file the agent follows every time it fits. Anything you write here takes effect at the next step, with no restart. A skill of your own always wins over a built-in one with the same name.',
    newSkill: 'New skill',
    refresh: 'Refresh',
    userRoot: 'Your folder',
    mine: 'Your skills',
    builtin: 'Built-in skills',
    emptyMine: 'Nothing yet. Create one, or copy a built-in skill and make it yours.',
    emptyBuiltin: 'No built-in skills.',
    pick: 'Pick a skill on the left, or create a new one.',
    createTitle: 'New skill',
    editTitle: 'Edit',
    labelName: 'Name',
    labelDescription: 'Description',
    labelWhenToUse: 'When to use it (optional)',
    labelBody: 'Content',
    phName: 'lowercase letters and hyphens, for example code-review',
    phDescription: 'One sentence. To let the agent reach for it on its own, say when to use it.',
    phBody: 'Write down when to do it, the steps, how you know it is done, and what not to do.',
    checkModel: 'Let the agent use this skill on its own when it fits',
    checkUser: 'Let me call it by typing /{name}',
    save: 'Save',
    create: 'Create',
    copy: 'Copy and make it mine',
    remove: 'Delete',
    cancel: 'Cancel',
    tagBuiltin: 'built-in',
    tagShadowed: 'overridden by yours',
    confirmRemove: 'Delete the skill {name}? Its file will be removed.',
    saved: 'Saved to {path}. It works from the next step.',
    copied: 'Copied to {path}. From now on your copy is the one in use.',
    removed: 'Deleted {name}.',
    requestFailed: 'Could not read the server response. Check the plugin is loaded, then reload the page.',
    errNameInvalid: 'A skill name may only use lowercase letters, digits and hyphens, for example code-review',
    errDescriptionEmpty: 'The description cannot be empty.',
    errDescriptionTooLong: 'The description is too long.',
    errWhenTooLong: 'The "when to use" line is too long.',
    errContentEmpty: 'The content cannot be empty.',
    errContentTooLong: 'The content is too long.',
    errFlatFileExists: 'A flat file with that name already exists. Delete it first if you want a folder instead.',
    errBuiltinMissing: 'No built-in skill has that name.',
    errAlreadyExists: 'You already have a skill with that name.',
    errSkillNotFound: 'No skill with that name exists in your folder.',
    errUnknownAction: 'That action is not supported.',
    packs: 'Skill packs',
    noPacks: 'This plugin ships no skill packs.',
    packSkills: '{count} skills',
    packInstalledTag: 'installed',
    packNotInstalled: 'not installed',
    packUpgrade: 'shipped {version}, upgrade available',
    packChanged: '{count} files edited by you',
    packInstall: 'Install',
    packReinstall: 'Reinstall',
    packDone: '{name} is now {version}: {added} added, {updated} updated, {skipped} skipped.',
    roadmap: 'Which one do I use?',
    roadmapHint: 'Find your situation; no need to remember skill names.',
    roadmapMissing: 'Install the engineering-zh pack and this becomes the situation-to-skill table from skills-map.',
    roadmapManual: 'you start it',
    roadmapNotLocal: '{name} is not among the skills visible here.',
    filesTag: '{count} files',
    filesLabel: 'Files in the folder',
    openDir: 'Open folder',
    openDirDone: 'Opened in your file manager: {path}',
    openDirManual: 'Could not open a file manager. The path is: {path}',
    projectHint: 'Skills that travel with a repository live in that project\'s .dsh/skills or .agents/skills. They are not listed here; ask the agent, or open the folder.',
    groupPrepare: 'Before the workflow',
    groupPrepareHint: 'Decide where tickets and specs live.',
    groupOther: 'More built-in skills',
    groupAlign: 'Stop building the wrong thing',
    groupAlignHint: 'Ask every open question before writing any code.',
    groupClarity: 'When you cannot follow it',
    groupClarityHint: 'Have the last answer re-explained in plain words.',
    groupProof: 'Before you trust "done"',
    groupProofHint: 'Say how it will be checked, then actually check it.',
    groupAuthoring: 'Make it remember your way',
    groupAuthoringHint: 'Turn a routine you just described into a skill.',
  }

  /** 简体中文文案。 */
  const zh = {
    nav: 'Skill 管理',
    title: 'Skill 管理',
    intro: 'Skill 就是一份给 AI 的规矩文件，合适的时候它就会照着做。在这里写的东西下一步就生效，不用重启。你自己写的那份会盖住同名的内置技能。',
    newSkill: '新建技能',
    refresh: '刷新',
    userRoot: '你的目录',
    mine: '我的技能',
    builtin: '内置技能',
    emptyMine: '还没有。点「新建技能」，或者复制一份内置技能改成自己的。',
    emptyBuiltin: '没有内置技能。',
    pick: '左边选一个技能，或者新建一个。',
    createTitle: '新建技能',
    editTitle: '编辑',
    labelName: '名称',
    labelDescription: '描述',
    labelWhenToUse: '什么时候用（可选）',
    labelBody: '正文',
    phName: '英文小写加连字符，例如 code-review',
    phDescription: '一句话。想让 AI 自己判断何时使用，就把触发场景写进去。',
    phBody: '写清楚：什么时候做、按什么步骤做、做完的标志是什么、什么不要做。',
    checkModel: '允许 AI 在合适的时候自己用这个技能',
    checkUser: '允许我输入 /{name} 手动调用',
    save: '保存',
    create: '创建',
    copy: '复制成我的再改',
    remove: '删除',
    cancel: '取消',
    tagBuiltin: '内置',
    tagShadowed: '已被你覆盖',
    confirmRemove: '删除技能 {name}？它的文件会被移除。',
    saved: '已保存到 {path}，下一个步骤就能用。',
    copied: '已复制到 {path}，以后以你这份为准。',
    removed: '已删除 {name}。',
    requestFailed: '读不到服务响应。请确认插件已加载，然后刷新页面。',
    errNameInvalid: '技能名只能用英文小写字母、数字和连字符，例如 code-review',
    errDescriptionEmpty: '描述不能为空。',
    errDescriptionTooLong: '描述太长了。',
    errWhenTooLong: '「什么时候用」太长了。',
    errContentEmpty: '正文不能为空。',
    errContentTooLong: '正文太长了。',
    errFlatFileExists: '已经有同名的单个 .md 文件了。想改成文件夹形态，先把它删掉。',
    errBuiltinMissing: '内置技能里没有这个名字。',
    errAlreadyExists: '你已经有一份同名的技能了。',
    errSkillNotFound: '你的技能目录里没有这个技能。',
    errUnknownAction: '不支持这个操作。',
    packs: '技能包',
    noPacks: '插件里没有随包提供的技能包。',
    packSkills: '{count} 个技能',
    packInstalledTag: '已安装',
    packNotInstalled: '未安装',
    packUpgrade: '包内是 {version}，可升级',
    packChanged: '{count} 个文件你改过',
    packInstall: '安装',
    packReinstall: '重新安装',
    packDone: '{name} 已装到 {version}：新增 {added}，更新 {updated}，跳过 {skipped}。',
    roadmap: '我该用哪个',
    roadmapHint: '按你现在的处境找，不用记技能名。',
    roadmapMissing: '装了 engineering-zh 技能包之后，这里会显示 skills-map 里那张「处境 → 技能」对照表。',
    roadmapManual: '要你发起',
    roadmapNotLocal: '{name} 不在这里可见的技能里。',
    filesTag: '{count} 个文件',
    filesLabel: '目录里的文件',
    openDir: '打开目录',
    openDirDone: '已用文件管理器打开：{path}',
    openDirManual: '打不开文件管理器，路径给你：{path}',
    projectHint: '跟着仓库走的项目级技能放在那个项目的 .dsh/skills 或 .agents/skills 里，不在此列出。可以问 AI，或者直接打开目录看。',
    groupPrepare: '开工之前',
    groupPrepareHint: '先把票据和规格放在哪定下来。',
    groupOther: '其他内置技能',
    groupAlign: '别让它做错方向',
    groupAlignHint: '动手之前，把没问清的问完。',
    groupClarity: '看不懂就拉回来',
    groupClarityHint: '让它用大白话把刚才那段重讲一遍。',
    groupProof: '别让「改好了」是空话',
    groupProofHint: '先说清怎么验证，再真的验证一遍。',
    groupAuthoring: '让它记住你的做法',
    groupAuthoringHint: '把你刚讲过的流程变成一条技能。',
  }

  /**
   * 内置技能按「用户遇到的问题」分组，而不是按名字排字母序。
   * 用户打开面板先看到症状，再看到药。没列进任何组的落到「其他」。
   */
  const GROUPS = [
    { id: 'prepare', skills: ['setup-tickets'] },
    { id: 'align', skills: ['ask-first'] },
    { id: 'clarity', skills: ['plain-words'] },
    { id: 'proof', skills: ['prove-it', 'tiny-steps'] },
    { id: 'authoring', skills: ['write-my-skill'] },
  ]

  /** 宿主返回的错误码到字典键的映射。 */
  const ERROR_KEYS = {
    'name-invalid': 'errNameInvalid',
    'name-out-of-range': 'errNameInvalid',
    'description-empty': 'errDescriptionEmpty',
    'description-too-long': 'errDescriptionTooLong',
    'when-too-long': 'errWhenTooLong',
    'content-empty': 'errContentEmpty',
    'content-too-long': 'errContentTooLong',
    'flat-file-exists': 'errFlatFileExists',
    'builtin-missing': 'errBuiltinMissing',
    'already-exists': 'errAlreadyExists',
    'skill-not-found': 'errSkillNotFound',
    'unknown-action': 'errUnknownAction',
  }

  const css = `
  .skw{color:var(--fg,#27354b);font:14px/1.6 system-ui,sans-serif;min-width:0;max-width:1140px;margin:0 auto;padding:8px}
  .skw *{box-sizing:border-box}
  .skw h2{font-size:22px;margin:0 0 4px}
  .skw h3{font-size:15px;margin:14px 0 6px}
  .skw .muted{color:var(--fg-muted,#66768a);font-size:13px}
  .skw .hint{margin:0 0 8px}
  .skw .list .muted{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .skw .group{display:flex;flex-direction:column;gap:6px;margin-bottom:4px}
  .skw .packs{margin:12px 0}
  .skw .packrow{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-top:1px solid var(--border,#e6edf5)}
  .skw .packrow:first-of-type{border-top:0}
  .skw .packinfo{min-width:0}
  .skw .packinfo p{margin:4px 0 0}
  .skw .filelist{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:6px 0 10px}
  .skw .filelist button{padding:4px 10px;font-size:13px}
  .skw .roadmap{margin:12px 0}
  .skw .roadmap .rows{max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:4px}
  .skw .roadrow{display:flex;gap:8px;align-items:center;justify-content:space-between;width:100%;text-align:left}
  .skw .roadtext{flex:1 1 auto;min-width:0}
  .skw .tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}
  .skw button{font:inherit;border:1px solid var(--border,#ccd8e5);border-radius:9px;background:var(--bg-surface,#fff);color:inherit;padding:7px 12px;cursor:pointer;text-align:left;white-space:normal}
  .skw button.primary{background:#245ee9;border-color:#245ee9;color:#fff}
  .skw button.danger{color:#a33224;border-color:#e6c6c0}
  .skw button:disabled{opacity:.45;cursor:default}
  .skw input:not([type=file]),.skw textarea{font:inherit;color:inherit;width:100%;background:var(--bg,#fff);border:1px solid var(--border,#c9d5e4);border-radius:8px;padding:8px 10px}
  .skw textarea{resize:vertical;font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:13px;line-height:1.5}
  .skw label{display:block;margin:10px 0 3px;font-weight:600}
  .skw .layout{display:grid;grid-template-columns:minmax(190px,260px) minmax(0,1fr);gap:16px;align-items:start}
  .skw .list{display:flex;flex-direction:column;gap:6px;max-height:560px;overflow:auto;padding-right:4px}
  .skw .list button{display:block;width:100%}
  .skw .list button[aria-current=true]{background:#245ee9;border-color:#245ee9;color:#fff}
  .skw .list button[aria-current=true] .muted{color:#dbe6ff}
  .skw .tag{display:inline-block;font-size:11px;border-radius:999px;padding:1px 7px;margin-left:6px;background:#eef3fb;color:#4a5c78;vertical-align:middle}
  .skw .tag.warn{background:#fdf3e3;color:#8a5a13}
  .skw .card{border:1px solid var(--border,#d5dfeb);border-radius:12px;padding:14px;background:var(--bg-surface,#fff)}
  .skw .notice{border-radius:9px;padding:10px 12px;margin:10px 0;background:#edf4ff;color:#17408e;overflow-wrap:anywhere}
  .skw .error{background:#fff1ef;color:#922d20}
  .skw .check{display:flex;align-items:center;gap:8px;margin-top:10px}
  .skw .check input{width:auto}
  .skw .check label{margin:0;font-weight:400}
  .skw .path{font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}
  .skw :focus-visible{outline:3px solid #78a8ff;outline-offset:2px}
  @media(max-width:760px){.skw .layout{grid-template-columns:1fr}.skw .list{max-height:220px}}
  `

  /** 把 {name} 这样的占位符换掉。 */
  function format(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (whole, key) => (
      values !== undefined && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole
    ))
  }

  /** 取一条文案，缺失时回落到键名。 */
  function makeText(t) {
    return (key, values) => format(typeof t === 'function' ? t(key) : key, values)
  }

  async function call(body, signal) {
    let response
    try {
      response = await fetch(new URL(ROUTE, document.baseURI), {
        method: 'POST', credentials: 'same-origin', signal,
        headers: { 'content-type': 'application/json', 'x-dsh-skills-action': '1' },
        body: JSON.stringify(body),
      })
    } catch (problem) {
      const failure = new Error('network')
      failure.code = 'network'
      throw failure
    }
    let value
    try { value = await response.json() } catch { throw new Error('network') }
    if (!response.ok || value.ok === false) {
      const failure = new Error(value.message || 'request failed')
      failure.code = value.code
      failure.message = value.message || 'request failed'
      throw failure
    }
    return value
  }

  function Panel(props) {
    const locale = props.locale
    const text = makeText(props.t)
    const [, setTick] = useState(0)
    const [skills, setSkills] = useState([])
    const [roots, setRoots] = useState(null)
    const [packs, setPacks] = useState([])
    const [roadmap, setRoadmap] = useState({ available: false, rows: [] })
    const [current, setCurrent] = useState(null)
    const [form, setForm] = useState(EMPTY)
    const [creating, setCreating] = useState(false)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const alive = useRef(true)

    // 界面语言切换时重渲染，文案跟着换。
    useEffect(() => {
      if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
      const off = locale.subscribe(() => setTick(value => value + 1))
      return () => { if (typeof off === 'function') off() }
    }, [locale])

    useEffect(() => () => { alive.current = false }, [])

    /** 把宿主返回的错误翻成当前语言。 */
    const explain = (problem) => {
      const code = problem === null || problem === undefined ? undefined : problem.code
      const key = code === undefined ? undefined : ERROR_KEYS[code]
      if (key !== undefined) return text(key)
      if (code === 'network') return text('requestFailed')
      return (problem !== null && problem !== undefined && problem.message) ? problem.message : text('requestFailed')
    }

    const load = useCallback(async () => {
      setBusy(true); setError('')
      try {
        const value = await call({ action: 'list' })
        if (!alive.current) return
        setSkills(value.skills || [])
        setRoots(value.roots || null)
        const packValue = await call({ action: 'packs' })
        if (!alive.current) return
        setPacks(packValue.packs || [])
        const roadmapValue = await call({ action: 'roadmap' })
        if (!alive.current) return
        setRoadmap({ available: roadmapValue.available === true, rows: roadmapValue.rows || [] })
      } catch (problem) {
        if (alive.current) setError(explain(problem))
      } finally {
        if (alive.current) setBusy(false)
      }
    }, [])

    useEffect(() => { load() }, [load])

    async function open(skill) {
      setMessage(''); setError(''); setBusy(true)
      try {
        const value = await call({ action: 'read', scope: skill.scope, name: skill.name })
        if (!alive.current) return
        const row = value.skill
        setCurrent({ scope: row.scope, name: row.name, path: row.path, files: row.files || [] })
        setCreating(false)
        setForm({
          name: row.name, description: row.description || '', whenToUse: row.whenToUse || '',
          modelInvocable: row.modelInvocable !== false, userInvocable: row.userInvocable !== false,
          content: row.content || '',
        })
      } catch (problem) {
        if (alive.current) setError(explain(problem))
      } finally {
        if (alive.current) setBusy(false)
      }
    }

    function startNew() {
      setCurrent(null); setCreating(true); setForm(EMPTY)
      setMessage(''); setError('')
    }

    function close() {
      setCurrent(null); setCreating(false); setForm(EMPTY); setMessage(''); setError('')
    }

    async function openDir() {
      if (current === null) return
      setBusy(true); setMessage(''); setError('')
      try {
        const value = await call({ action: 'openDir', scope: current.scope, name: current.name })
        if (!alive.current) return
        setMessage(value.opened === false
          ? text('openDirManual', { path: value.path })
          : text('openDirDone', { path: value.path }))
      } catch (problem) {
        if (alive.current) setError(explain(problem))
      } finally {
        if (alive.current) setBusy(false)
      }
    }

    async function installPack(pack) {      setBusy(true); setMessage(''); setError('')
      try {
        const value = await call({ action: 'installPack', packId: pack.id })
        if (!alive.current) return
        setMessage(text('packDone', {
          name: pack.name,
          version: 'v' + value.version,
          added: value.added.length,
          updated: value.updated.length,
          skipped: value.skipped.length,
        }))
        await load()
      } catch (problem) {
        if (alive.current) setError(explain(problem))
      } finally {
        if (alive.current) setBusy(false)
      }
    }

    async function save() {
      setBusy(true); setMessage(''); setError('')
      try {
        const value = await call({ action: 'save', ...form })
        if (!alive.current) return
        setMessage(text('saved', { path: value.path }))
        setCreating(false)
        setCurrent({ scope: 'user', name: form.name, path: value.path })
        await load()
      } catch (problem) {
        if (alive.current) setError(explain(problem))
      } finally {
        if (alive.current) setBusy(false)
      }
    }

    async function copy(skill) {
      setBusy(true); setMessage(''); setError('')
      try {
        const value = await call({ action: 'copy', name: skill.name })
        if (!alive.current) return
        setMessage(text('copied', { path: value.path }))
        await load()
        await open({ scope: 'user', name: skill.name })
      } catch (problem) {
        if (alive.current) setError(explain(problem))
      } finally {
        if (alive.current) setBusy(false)
      }
    }

    async function remove() {
      if (current === null) return
      const ask = text('confirmRemove', { name: current.name })
      if (typeof window.confirm === 'function' && !window.confirm(ask)) return
      setBusy(true); setMessage(''); setError('')
      try {
        await call({ action: 'delete', name: current.name })
        if (!alive.current) return
        setMessage(text('removed', { name: current.name }))
        close()
        await load()
      } catch (problem) {
        if (alive.current) setError(explain(problem))
      } finally {
        if (alive.current) setBusy(false)
      }
    }

    const mine = skills.filter(skill => skill.scope === 'user')
    const builtin = skills.filter(skill => skill.scope === 'builtin')

    const item = (skill) => h('button', {
      key: skill.scope + ':' + skill.name,
      type: 'button',
      'aria-current': current !== null && current.name === skill.name && current.scope === skill.scope,
      disabled: busy,
      onClick: () => open(skill),
    },
      h('span', null, skill.name),
      skill.scope === 'builtin' && skill.shadowed ? h('span', { className: 'tag warn' }, text('tagShadowed')) : null,
      skill.scope === 'builtin' && !skill.shadowed ? h('span', { className: 'tag' }, text('tagBuiltin')) : null,
      Array.isArray(skill.files) && skill.files.length > 1 ? h('span', { className: 'tag' }, text('filesTag', { count: skill.files.length })) : null,
      h('span', { className: 'muted', style: { display: 'block' } }, skill.description),
    )

    // 内置技能按「用户遇到的问题」分组，组名与提示语走字典。
    const groupKey = (id, suffix) => 'group' + id[0].toUpperCase() + id.slice(1) + (suffix || '')
    const byName = new Map(builtin.map(skill => [skill.name, skill]))
    const claimed = new Set()
    const sections = GROUPS.map(group => {
      const members = group.skills.map(name => byName.get(name)).filter(Boolean)
      for (const member of members) claimed.add(member.name)
      if (members.length === 0) return null
      return h('div', { key: group.id, className: 'group' },
        h('h3', null, text(groupKey(group.id))),
        h('p', { className: 'muted hint' }, text(groupKey(group.id, 'Hint'))),
        members.map(item),
      )
    }).filter(Boolean)
    const rest = builtin.filter(skill => !claimed.has(skill.name))
    if (rest.length > 0) {
      sections.push(h('div', { key: 'other', className: 'group' },
        h('h3', null, text('groupOther')),
        rest.map(item),
      ))
    }

    return h('div', { className: 'skw' },
      h('style', null, css),
      h('h2', null, text('title')),
      h('p', { className: 'muted' }, text('intro')),
      h('p', { className: 'muted' }, text('projectHint')),
      h('div', { className: 'tools' },
        h('button', { type: 'button', onClick: startNew, disabled: busy }, text('newSkill')),
        h('button', { type: 'button', onClick: load, disabled: busy }, text('refresh')),
        roots !== null ? h('span', { className: 'muted path' }, text('userRoot') + ': ' + roots.user) : null,
      ),
      message !== '' ? h('div', { className: 'notice' }, message) : null,
      error !== '' ? h('div', { className: 'notice error' }, error) : null,
      h('div', { className: 'card packs' },
        h('h3', null, text('packs')),
        packs.length === 0
          ? h('p', { className: 'muted' }, text('noPacks'))
          : packs.map(pack => h('div', { key: pack.id, className: 'packrow' },
              h('div', { className: 'packinfo' },
                h('strong', null, pack.name),
                h('span', { className: 'tag' }, 'v' + pack.version),
                h('span', { className: 'muted' }, ' · ' + text('packSkills', { count: pack.skillCount }) + ' · '),
                h('span', { className: 'muted' }, pack.installed
                  ? (pack.installedVersion === pack.version
                      ? text('packInstalledTag')
                      : text('packUpgrade', { version: 'v' + pack.version }))
                  : text('packNotInstalled')),
                pack.changed !== undefined && pack.changed.length > 0
                  ? h('span', { className: 'tag warn' }, text('packChanged', { count: pack.changed.length }))
                  : null,
                h('p', { className: 'muted' }, pack.description),
              ),
              h('button', {
                type: 'button', className: 'primary', disabled: busy,
                onClick: () => installPack(pack),
              }, pack.installed ? text('packReinstall') : text('packInstall')),
            )),
      ),
      h('div', { className: 'card roadmap' },
        h('h3', null, text('roadmap')),
        h('p', { className: 'muted hint' }, text('roadmapHint')),
        roadmap.available === false
          ? h('p', { className: 'muted' }, text('roadmapMissing'))
          : h('div', { className: 'rows' }, roadmap.rows.map(row => h('button', {
              key: row.situation + ':' + row.skill,
              type: 'button',
              className: 'roadrow',
              disabled: busy,
              onClick: () => {
                const found = skills.find(skill => skill.name === row.skill && skill.scope === 'user')
                  || skills.find(skill => skill.name === row.skill)
                if (found === undefined) {
                  setMessage(text('roadmapNotLocal', { name: row.skill }))
                  return
                }
                open(found)
              },
            },
              h('span', { className: 'roadtext' }, row.situation),
              h('span', { className: 'tag' }, row.skill),
              row.manual === true ? h('span', { className: 'tag warn' }, text('roadmapManual')) : null,
            ))),
      ),
      h('div', { className: 'layout' },
        h('div', { className: 'list' },
          h('h3', null, text('mine') + ' (' + mine.length + ')'),
          mine.length === 0 ? h('p', { className: 'muted' }, text('emptyMine')) : mine.map(item),
          builtin.length === 0 ? h('p', { className: 'muted' }, text('emptyBuiltin')) : sections,
        ),
        h('div', { className: 'card' },
          current === null && !creating
            ? h('p', { className: 'muted' }, text('pick'))
            : h(React.Fragment, null,
                h('h3', null, creating ? text('createTitle') : text('editTitle') + ' ' + form.name),
                current !== null ? h('p', { className: 'muted path' }, current.path) : null,
                current !== null
                  ? h('div', { className: 'filelist' },
                      h('span', { className: 'muted' }, text('filesLabel') + '：' + (current.files.length > 0 ? current.files.join('、') : '—')),
                      h('button', { type: 'button', disabled: busy, onClick: openDir }, text('openDir')),
                    )
                  : null,
                h('label', { htmlFor: 'skw-name' }, text('labelName')),
                h('input', {
                  id: 'skw-name', value: form.name, disabled: busy || !creating, spellCheck: false,
                  placeholder: text('phName'),
                  onChange: event => setForm({ ...form, name: event.target.value }),
                }),
                h('label', { htmlFor: 'skw-desc' }, text('labelDescription')),
                h('textarea', {
                  id: 'skw-desc', rows: 3, value: form.description, disabled: busy, maxLength: 800,
                  placeholder: text('phDescription'),
                  onChange: event => setForm({ ...form, description: event.target.value }),
                }),
                h('label', { htmlFor: 'skw-when' }, text('labelWhenToUse')),
                h('input', {
                  id: 'skw-when', value: form.whenToUse, disabled: busy, maxLength: 400,
                  onChange: event => setForm({ ...form, whenToUse: event.target.value }),
                }),
                h('div', { className: 'check' },
                  h('input', {
                    id: 'skw-model', type: 'checkbox', checked: form.modelInvocable, disabled: busy,
                    onChange: event => setForm({ ...form, modelInvocable: event.target.checked }),
                  }),
                  h('label', { htmlFor: 'skw-model' }, text('checkModel')),
                ),
                h('div', { className: 'check' },
                  h('input', {
                    id: 'skw-user', type: 'checkbox', checked: form.userInvocable, disabled: busy,
                    onChange: event => setForm({ ...form, userInvocable: event.target.checked }),
                  }),
                  h('label', { htmlFor: 'skw-user' }, text('checkUser', { name: form.name || 'name' })),
                ),
                h('label', { htmlFor: 'skw-body' }, text('labelBody')),
                h('textarea', {
                  id: 'skw-body', rows: 16, value: form.content, disabled: busy,
                  placeholder: text('phBody'),
                  onChange: event => setForm({ ...form, content: event.target.value }),
                }),
                h('div', { className: 'tools' },
                  h('button', { type: 'button', className: 'primary', onClick: save, disabled: busy },
                    creating ? text('create') : text('save')),
                  current !== null && current.scope === 'builtin'
                    ? h('button', { type: 'button', onClick: () => copy(current), disabled: busy }, text('copy'))
                    : null,
                  current !== null && current.scope === 'user'
                    ? h('button', { type: 'button', className: 'danger', onClick: remove, disabled: busy }, text('remove'))
                    : null,
                  h('button', { type: 'button', disabled: busy, onClick: close }, text('cancel')),
                ),
              ),
        ),
      ),
    )
  }

  function apply(ctx) {
    const t = ctx.locale.bind(NS)
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-skills: section dictionaries')
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-skills',
      order: 57,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({ t, locale: ctx.locale }),
    }, Panel))
  }

  return { inject: ['slots', 'locale'], apply }
} })
