/**
 * dsh-skills —— 技能管理插件（宿主侧）。
 *
 * 做三件事：
 *   1. 把包内 skills/ 下的默认技能注册进技能注册表（全局层，优先级最弱）
 *   2. 提供 /api/dsh-skills/manage 接口，供设置页列出、读取、保存、删除用户技能
 *   3. 支持把内置技能复制到用户技能目录，复制之后以用户版本为准
 *
 * 用户技能目录（<DSH_HOME>/skills）由 DSH 自带的 dsh-skill-filesystem 提供方
 * 扫描并监视，所以本插件不重复实现加载与热更新：写完文件，下一个模型步骤即可用。
 *
 * 只依赖 node: 内置模块，不 import 任何包，因此与 profile 的模块解析无关。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader 诊断里显示的名字。 */
export const name = 'dsh-skills'
/** 等 skill 注册表与工具注册表就绪后再激活；connection 在 apply 内延迟注入。 */
export const inject = ['skills', 'tools']

/** 管理接口路径，客户端 client.js 用同一个常量。 */
const ROUTE = '/api/dsh-skills/manage'
/** 自定义请求头，挡掉非面板来源的请求。 */
const ACTION_HEADER = 'x-dsh-skills-action'
/** 技能名规则，与 DSH 注册表一致：kebab-case。 */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** 上限，防止面板被超大请求拖垮。 */
const MAX_BODY = 2 * 1024 * 1024
const MAX_DESCRIPTION = 800
const MAX_WHEN_TO_USE = 400
const MAX_CONTENT = 400 * 1024

/** 随包分发的内置技能目录。 */
const builtinSkillsDir = fileURLToPath(new URL('./skills/', import.meta.url))
/** 随包分发的技能包目录。 */
const packsRoot = fileURLToPath(new URL('./packs/', import.meta.url))
/** 安装状态文件名。以点开头，DSH 不会把它当成技能。 */
const PACK_STATE_FILE = '.dsh-skills-packs.json'
/** DSH 配置根目录，与 dsh-skill-filesystem 的 dshHome 默认值一致。 */
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
/** 用户技能根目录，原生提供方按 rank 400 扫描它。 */
const userSkillsDir = join(dshHome, 'skills')

/** 错误信息统一成一行文本。 */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 启动追踪：把每一步写进 <DSH_HOME>/dsh-skills.log。
 * 宿主插件代码改动不会热生效，只能靠 profile 重载，所以需要这份日志判断到底加载了哪一版。
 */
function trace(line) {
  try {
    appendFileSync(join(dshHome, 'dsh-skills.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* 诊断写入失败不影响插件 */
  }
}

/** 带错误码的业务错误：前端按 code 取本地化文案，message 只作兜底和日志。 */
class SkillError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SkillError'
    this.code = code
  }
}

/** 用一个带错误码的错误中断当前操作。 */
function reject(code, message) {
  throw new SkillError(code, message)
}

/** 构造 JSON 响应，统一禁用缓存。 */
function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 构造失败响应：带 code 时前端按字典翻译，message 作兜底。 */
function fail(status, message, code) {
  return json(status, { ok: false, ...(code === undefined ? {} : { code }), message })
}

/** 拒绝跨站与跨源请求，照搬 dsh-ppt 的策略。 */
function originVerdict(request) {
  const site = request.headers.get('sec-fetch-site')
  const origin = request.headers.get('origin')
  if (site && !['same-origin', 'none'].includes(site)) return fail(403, '拒绝跨站操作')
  if (origin && /^https?:/i.test(origin)) {
    try {
      if (new URL(origin).host !== (request.headers.get('host') || new URL(request.url).host)) {
        return fail(403, '拒绝跨源操作')
      }
    } catch {
      return fail(403, '无效来源')
    }
  }
  return undefined
}

/** 读取请求体，超过上限直接中止。 */
async function readBody(request, limit) {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('请求内容过大')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 去掉 YAML 标量外层的引号。 */
function unquoteScalar(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

/** 解析 YAML 布尔值，无法识别时返回 undefined。 */
function parseScalarBoolean(value) {
  const text = value.trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(text)) return true
  if (['false', 'no', 'off', '0'].includes(text)) return false
  return undefined
}

/**
 * 解析 SKILL.md：读出 frontmatter 与正文。
 * 认可的键：name、description、whenToUse、disable-model-invocation、user-invocable。
 */
export function parseSkillFile(text) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const result = {
    name: '',
    description: '',
    whenToUse: undefined,
    modelInvocable: true,
    userInvocable: true,
    content: normalized,
  }
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(normalized)
  if (match === null) return { ...result, content: normalized.trim() }
  result.content = normalized.slice(match[0].length).replace(/^\n+/, '').trimEnd()
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim()
    const keyed = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    if (keyed === null) continue
    const key = keyed[1].toLowerCase()
    const value = keyed[2]
    if (key === 'name') result.name = unquoteScalar(value)
    else if (key === 'description') result.description = unquoteScalar(value)
    else if (key === 'whentouse') result.whenToUse = unquoteScalar(value)
    else if (key === 'disable-model-invocation') result.modelInvocable = parseScalarBoolean(value) !== true
    else if (key === 'user-invocable') result.userInvocable = parseScalarBoolean(value) !== false
  }
  return result
}

/** 渲染 frontmatter 标量：一律加双引号，避免中文冒号之类被 YAML 误读。 */
function scalar(value) {
  return JSON.stringify(String(value ?? '').replace(/\r?\n/g, ' ').trim())
}

/** 把一份技能渲染成 SKILL.md 文本。 */
export function renderSkillFile(skill) {
  const lines = ['---', `name: ${skill.name}`, `description: ${scalar(skill.description)}`]
  if (skill.whenToUse !== undefined && String(skill.whenToUse).trim() !== '') {
    lines.push(`whenToUse: ${scalar(skill.whenToUse)}`)
  }
  if (skill.modelInvocable === false) lines.push('disable-model-invocation: true')
  if (skill.userInvocable === false) lines.push('user-invocable: false')
  lines.push('---', '', String(skill.content ?? '').trim(), '')
  return lines.join('\n')
}

/**
 * 从工作目录往上找含 .git 的目录，判定规则与 DSH 的项目根一致；找不到就用工作目录本身。
 */
function findProjectRoot(cwd) {
  let dir = resolve(cwd)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(cwd)
    dir = parent
  }
}

/** 一个会话可能看到的项目级技能目录，顺序与 DSH 的优先级一致。 */
function projectSkillDirs(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return []
  const root = findProjectRoot(cwd)
  return [join(root, '.dsh', 'skills'), join(root, '.agents', 'skills')]
}

/** 列出一个技能目录里的全部文件（相对路径）。扁平文件技能只会得到它自己。 */
function listSkillFiles(dir) {
  const out = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(current, entry.name), rel)
      else if (entry.isFile()) out.push(rel)
    }
  }
  try {
    walk(dir, '')
  } catch {
    return []
  }
  return out.sort()
}

/** 让系统文件管理器打开一个目录；打不开也不抛错，把路径交给界面显示。 */
function openDirectory(dir) {
  try {
    const command = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawn(command, [dir], { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}

/**
 * 从 skills-map 的 SKILL.md 里解析「一张表定位」，得到「处境 → 技能」的对照。
 * 表格是那份技能的权威表达，这里只做读取，不改写、不复制内容，两边不会漂移。
 */
function parseRoadmap(text) {
  const rows = []
  for (const line of String(text).split('\n')) {
    const match = /^\|\s*([^|]+?)\s*\|\s*`([a-z0-9-]+)`/.exec(line)
    if (match === null) continue
    const situation = match[1].trim()
    if (situation === '' || situation.startsWith('-') || situation === '你现在的处境') continue
    rows.push({ situation, skill: match[2], manual: line.includes('人工发起') })
  }
  return rows
}

/** 文件内容指纹，用来判断用户有没有改过装进来的文件。 */
function fingerprint(text) {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * 列出一个技能包里要安装的全部文件，路径相对包的 skills/ 目录。
 * 返回的路径直接拼到用户技能目录下，就是技能的落点。
 */
function listPackFiles(packDir) {
  const skillsDir = join(packDir, 'skills')
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (entry.isFile()) out.push(rel)
    }
  }
  if (existsSync(skillsDir)) walk(skillsDir, '')
  return out.sort()
}

/**
 * 扫描一个技能根目录的直接子项。
 * 认两种形态：<root>/<名字>/SKILL.md 与 <root>/<名字>.md，都只扫一层，与原生提供方一致。
 */
export function scanSkillRoot(root) {
  if (!existsSync(root)) return []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    const entryName = String(entry.name)
    if (entryName.startsWith('.')) continue
    if (entry.isDirectory()) {
      const file = join(root, entryName, 'SKILL.md')
      if (existsSync(file)) found.push({ file, dir: join(root, entryName), bundle: true })
      continue
    }
    if (!entry.isFile()) continue
    const lower = entryName.toLowerCase()
    if (!lower.endsWith('.md')) continue
    if (lower === 'readme.md') continue
    found.push({ file: join(root, entryName), dir: root, bundle: false })
  }
  return found
}

/** 读一个已发现的技能，解析失败返回 undefined。 */
function loadSkill(entry) {
  let text
  try {
    const stat = statSync(entry.file)
    if (!stat.isFile() || stat.size > MAX_CONTENT * 2) return undefined
    text = readFileSync(entry.file, 'utf8')
  } catch {
    return undefined
  }
  const parsed = parseSkillFile(text)
  if (!NAME_PATTERN.test(parsed.name) || parsed.description.trim() === '' || parsed.content.trim() === '') {
    return undefined
  }
  return {
    name: parsed.name,
    description: parsed.description,
    whenToUse: parsed.whenToUse,
    modelInvocable: parsed.modelInvocable,
    userInvocable: parsed.userInvocable,
    content: parsed.content,
    path: entry.file,
    dir: entry.dir,
    bundle: entry.bundle,
    files: entry.bundle ? listSkillFiles(entry.dir) : [entry.file.slice(entry.dir.length + 1).split(sep).join('/')],
  }
}

/** 扫描整根并返回摘要（含正文，列表动作会再裁掉）。 */
function collect(root) {
  const out = []
  for (const entry of scanSkillRoot(root)) {
    const skill = loadSkill(entry)
    if (skill !== undefined) out.push(skill)
  }
  out.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  return out
}

/** 列表里不需要正文，省掉一整段大文本。 */
function summarize(skill, scope, shadowed) {
  const { content, dir, bundle, ...rest } = skill
  return { ...rest, scope, shadowed, bundle }
}

/** 管理接口的实现。 */
class SkillAdmin {
  constructor(options) {
    this.userDir = options.userDir
    this.builtinDir = options.builtinDir
    this.packsDir = options.packsDir ?? packsRoot
  }

  /** 安装状态文件路径。 */
  get statePath() {
    return join(this.userDir, PACK_STATE_FILE)
  }

  /** 读安装状态；文件损坏时当作没装过，不打断用户。 */
  readPackState() {
    try {
      if (!existsSync(this.statePath)) return { packs: {} }
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8'))
      if (raw === null || typeof raw !== 'object' || raw.packs === null || typeof raw.packs !== 'object') {
        return { packs: {} }
      }
      return { packs: raw.packs }
    } catch {
      return { packs: {} }
    }
  }

  /** 写安装状态。 */
  writePackState(state) {
    mkdirSync(this.userDir, { recursive: true })
    writeFileSync(this.statePath, JSON.stringify({ version: 1, packs: state.packs }, null, 2), 'utf8')
  }

  /** 读一个包的清单；名字非法或文件缺失时返回 undefined。 */
  readPackMeta(packId) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(packId)) return undefined
    const dir = join(this.packsDir, packId)
    const file = join(dir, 'pack.json')
    if (!existsSync(file)) return undefined
    try {
      const meta = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof meta.id !== 'string' || typeof meta.version !== 'string') return undefined
      return { ...meta, dir }
    } catch {
      return undefined
    }
  }

  /** 随包提供的全部技能包。 */
  availablePacks() {
    if (!existsSync(this.packsDir)) return []
    const out = []
    for (const entry of readdirSync(this.packsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const meta = this.readPackMeta(entry.name)
      if (meta !== undefined) out.push(meta)
    }
    return out.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  }

  /** 每个包的安装状态：已装版本、被本地改过的文件、缺失的文件。 */
  packStatus() {
    const installed = this.readPackState().packs
    return this.availablePacks().map(meta => {
      const entry = installed[meta.id]
      const files = entry === undefined || entry.files === undefined ? {} : entry.files
      const changed = []
      const missing = []
      for (const rel of Object.keys(files)) {
        const target = join(this.userDir, ...rel.split('/'))
        if (!existsSync(target)) {
          missing.push(rel)
          continue
        }
        if (fingerprint(readFileSync(target, 'utf8')) !== files[rel]) changed.push(rel)
      }
      return {
        id: meta.id,
        name: meta.name,
        version: meta.version,
        description: meta.description,
        skillCount: Array.isArray(meta.skills) ? meta.skills.length : 0,
        overlaps: meta.overlaps,
        installed: entry !== undefined,
        installedVersion: entry === undefined ? undefined : entry.version,
        changed,
        missing,
      }
    })
  }

  /**
   * 安装或升级一个技能包。
   * 本地改过的文件一律跳过，升级只覆盖没动过的部分。
   */
  installPack(body) {
    const packId = String(body.packId ?? '')
    const meta = this.readPackMeta(packId)
    if (meta === undefined) reject('pack-not-found', `没有找到技能包 ${packId}`)
    const state = this.readPackState()
    const entry = state.packs[packId]
    const recorded = entry === undefined || entry.files === undefined ? {} : entry.files
    // 记录按包内当前的文件列表重建，包里已经删掉的文件不会留在记录里。
    const files = {}
    const base = resolve(this.userDir)
    const added = []
    const updated = []
    const skipped = []
    const kept = []
    for (const rel of listPackFiles(meta.dir)) {
      const source = join(meta.dir, 'skills', ...rel.split('/'))
      const target = join(this.userDir, ...rel.split('/'))
      if (!resolve(target).startsWith(base + sep)) reject('pack-path-escape', `技能包里有越界路径：${rel}`)
      const next = fingerprint(readFileSync(source, 'utf8'))
      if (existsSync(target)) {
        const current = fingerprint(readFileSync(target, 'utf8'))
        if (recorded[rel] === undefined) {
          // 没有安装记录，但文件已经在那里了。内容一致就纳入管理，不一致就绝不覆盖。
          if (current === next) files[rel] = next
          else kept.push(rel)
          continue
        }
        if (current !== recorded[rel]) {
          skipped.push(rel)
          files[rel] = recorded[rel]
          continue
        }
        if (current !== next) {
          writeFileSync(target, readFileSync(source, 'utf8'), 'utf8')
          updated.push(rel)
        }
      } else {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, readFileSync(source, 'utf8'), 'utf8')
        added.push(rel)
      }
      files[rel] = next
    }
    state.packs[packId] = { version: meta.version, installedAt: new Date().toISOString(), files }
    this.writePackState(state)
    return { packId, version: meta.version, added, updated, skipped, kept, overlaps: meta.overlaps }
  }

  /** 读出 skills-map 的「处境 → 技能」对照表；没有那份技能时如实说明。 */
  roadmap() {
    const file = join(this.userDir, 'skills-map', 'SKILL.md')
    if (!existsSync(file)) return { available: false, rows: [] }
    try {
      return { available: true, rows: parseRoadmap(readFileSync(file, 'utf8')) }
    } catch {
      return { available: false, rows: [] }
    }
  }

  /** 用户目录下的目标路径，name 已经过正则校验。 */
  targetPaths(skillName) {
    const dir = resolve(this.userDir, skillName)
    const file = resolve(this.userDir, `${skillName}.md`)
    const base = resolve(this.userDir)
    for (const candidate of [dir, file]) {
      if (candidate !== base && !candidate.startsWith(base + sep)) {
        reject('name-out-of-range', '技能名越界')
      }
    }
    return { dir, file }
  }

  list(options = {}) {
    const userSkills = collect(this.userDir)
    const builtinSkills = collect(this.builtinDir)
    const userNames = new Set(userSkills.map((skill) => skill.name))
    const projectRoots = projectSkillDirs(options.cwd)
    const projectSkills = []
    for (const dir of projectRoots) {
      for (const skill of collect(dir)) projectSkills.push({ ...skill, projectDir: dir })
    }
    return {
      roots: {
        user: this.userDir,
        builtin: this.builtinDir,
        project: projectRoots,
        userExists: existsSync(this.userDir),
      },
      skills: [
        ...projectSkills.map((skill) => summarize(skill, 'project', userNames.has(skill.name))),
        ...userSkills.map((skill) => summarize(skill, 'user', false)),
        ...builtinSkills.map((skill) => summarize(skill, 'builtin', userNames.has(skill.name))),
      ],
    }
  }

  read(body, options = {}) {
    const scope = body.scope === 'builtin' ? 'builtin' : body.scope === 'project' ? 'project' : 'user'
    const skillName = String(body.name ?? '')
    if (!NAME_PATTERN.test(skillName)) reject('name-invalid', '技能名不合法')
    const roots = scope === 'builtin'
      ? [this.builtinDir]
      : scope === 'project'
        ? projectSkillDirs(options.cwd)
        : [this.userDir]
    for (const root of roots) {
      const skill = collect(root).find((item) => item.name === skillName)
      if (skill !== undefined) return { ...skill, scope }
    }
    const where = scope === 'builtin' ? '内置技能' : scope === 'project' ? '当前项目' : '你的技能目录'
    reject('skill-not-found', `${where}里没有找到 ${skillName}`)
  }

  /** 用系统文件管理器打开一个技能所在目录。 */
  openDir(body, options = {}) {
    const scope = body.scope === 'builtin' ? 'builtin' : body.scope === 'project' ? 'project' : 'user'
    const skillName = String(body.name ?? '')
    if (!NAME_PATTERN.test(skillName)) reject('name-invalid', '技能名不合法')
    const roots = scope === 'builtin'
      ? [this.builtinDir]
      : scope === 'project'
        ? projectSkillDirs(options.cwd)
        : [this.userDir]
    for (const root of roots) {
      const skill = collect(root).find((item) => item.name === skillName)
      if (skill !== undefined) return { path: skill.dir, opened: openDirectory(skill.dir) }
    }
    reject('skill-not-found', `找不到 ${skillName} 的目录`)
  }

  save(body) {
    const skillName = String(body.name ?? '').trim()
    if (!NAME_PATTERN.test(skillName)) {
      reject('name-invalid', '技能名只能用英文小写字母、数字和连字符，例如 code-review')
    }
    const description = String(body.description ?? '').trim()
    if (description === '') reject('description-empty', '描述不能为空')
    if (description.length > MAX_DESCRIPTION) reject('description-too-long', `描述不能超过 ${MAX_DESCRIPTION} 个字符`)
    const whenToUseRaw = body.whenToUse === undefined || body.whenToUse === null ? '' : String(body.whenToUse).trim()
    if (whenToUseRaw.length > MAX_WHEN_TO_USE) reject('when-too-long', `使用时机不能超过 ${MAX_WHEN_TO_USE} 个字符`)
    const content = String(body.content ?? '')
    if (content.trim() === '') reject('content-empty', '正文不能为空')
    if (content.length > MAX_CONTENT) reject('content-too-long', '正文过长')

    const { dir, file } = this.targetPaths(skillName)
    if (existsSync(file)) {
      reject('flat-file-exists', `已存在扁平文件 ${file}，请先删掉它再保存为目录形态`)
    }
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'SKILL.md')
    writeFileSync(
      target,
      renderSkillFile({
        name: skillName,
        description,
        whenToUse: whenToUseRaw === '' ? undefined : whenToUseRaw,
        modelInvocable: body.modelInvocable !== false,
        userInvocable: body.userInvocable !== false,
        content,
      }),
      'utf8',
    )
    return { name: skillName, path: target }
  }

  copy(body) {
    const skillName = String(body.name ?? '')
    if (!NAME_PATTERN.test(skillName)) reject('name-invalid', '技能名不合法')
    const source = collect(this.builtinDir).find((item) => item.name === skillName)
    if (source === undefined) reject('builtin-missing', `内置技能里没有 ${skillName}`)
    const { dir, file } = this.targetPaths(skillName)
    if (existsSync(file) || existsSync(join(dir, 'SKILL.md'))) {
      reject('already-exists', `你已经有一份同名的 ${skillName} 了`)
    }
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'SKILL.md')
    writeFileSync(
      target,
      renderSkillFile({
        name: source.name,
        description: source.description,
        whenToUse: source.whenToUse,
        modelInvocable: source.modelInvocable,
        userInvocable: source.userInvocable,
        content: source.content,
      }),
      'utf8',
    )
    return { name: skillName, path: target }
  }

  remove(body) {
    const skillName = String(body.name ?? '')
    if (!NAME_PATTERN.test(skillName)) reject('name-invalid', '技能名不合法')
    const { dir, file } = this.targetPaths(skillName)
    let removed = false
    if (existsSync(join(dir, 'SKILL.md'))) {
      rmSync(dir, { recursive: true, force: true })
      removed = true
    }
    if (existsSync(file)) {
      rmSync(file, { force: true })
      removed = true
    }
    if (!removed) reject('skill-not-found', `你的技能目录里没有 ${skillName}`)
    return { name: skillName }
  }

  /** 处理一次面板请求。 */
  async handle(request) {
    if (request.method !== 'POST') return fail(405, '请使用 POST')
    if (request.headers.get(ACTION_HEADER) !== '1') return fail(403, '请从技能面板操作')
    const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/json') return fail(403, '请求必须是 JSON')
    const denied = originVerdict(request)
    if (denied !== undefined) return denied

    let body
    try {
      body = JSON.parse(await readBody(request, MAX_BODY))
    } catch (error) {
      return fail(400, describe(error))
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail(400, '请求必须是对象')

    try {
      switch (body.action) {
        case 'list':
          return json(200, { ok: true, ...this.list() })
        case 'read':
          return json(200, { ok: true, skill: this.read(body) })
        case 'save':
          return json(200, { ok: true, ...this.save(body) })
        case 'copy':
          return json(200, { ok: true, ...this.copy(body) })
        case 'delete':
          return json(200, { ok: true, ...this.remove(body) })
        case 'packs':
          return json(200, { ok: true, packs: this.packStatus() })
        case 'installPack':
          return json(200, { ok: true, ...this.installPack(body) })
        case 'openDir':
          return json(200, { ok: true, ...this.openDir(body) })
        case 'roadmap':
          return json(200, { ok: true, ...this.roadmap() })
        default:
          return fail(400, `不支持的操作：${String(body.action)}`, 'unknown-action')
      }
    } catch (error) {
      return fail(400, describe(error), error instanceof SkillError ? error.code : undefined)
    }
  }
}

/** 工具结果统一成文本块。 */
function textResult(text) {
  return [{ type: 'text', text }]
}

/**
 * 去掉值为 undefined 的键。
 * 工具返回值必须是可无损序列化的 JSON，带 undefined 的字段会让整次调用被拒。
 */
function prune(value) {
  if (Array.isArray(value)) return value.map(prune)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      out[key] = prune(item)
    }
    return out
  }
  return value === undefined ? null : value
}

/** 从工具执行上下文里取会话工作目录。 */
function sessionCwd(exec) {
  const cwd = exec === undefined || exec === null ? undefined : exec.agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : undefined
}

/** 来源的中文说法。 */
function scopeName(scope) {
  if (scope === 'builtin') return '插件内置'
  if (scope === 'project') return '当前项目'
  return '用户目录'
}

/** 一条技能在列表里的一行说明。 */
function skillLine(skill) {
  const flags = []
  flags.push(skill.modelInvocable === false ? '仅手动' : 'AI 可自用')
  flags.push(skill.userInvocable === false ? '无手动入口' : '/' + skill.name)
  if (Array.isArray(skill.files) && skill.files.length > 1) flags.push(`${skill.files.length} 个文件`)
  return `- ${skill.name}（${flags.join('，')}）\n  ${skill.description}`
}

/** 把技能清单渲染成一段文本。 */
function renderSkillList(value) {
  if (value.ok === false) return textResult(value.message)
  const project = value.skills.filter(skill => skill.scope === 'project')
  const mine = value.skills.filter(skill => skill.scope === 'user')
  const builtin = value.skills.filter(skill => skill.scope === 'builtin')
  const parts = [`本机技能（用户目录：${value.userRoot}）`]
  if (project.length > 0) {
    parts.push('\n项目技能（跟着这个仓库走，同名时优先于其他来源）：\n' + project.map(skillLine).join('\n'))
  }
  parts.push(mine.length === 0 ? '\n用户技能：还没有' : '\n用户技能：\n' + mine.map(skillLine).join('\n'))
  parts.push(
    builtin.length === 0
      ? '\n内置技能：没有'
      : '\n内置技能：\n' + builtin.map(skill => skillLine(skill) + (skill.shadowed ? '\n  ↑ 已被同名技能覆盖' : '')).join('\n'),
  )
  parts.push('\n改技能用 skill_write，读全文用 skill_read，删除用 skill_delete，装技能包用 skill_pack_install。')
  return textResult(parts.join('\n'))
}

/** 渲染一条技能的完整内容。 */
function renderSkillRead(value) {
  if (value.ok === false) return textResult(value.message)
  const skill = value.skill
  const files = Array.isArray(skill.files) ? skill.files : []
  const fileLine = files.length > 1 ? `\n目录里的文件：${files.join('、')}` : ''
  return textResult(
    `技能 ${skill.name}（来源：${scopeName(skill.scope)}）\n${skill.path}${fileLine}\n\n` +
    `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n` +
    (skill.whenToUse === undefined ? '' : `whenToUse: ${JSON.stringify(skill.whenToUse)}\n`) +
    (skill.modelInvocable === false ? 'disable-model-invocation: true\n' : '') +
    (skill.userInvocable === false ? 'user-invocable: false\n' : '') +
    `---\n\n${skill.content}`,
  )
}

/** 渲染写入结果。 */
function renderSkillWrite(value) {
  if (value.ok === false) return textResult(value.message)
  return textResult(`已保存技能 ${value.name}：${value.path}\n下一个步骤就能用。手动调用：/${value.name}`)
}

/** 渲染删除结果。 */
function renderSkillDelete(value) {
  if (value.ok === false) return textResult(value.message)
  return textResult(`已删除用户技能的 ${value.name}，文件已从用户目录移除。如果它是内置技能的覆盖版本，内置那份会重新生效。`)
}

/** 渲染技能包清单。 */
function renderPackList(value) {
  if (value.ok === false) return textResult(value.message)
  if (value.packs.length === 0) return textResult('插件里没有随包提供的技能包。')
  const lines = value.packs.map(pack => {
    const status = pack.installed
      ? (pack.version === pack.installedVersion ? `已装 v${pack.installedVersion}` : `已装 v${pack.installedVersion}，包内是 v${pack.version}，可升级`)
      : '未安装'
    const extra = []
    if (pack.changed !== undefined && pack.changed.length > 0) extra.push(`${pack.changed.length} 个文件被本地改过`)
    if (pack.missing !== undefined && pack.missing.length > 0) extra.push(`${pack.missing.length} 个文件缺失`)
    return `- ${pack.id}（${pack.name}，v${pack.version}，含 ${pack.skillCount} 个技能）：${status}${extra.length > 0 ? '；' + extra.join('；') : ''}\n  ${pack.description}`
  })
  return textResult('技能包：\n\n' + lines.join('\n') + '\n\n装或升级用 skill_pack_install，packId 填上面的 id。升级不会覆盖你改过的文件。')
}

/** 渲染技能包安装结果。 */
function renderPackInstall(value) {
  if (value.ok === false) return textResult(value.message)
  const lines = [`技能包 ${value.packId} 已装到 v${value.version}：新增 ${value.added.length} 个文件，更新 ${value.updated.length} 个，跳过 ${value.skipped.length} 个。`]
  if (value.skipped.length > 0) {
    lines.push('跳过的是你改过的文件，升级不动它们：')
    for (const file of value.skipped.slice(0, 12)) lines.push('  ' + file)
    if (value.skipped.length > 12) lines.push(`  …还有 ${value.skipped.length - 12} 个`)
  }
  if (value.kept !== undefined && value.kept.length > 0) {
    lines.push('这些文件本来就在你的技能目录里、内容和包里的不一样，没有动它们：')
    for (const file of value.kept.slice(0, 12)) lines.push('  ' + file)
    if (value.kept.length > 12) lines.push(`  …还有 ${value.kept.length - 12} 个`)
    lines.push('想让包接管它们，先把这些文件删掉再装一次。')
  }
  const overlaps = value.overlaps === undefined ? {} : value.overlaps
  const names = Object.keys(overlaps)
  if (names.length > 0) {
    lines.push('这些包里的技能和插件自带的基础技能功能重复，建议二选一：')
    for (const mine of names) lines.push(`  基础技能 ${mine} ↔ 包里的 ${overlaps[mine]}`)
  }
  lines.push('技能文件保存即生效，不用重启。')
  return textResult(lines.join('\n'))
}

const listResultSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    userRoot: { type: 'string' },
    skills: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  additionalProperties: true,
}

const readResultSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, skill: { type: 'object', additionalProperties: true } },
  additionalProperties: true,
}

const writeResultSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, name: { type: 'string' }, path: { type: 'string' } },
  additionalProperties: true,
}

const deleteResultSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, name: { type: 'string' } },
  additionalProperties: true,
}

const packListResultSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    packs: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  additionalProperties: true,
}

const packInstallResultSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    packId: { type: 'string' },
    version: { type: 'string' },
    added: { type: 'array', items: { type: 'string' } },
    updated: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    kept: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: true,
}

/**
 * 组装技能管理工具：让模型在对话里直接读写技能库，不必让用户去设置页。
 * @param admin - 复用面板那套读写逻辑。
 */
function buildSkillTools(admin) {
  /** 统一把错误翻成 ok:false，工具不会因为业务错误而中断。 */
  const attempt = async (work) => {
    try {
      return prune({ ok: true, ...(await work()) })
    } catch (error) {
      return { ok: false, message: describe(error) }
    }
  }

  return [
    {
      name: 'skill_list',
      description: '列出本机全部技能（项目级、用户级、插件内置），标明来源、调用方式、是否被覆盖、附件数。回答「我有哪些技能」，或在写新技能前查名字是否被占用时使用。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: listResultSchema, render: (_args, value) => renderSkillList(value) },
      execute: async (_args, exec) => attempt(() => {
        const listing = admin.list({ cwd: sessionCwd(exec) })
        return {
          userRoot: listing.roots.user,
          projectRoots: listing.roots.project,
          skills: listing.skills.map(skill => ({
            name: skill.name,
            scope: skill.scope,
            description: skill.description,
            whenToUse: skill.whenToUse,
            modelInvocable: skill.modelInvocable,
            userInvocable: skill.userInvocable,
            shadowed: skill.shadowed,
            path: skill.path,
            files: skill.files,
          })),
        }
      }),
    },
    {
      name: 'skill_read',
      description: '读出一条技能的完整内容（frontmatter 加正文）与附件清单。改任何技能之前先读它，避免把没打算改的部分弄丢。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名，小写加连字符。' },
          scope: { type: 'string', enum: ['project', 'user', 'builtin'], description: '读哪一份；省略时依次优先项目、用户、内置。' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: { schema: readResultSchema, render: (_args, value) => renderSkillRead(value) },
      execute: async (args, exec) => attempt(() => {
        const wanted = String(args?.name ?? '')
        const options = { cwd: sessionCwd(exec) }
        const raw = args?.scope
        const requested = raw === 'builtin' || raw === 'user' || raw === 'project' ? raw : undefined
        if (requested !== undefined) return { skill: admin.read({ scope: requested, name: wanted }, options) }
        try {
          return { skill: admin.read({ scope: 'project', name: wanted }, options) }
        } catch {
          try {
            return { skill: admin.read({ scope: 'user', name: wanted }, options) }
          } catch {
            return { skill: admin.read({ scope: 'builtin', name: wanted }, options) }
          }
        }
      }),
    },
    {
      name: 'skill_write',
      description: '在用户技能目录里新建或修改一条技能。用户说「把这条记下来」「以后都这样做」「帮我写个技能」时用它；改已有技能前先用 skill_read 读一遍。写完下一步即生效。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名，小写字母加连字符，例如 code-review。' },
          description: { type: 'string', description: '一句话说清什么时候该用它；这句决定 AI 会不会自己调用。' },
          content: { type: 'string', description: '正文：什么时候做、步骤、完成标志、不要做什么。控制在一屏内。' },
          whenToUse: { type: 'string', description: '可选，给用户看的一句话使用时机。' },
          modelInvocable: { type: 'boolean', description: '是否允许 AI 自己调用，默认允许；只给人手动用的设 false。' },
          userInvocable: { type: 'boolean', description: '是否允许用户输入 /名字 调用，默认允许。' },
        },
        required: ['name', 'description', 'content'],
        additionalProperties: false,
      },
      output: { schema: writeResultSchema, render: (_args, value) => renderSkillWrite(value) },
      execute: async (args) => attempt(() => admin.save({
        name: args?.name,
        description: args?.description,
        content: args?.content,
        whenToUse: args?.whenToUse,
        modelInvocable: args?.modelInvocable !== false,
        userInvocable: args?.userInvocable !== false,
      })),
    },
    {
      name: 'skill_delete',
      description: '删除用户自己写的一条技能。内置技能删不掉，只能被覆盖，所以只存在于内置的名字会删除失败。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '技能名，小写加连字符。' } },
        required: ['name'],
        additionalProperties: false,
      },
      output: { schema: deleteResultSchema, render: (_args, value) => renderSkillDelete(value) },
      execute: async (args) => attempt(() => admin.remove({ name: args?.name })),
    },
    {
      name: 'skill_pack_list',
      description: '列出插件自带的技能包（一组相关技能一次装完）、装了没、包内有没有新版、你有几个文件改过。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: packListResultSchema, render: (_args, value) => renderPackList(value) },
      execute: async () => attempt(() => ({ packs: admin.packStatus() })),
    },
    {
      name: 'skill_pack_install',
      description: '安装或升级一个技能包。你本地改过的文件不会被覆盖，只会被跳过并如实报告，所以升级不会弄丢你的修改。',
      parameters: {
        type: 'object',
        properties: { packId: { type: 'string', description: '技能包 id，从 skill_pack_list 取，例如 engineering-zh。' } },
        required: ['packId'],
        additionalProperties: false,
      },
      output: { schema: packInstallResultSchema, render: (_args, value) => renderPackInstall(value) },
      execute: async (args) => attempt(() => admin.installPack({ packId: args?.packId })),
    },
  ]
}

/**
 * 插件入口。
 * @param ctx - 插件上下文（Cordis）。
 */
export function apply(ctx, config = {}) {
  const disposers = []
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch {
      /* 日志失败不影响插件本身 */
    }
  }
  trace(`apply 开始（userDir 配置=${String(config.userDir)}）`)

  // 1. 内置技能：注册进全局层。用户目录里的同名技能会覆盖它们（更近的层优先）。
  for (const entry of scanSkillRoot(builtinSkillsDir)) {
    try {
      const skill = loadSkill(entry)
      if (skill === undefined) {
        warn(`[dsh-skills] 跳过内置技能 ${entry.file}：frontmatter 缺少合法的 name/description，或正文为空`)
        continue
      }
      disposers.push(
        ctx.skills.register({
          name: skill.name,
          description: skill.description,
          ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
          content: skill.content,
          invocation: { modelInvocable: skill.modelInvocable, userInvocable: skill.userInvocable },
          resourceBase: { kind: 'directory', path: entry.dir },
          source: 'dsh-skills',
        }),
      )
    } catch (error) {
      warn(`[dsh-skills] 内置技能注册失败：${describe(error)}`)
    }
  }

  trace(`内置技能注册结束（目录里 ${scanSkillRoot(builtinSkillsDir).length} 个）`)

  // 2. 管理接口：设置页的技能面板通过它读写文件。
  const admin = new SkillAdmin({
    userDir: config.userDir ?? userSkillsDir,
    builtinDir: builtinSkillsDir,
  })

  // 3. 工具：让模型在对话里直接读写技能库，用户不必打开设置页。
  let toolsUsable = false
  if (config.enableTools === false) {
    trace('配置里关掉了工具：模型侧不会出现 skill_* 工具，设置面板照常可用')
  }
  try {
    toolsUsable = config.enableTools !== false && ctx.tools !== undefined && typeof ctx.tools.register === 'function'
  } catch (error) {
    trace(`访问 ctx.tools 抛错：${describe(error)}`)
  }
  trace(`ctx.tools 可用=${toolsUsable}`)
  if (toolsUsable) {
    for (const definition of buildSkillTools(admin)) {
      try {
        const dispose = ctx.tools.register(definition)
        trace(`工具 ${definition.name} 注册成功（disposer=${typeof dispose}）`)
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch (error) {
        trace(`工具 ${definition.name} 注册失败：${describe(error)}`)
        warn(`[dsh-skills] 工具 ${definition.name} 注册失败：${describe(error)}`)
      }
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (host) => {
      const registration = host.connection?.fetch?.register({
        path: ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => admin.handle(request),
      })
      if (typeof registration === 'function') disposers.push(registration)
    })
  }

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 释放失败不应打断其他释放 */
        }
      }
    })
  }

  try {
    ctx.logger?.info?.(`[dsh-skills] 已注册内置技能，用户技能目录：${admin.userDir}`)
  } catch {
    /* 忽略日志失败 */
  }
}

export { SkillAdmin, buildSkillTools, ROUTE, ACTION_HEADER, userSkillsDir, builtinSkillsDir }
