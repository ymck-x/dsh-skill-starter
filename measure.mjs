/**
 * 量一下每轮对话的固定开销：
 *   - 技能目录：每个技能只注入 name + description
 *   - 工具 schema：六个工具的 name + description + 参数结构
 * 跑法：node "C:\Users\Administrator\.dsh\profiles\desktop\plugins\dsh-skills\measure.mjs"
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginDir = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')
const mod = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
const { parseSkillFile, scanSkillRoot } = mod

const roots = [
  { label: '用户目录', dir: join(homedir(), '.dsh', 'skills') },
  { label: '插件内置', dir: join(pluginDir, 'skills') },
]

let skillChars = 0
let skillCount = 0
const perRoot = []
for (const root of roots) {
  let chars = 0
  let count = 0
  for (const entry of scanSkillRoot(root.dir)) {
    const parsed = parseSkillFile(readFileSync(entry.file, 'utf8'))
    if (parsed.name === '' || parsed.description === '') continue
    chars += parsed.name.length + parsed.description.length
    count += 1
  }
  perRoot.push({ label: root.label, count, chars })
  skillChars += chars
  skillCount += count
}

const source = readFileSync(join(pluginDir, 'index.js'), 'utf8')
// 工具注入的是整段 schema：工具描述、参数描述、参数名都算在内。
const toolsStart = source.indexOf('  return [\n    {\n      name: \'skill_list\'')
const toolsEnd = source.indexOf('\n  ]\n}', toolsStart)
const toolSection = toolsStart >= 0 && toolsEnd > toolsStart ? source.slice(toolsStart, toolsEnd) : ''
const toolNames = [...toolSection.matchAll(/name: '(skill_[a-z_]+)'/g)].map(hit => hit[1])
const descStrings = [...toolSection.matchAll(/description:\s*(?:'([^']*)'|"([^"]*)")/g)].map(hit => hit[1] ?? hit[2] ?? '')
const toolChars = descStrings.reduce((sum, text) => sum + text.length, 0) + toolNames.join('').length

// 经验区间：中文 1 个汉字大致 0.6 到 1 个 token，再加 JSON 结构与换行的开销。
const tokens = (chars) => [Math.round(chars * 0.6), Math.round(chars * 1.2)]

console.log('=== 技能目录（每轮都注入） ===')
for (const row of perRoot) {
  const [low, high] = tokens(row.chars)
  console.log('%s：%d 个技能，%d 字，约 %d 到 %d token', row.label, row.count, row.chars, low, high)
}
const [skillLow, skillHigh] = tokens(skillChars)
console.log('小计：%d 个技能，%d 字，约 %d 到 %d token', skillCount, skillChars, skillLow, skillHigh)

console.log('\n=== 工具 schema（每轮都注入） ===')
console.log('工具：%s', toolNames.join('、'))
console.log('描述文字（含参数描述）共 %d 字，分布在 %d 处', toolChars, descStrings.length)
const [toolLow, toolHigh] = tokens(toolChars)
console.log('小计：%d 个工具，约 %d 到 %d token', toolNames.length, toolLow, toolHigh)

console.log('\n=== 合计常驻 ===')
console.log('约 %d 到 %d token', skillLow + toolLow, skillHigh + toolHigh)
console.log('\n（技能正文、面板界面都不在此列：正文只在被加载时读，界面只在打开设置页时渲染）')
