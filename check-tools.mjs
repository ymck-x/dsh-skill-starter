/**
 * 用 DSH 自己的 schema 校验器检查工具定义是否合法——这段校验正是 ctx.tools.register() 内部会跑的那一步。
 *
 * DSH 的校验器打包在 app.asar 里，Node 无法直接加载，所以需要一份解包副本。
 * 找不到时脚本不会崩，会明确提示并跳过 schema 相关的两项，其余检查照常跑。
 *
 * 需要完整校验时，指定解包位置：
 *   set DSH_TOOLS_PATH=C:\path\to\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js
 *
 * 跑法：node check-tools.mjs
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginDir = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')

const candidates = [
  process.env.DSH_TOOLS_PATH,
  join(process.env.LOCALAPPDATA ?? '', 'Programs/DeepSeek Harness/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'),
  join(process.env.USERPROFILE ?? '', '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/node_modules/@deepseek-ai/dsh-tools/lib/index.js'),
].filter(candidate => typeof candidate === 'string' && candidate !== '' && existsSync(candidate))

let dsh = null
for (const candidate of candidates) {
  try {
    dsh = await import(pathToFileURL(candidate).href)
    console.log('使用校验器：' + candidate + '\n')
    break
  } catch {
    /* 换下一个候选 */
  }
}

if (dsh === null) {
  console.log('没找到 DSH 的 schema 校验器（它打包在 app.asar 里，Node 直接读不了）。')
  console.log('跳过 schema 两项，只跑结构检查。要跑完整校验，先解包 DSH 并设置 DSH_TOOLS_PATH。\n')
}

const plugin = await import(pathToFileURL(join(pluginDir, 'index.js')).href)

const admin = new plugin.SkillAdmin({
  userDir: join(pluginDir, 'nonexistent-user-dir'),
  builtinDir: join(pluginDir, 'skills'),
})
const tools = plugin.buildSkillTools(admin)

console.log('共 %d 个工具定义\n', tools.length)
let failures = 0

for (const tool of tools) {
  const checks = [
    ['output 形状', () => {
      if (tool.output === undefined || typeof tool.output !== 'object') throw new Error('缺 output')
      if (typeof tool.output.render !== 'function') throw new Error('output.render 不是函数')
    }],
    ['parameters 是对象结构', () => {
      if (tool.parameters === undefined || tool.parameters.type !== 'object') throw new Error('parameters 必须是 type: object')
      if (tool.parameters.additionalProperties !== false) throw new Error('要求 additionalProperties: false')
    }],
    ['description 非空且够长', () => {
      if (typeof tool.description !== 'string' || tool.description.trim().length < 30) throw new Error('描述为空或过短')
    }],
    ['name 合法', () => {
      if (typeof tool.name !== 'string' || tool.name === 'run_code') throw new Error('名字不合法或保留')
      if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) throw new Error('名字必须是 snake_case')
    }],
  ]

  if (dsh !== null) {
    checks.unshift(['output.schema 被 DSH 接受', () => dsh.assertSupportedJsonSchema(tool.output.schema)])
    checks.unshift(['parameters 被 DSH 接受', () => dsh.assertSupportedJsonSchema(tool.parameters)])
  }

  console.log('%s', tool.name)
  for (const [label, run] of checks) {
    try {
      run()
      console.log('  ok   ' + label)
    } catch (error) {
      failures += 1
      console.log('  FAIL ' + label + '：' + (error instanceof Error ? error.message : String(error)))
    }
  }
}

console.log('\n失败项：%d', failures)
process.exitCode = failures === 0 ? 0 : 1
