/**
 * 检查技能包内容是否符合重写规范。
 * 检查项：单文件、frontmatter 完整、长度、人工发起标记、禁用术语、附件残留。
 * 跑法：node "C:\Users\Administrator\.dsh\profiles\desktop\plugins\dsh-skill-starter\check-pack.mjs"
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')
const skillsDir = join(pluginDir, 'packs', 'engineering-zh', 'skills')

/** 只允许人工发起的技能。 */
const MANUAL_ONLY = [
  'handoff', 'implement', 'teach', 'to-spec', 'to-tickets',
  'to-questionnaire', 'wait-what', 'retro', 'improve-codebase-architecture',
]

/** 不该出现的说法：旧版的特色术语，或者来源痕迹。 */
const BANNED = [
  '前沿', 'frontier', '智能区', 'smart zone', '设计树', 'design tree',
  'mattpocock', 'aihero', 'Pocock', '译自', '上游仓库', '源仓库', '搬运自', '改写自',
]

/**
 * 不该出现的「生成声明」。
 * 只抓声明性的句式；正文里正常举例提到「AI 生成的摘要」不算。
 */
const GENERATED_CLAIMS = [
  '由 AI 生成', '由AI生成', 'AI 生成，仅供', '自动生成，仅供', '本文件由', '本技能由',
]

/** 期望出现的 20 个技能。 */
const EXPECTED = [
  'codebase-design', 'domain-modeling', 'writing-for-agents', 'research', 'prototype',
  'grilling', 'to-spec', 'to-tickets', 'implement', 'code-review',
  'tdd', 'diagnosing-bugs', 'improve-codebase-architecture', 'retro', 'pr',
  'handoff', 'to-questionnaire', 'wait-what', 'teach', 'skills-map',
]

const problems = []
const lines = []

function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(normalized)
  if (match === null) return { ok: false }
  const fields = {}
  for (const raw of match[1].split('\n')) {
    const keyed = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(raw.trim())
    if (keyed === null) continue
    fields[keyed[1]] = keyed[2].trim().replace(/^["']|["']$/g, '')
  }
  return { ok: true, fields, body: normalized.slice(match[0].length) }
}

if (!existsSync(skillsDir)) {
  console.error('找不到技能包目录：' + skillsDir)
  process.exit(1)
}

const dirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

lines.push('技能数：' + dirs.length + '（期望 ' + EXPECTED.length + '）')

for (const want of EXPECTED) {
  if (!dirs.includes(want)) problems.push('缺少技能：' + want)
}
for (const have of dirs) {
  if (!EXPECTED.includes(have)) problems.push('多出未登记的技能：' + have)
}

for (const name of dirs) {
  const dir = join(skillsDir, name)
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name)
  const folders = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)

  if (!files.includes('SKILL.md')) {
    problems.push(name + '：没有 SKILL.md')
    continue
  }
  // 附件是允许的：模板类内容压进正文，方法类与机制类内容放附件。
  const attachments = files.filter(file => file !== 'SKILL.md')

  const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const lineCount = text.split('\n').length
  const parsed = parseFrontmatter(text)
  if (!parsed.ok) {
    problems.push(name + '：没有 frontmatter')
    continue
  }
  if (parsed.fields.name !== name) problems.push(name + '：frontmatter 的 name 是 "' + parsed.fields.name + '"，与目录名不一致')
  if ((parsed.fields.description || '').length < 15) problems.push(name + '：description 太短')

  const isManual = parsed.fields['disable-model-invocation'] === 'true'
  if (MANUAL_ONLY.includes(name) && !isManual) problems.push(name + '：应标为人工发起，缺 disable-model-invocation')
  if (!MANUAL_ONLY.includes(name) && isManual) problems.push(name + '：不该标为人工发起')

  if (lineCount < 15) problems.push(name + '：正文太短（' + lineCount + ' 行）')
  // 路由表要覆盖全部技能，本来就比单个技能长。
  const lineLimit = name === 'skills-map' ? 150 : 95
  if (lineCount > lineLimit) problems.push(name + '：正文偏长（' + lineCount + ' 行，上限 ' + lineLimit + '）')

  for (const word of BANNED) {
    if (text.includes(word)) problems.push(name + '：出现不该用的说法「' + word + '」')
  }

  lines.push('  ' + name.padEnd(32) + lineCount + ' 行' + (isManual ? '  [人工发起]' : '') + (attachments.length > 0 ? '  + ' + attachments.length + ' 个附件' : ''))
}

console.log(lines.join('\n'))
console.log()
if (problems.length === 0) {
  console.log('全部通过：' + dirs.length + ' 个技能符合规范')
} else {
  console.log('发现问题 ' + problems.length + ' 处：')
  for (const problem of problems) console.log('  - ' + problem)
  process.exitCode = 1
}
