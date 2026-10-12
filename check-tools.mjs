/**
 * 用 DSH 自己的 schema 校验器检查四个工具的定义是否合法。
 * 这段校验正是 ctx.tools.register() 内部会跑的那一步。
 * 跑法：node "C:\Users\Administrator\.dsh\profiles\desktop\plugins\dsh-skills\check-tools.mjs"
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')
const dshToolsUrl = pathToFileURL('E:/GITHUB/dsh-app-extracted/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js').href

const dsh = await import(dshToolsUrl)
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
    ['output.schema', () => dsh.assertSupportedJsonSchema(tool.output.schema)],
    ['parameters 是合法 JSON Schema', () => dsh.assertSupportedJsonSchema(tool.parameters)],
    ['output 形状', () => {
      if (tool.output === undefined || typeof tool.output !== 'object') throw new Error('缺 output')
      if (typeof tool.output.render !== 'function') throw new Error('output.render 不是函数')
    }],
    ['description 非空', () => {
      if (typeof tool.description !== 'string' || tool.description.trim() === '') throw new Error('描述为空')
    }],
    ['name 合法', () => {
      if (typeof tool.name !== 'string' || tool.name === 'run_code') throw new Error('名字不合法或保留')
    }],
  ]
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
