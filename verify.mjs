/**
 * dsh-skill-starter 自测：解析、渲染往返、扫描、增删改查、路径安全。
 * 跑法：node "<插件目录>\verify.mjs"
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginDir = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')
const mod = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
const { parseSkillFile, renderSkillFile, scanSkillRoot, SkillAdmin } = mod

let passed = 0
const check = (label, fn) => { fn(); passed += 1; console.log('  ok  ' + label) }

console.log('1. 解析内置技能')
for (const name of ['write-my-skill', 'plain-words', 'tiny-steps', 'ask-first', 'prove-it', 'setup-tickets']) {
  const text = readFileSync(join(pluginDir, 'skills', name, 'SKILL.md'), 'utf8')
  const parsed = parseSkillFile(text)
  check(name, () => {
    assert.equal(parsed.name, name, 'frontmatter name 应为目录名')
    assert.ok(parsed.description.length > 10, 'description 太短')
    assert.ok(parsed.content.length > 50, '正文字数太少')
    assert.equal(parsed.modelInvocable, true)
    assert.equal(parsed.userInvocable, true)
  })
}

console.log('2. 渲染与解析往返')
const source = {
  name: 'demo-skill',
  description: '含冒号: 与「引号」以及\n换行',
  whenToUse: '某时',
  modelInvocable: false,
  userInvocable: false,
  content: '第一行\n\n- 步骤一\n- 步骤二',
}
const roundTrip = parseSkillFile(renderSkillFile(source))
check('往返一致', () => {
  assert.equal(roundTrip.name, source.name)
  assert.equal(roundTrip.description, '含冒号: 与「引号」以及 换行')
  assert.equal(roundTrip.whenToUse, source.whenToUse)
  assert.equal(roundTrip.modelInvocable, false)
  assert.equal(roundTrip.userInvocable, false)
  assert.equal(roundTrip.content, source.content)
})

console.log('3. 扫描')
check('扫到 6 个内置技能', () => {
  assert.equal(scanSkillRoot(join(pluginDir, 'skills')).length, 6)
})
check('不存在的目录返回空', () => {
  assert.deepEqual(scanSkillRoot(join(pluginDir, 'no-such-dir')), [])
})

console.log('4. 管理接口')
const root = mkdtempSync(join(tmpdir(), 'dsh-skill-starter-'))
const userDir = join(root, 'skills')
const admin = new SkillAdmin({ userDir, builtinDir: join(pluginDir, 'skills') })

async function call(body, headers = {}) {
  const request = new Request('http://127.0.0.1/api/dsh-skill-starter/manage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-skill-starter-action': '1', ...headers },
    body: JSON.stringify(body),
  })
  const response = await admin.handle(request)
  return { status: response.status, value: await response.json() }
}

try {
  const listed = await call({ action: 'list' })
  check('列表返回 6 个内置技能', () => {
    assert.equal(listed.status, 200)
    assert.equal(listed.value.skills.length, 6)
    assert.ok(listed.value.skills.every(skill => skill.scope === 'builtin'))
    assert.equal(listed.value.roots.userExists, false)
  })

  const saved = await call({
    action: 'save', name: 'my-note', description: '我的第一个技能', whenToUse: '随时',
    modelInvocable: true, userInvocable: true, content: '写点东西。',
  })
  check('保存新技能', () => {
    assert.equal(saved.status, 200)
    assert.ok(existsSync(join(userDir, 'my-note', 'SKILL.md')))
  })

  const afterSave = await call({ action: 'list' })
  check('列表里出现我的技能', () => {
    const mine = afterSave.value.skills.filter(skill => skill.scope === 'user')
    assert.equal(mine.length, 1)
    assert.equal(mine[0].name, 'my-note')
    assert.equal(afterSave.value.roots.userExists, true)
  })

  const read = await call({ action: 'read', scope: 'user', name: 'my-note' })
  check('读取正文', () => {
    assert.equal(read.value.skill.content, '写点东西。')
    assert.equal(read.value.skill.description, '我的第一个技能')
  })

  const copied = await call({ action: 'copy', name: 'write-my-skill' })
  check('复制内置技能', () => {
    assert.equal(copied.status, 200)
    assert.ok(existsSync(join(userDir, 'write-my-skill', 'SKILL.md')))
  })

  const afterCopy = await call({ action: 'list' })
  check('被覆盖的内置技能标了 shadowed', () => {
    const shadowed = afterCopy.value.skills.find(skill => skill.name === 'write-my-skill' && skill.scope === 'builtin')
    assert.equal(shadowed.shadowed, true)
  })

  const duplicate = await call({ action: 'copy', name: 'write-my-skill' })
  check('重复复制被拒绝', () => {
    assert.equal(duplicate.status, 400)
    assert.match(duplicate.value.message, /同名/)
  })

  const badName = await call({ action: 'save', name: 'Bad Name', description: 'x', content: 'y' })
  check('非法名字被拒绝', () => {
    assert.equal(badName.status, 400)
    assert.match(badName.value.message, /英文小写/)
  })

  const traversal = await call({ action: 'save', name: '../escape', description: 'x', content: 'y' })
  check('路径穿越被拒绝', () => {
    assert.equal(traversal.status, 400)
  })

  const emptyBody = await call({ action: 'save', name: 'blank', description: 'x', content: '   ' })
  check('空正文被拒绝', () => {
    assert.equal(emptyBody.status, 400)
  })

  const removed = await call({ action: 'delete', name: 'my-note' })
  check('删除我的技能', () => {
    assert.equal(removed.status, 200)
    assert.equal(existsSync(join(userDir, 'my-note')), false)
  })

  const removeMissing = await call({ action: 'delete', name: 'my-note' })
  check('删除不存在的技能报错', () => {
    assert.equal(removeMissing.status, 400)
  })

  const noHeader = await call({ action: 'list' }, { 'x-dsh-skill-starter-action': '0' })
  check('缺少自定义请求头被拒绝', () => {
    assert.equal(noHeader.status, 403)
  })

  const unknown = await call({ action: 'nope' })
  check('未知操作报错', () => {
    assert.equal(unknown.status, 400)
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('5. 客户端分组与文案')
{
  const clientSource = readFileSync(join(pluginDir, 'client.js'), 'utf8')
  const builtinNames = scanSkillRoot(join(pluginDir, 'skills'))
    .map(entry => parseSkillFile(readFileSync(entry.file, 'utf8')).name)
  const groups = [...clientSource.matchAll(/\{ id: '([a-z]+)', skills: \[([^\]]*)\] \}/g)]
    .map(match => ({ id: match[1], names: [...match[2].matchAll(/'([a-z0-9-]+)'/g)].map(hit => hit[1]) }))
  const countsInSource = (key) => clientSource.split('\n')
    .filter(line => line.trim().startsWith(key + ':')).length

  check('分组定义读到了', () => assert.ok(groups.length > 0))
  for (const group of groups) {
    const base = 'group' + group.id[0].toUpperCase() + group.id.slice(1)
    check(`${base} 有中英两条文案`, () => {
      assert.equal(countsInSource(base), 2, `${base} 应在 zh 和 en 各出现一次`)
      assert.equal(countsInSource(base + 'Hint'), 2, `${base}Hint 应在 zh 和 en 各出现一次`)
    })
    for (const name of group.names) {
      check(`分组 ${group.id} 指向的技能 ${name} 存在`, () => {
        assert.ok(builtinNames.includes(name), `找不到内置技能 ${name}，它会从列表里消失`)
      })
    }
  }
  check('groupOther 有中英两条文案', () => {
    assert.equal(countsInSource('groupOther'), 2)
  })
}

console.log('6. 技能工具')
{
  const toolRoot = mkdtempSync(join(tmpdir(), 'dsh-skill-starter-tools-'))
  try {
    const toolAdmin = new SkillAdmin({ userDir: join(toolRoot, 'skills'), builtinDir: join(pluginDir, 'skills') })
    const tools = mod.buildSkillTools(toolAdmin)
    const byName = new Map(tools.map(tool => [tool.name, tool]))

    check('注册了 6 个工具', () => assert.equal(tools.length, 6))
    check('每个工具结构完整', () => {
      for (const tool of tools) {
        assert.equal(typeof tool.name, 'string', tool.name + ' 缺 name')
        assert.ok(tool.description.length > 30, tool.name + ' 描述太短，模型判断不了何时用')
        assert.equal(tool.parameters.type, 'object', tool.name + ' 参数必须是 object')
        assert.equal(typeof tool.output.render, 'function', tool.name + ' 缺 render')
        assert.equal(typeof tool.execute, 'function', tool.name + ' 缺 execute')
      }
    })

    const listed = await byName.get('skill_list').execute({})
    check('skill_list 列出 6 个内置技能', () => {
      assert.equal(listed.ok, true)
      assert.equal(listed.skills.length, 6)
    })

    const written = await byName.get('skill_write').execute({
      name: 'tool-made', description: '工具写出来的技能', content: '正文内容。',
    })
    check('skill_write 建出技能文件', () => {
      assert.equal(written.ok, true)
      assert.ok(existsSync(join(toolRoot, 'skills', 'tool-made', 'SKILL.md')))
    })

    const readBack = await byName.get('skill_read').execute({ name: 'tool-made' })
    check('skill_read 读回正文', () => assert.equal(readBack.skill.content, '正文内容。'))

    const badWrite = await byName.get('skill_write').execute({ name: 'Bad Name', description: 'x', content: 'y' })
    check('skill_write 非法名字返回失败而不是抛错', () => {
      assert.equal(badWrite.ok, false)
      assert.match(badWrite.message, /英文小写/)
    })

    const badRead = await byName.get('skill_read').execute({ name: 'no-such-skill' })
    check('skill_read 找不到时返回失败', () => assert.equal(badRead.ok, false))

    const removed = await byName.get('skill_delete').execute({ name: 'tool-made' })
    check('skill_delete 删掉技能', () => {
      assert.equal(removed.ok, true)
      assert.equal(existsSync(join(toolRoot, 'skills', 'tool-made')), false)
    })

    const listText = byName.get('skill_list').output.render({}, listed)
    check('skill_list 渲染出文本块', () => {
      assert.equal(Array.isArray(listText), true)
      assert.equal(listText[0].type, 'text')
      assert.ok(listText[0].text.includes('ask-first'))
    })

    check('工具返回值里没有 undefined（否则整次调用会被拒）', () => {
      const walk = (value, path) => {
        assert.notEqual(value, undefined, path + ' 是 undefined')
        if (Array.isArray(value)) value.forEach((item, index) => walk(item, path + '[' + index + ']'))
        else if (value !== null && typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) walk(item, path + '.' + key)
        }
      }
      walk(listed, 'skill_list')
      walk(readBack, 'skill_read')
      walk(written, 'skill_write')
      walk(removed, 'skill_delete')
    })

    const packs = await byName.get('skill_pack_list').execute({})
    check('skill_pack_list 报出 engineering-zh 与 20 个技能', () => {
      assert.equal(packs.ok, true)
      const pack = packs.packs.find(item => item.id === 'engineering-zh')
      assert.ok(pack !== undefined, '没有找到 engineering-zh 包')
      assert.equal(pack.skillCount, 20)
      assert.equal(pack.installed, false)
    })

    const installed = await byName.get('skill_pack_install').execute({ packId: 'engineering-zh' })
    check('skill_pack_install 装出 30 个文件（20 个技能正文 + 10 个附件）', () => {
      assert.equal(installed.ok, true)
      assert.equal(installed.added.length, 30)
      assert.ok(existsSync(join(toolRoot, 'skills', 'grilling', 'SKILL.md')))
      assert.ok(existsSync(join(toolRoot, 'skills', 'skills-map', 'SKILL.md')))
      assert.ok(existsSync(join(toolRoot, 'skills', 'tdd', 'MOCKING.md')))
    })

    const afterInstall = await byName.get('skill_pack_list').execute({})
    check('装完之后状态是已安装、无改动', () => {
      const pack = afterInstall.packs.find(item => item.id === 'engineering-zh')
      assert.equal(pack.installed, true)
      assert.equal(pack.changed.length, 0)
    })

    writeFileSync(join(toolRoot, 'skills', 'grilling', 'SKILL.md'), '我改过了', 'utf8')
    const secondRun = await byName.get('skill_pack_install').execute({ packId: 'engineering-zh' })
    check('升级会跳过被本地改过的文件', () => {
      assert.equal(secondRun.skipped.length, 1)
      assert.equal(secondRun.skipped[0], 'grilling/SKILL.md')
      assert.equal(secondRun.updated.length, 0)
    })

    const changedList = await byName.get('skill_pack_list').execute({})
    check('状态里能看到本地改动', () => {
      const pack = changedList.packs.find(item => item.id === 'engineering-zh')
      assert.equal(pack.changed.length, 1)
    })

    const readWithFiles = await byName.get('skill_read').execute({ name: 'tdd', scope: 'user' })
    check('技能包里的附件会列出来', () => {
      assert.ok(Array.isArray(readWithFiles.skill.files), 'files 应该是数组')
      assert.equal(readWithFiles.skill.files.includes('SKILL.md'), true)
      assert.equal(readWithFiles.skill.files.includes('MOCKING.md'), true)
    })
    const ticketSkill = await byName.get('skill_read').execute({ name: 'setup-tickets', scope: 'builtin' })
    check('内置技能的附件会列出来', () => {
      assert.equal(ticketSkill.skill.files.includes('ISSUE-TRACKER-TEMPLATE.md'), true)
    })

    const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-skill-starter-proj-'))
    try {
      mkdirSync(join(projectRoot, '.git'), { recursive: true })
      const projectSkillDir = join(projectRoot, '.dsh', 'skills', 'proj-note')
      mkdirSync(projectSkillDir, { recursive: true })
      writeFileSync(join(projectSkillDir, 'SKILL.md'),
        ['---', 'name: proj-note', 'description: 项目级技能测试', '---', '', '正文。'].join('\n'), 'utf8')
      const nested = join(projectRoot, 'src', 'deep')
      mkdirSync(nested, { recursive: true })
      const exec = { agent: { session: { header: { cwd: nested } } } }

      const projectList = await byName.get('skill_list').execute({}, exec)
      check('从子目录往上找到项目根并扫出项目级技能', () => {
        const found = projectList.skills.find(skill => skill.name === 'proj-note')
        assert.ok(found !== undefined, '没扫到项目级技能')
        assert.equal(found.scope, 'project')
      })

      const projectRead = await byName.get('skill_read').execute({ name: 'proj-note' }, exec)
      check('不指定 scope 时优先读项目级那份', () => {
        assert.equal(projectRead.skill.scope, 'project')
        assert.equal(projectRead.skill.content, '正文。')
      })
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }

    const missingPack = await byName.get('skill_pack_install').execute({ packId: 'no-such-pack' })
    check('装不存在的包会失败', () => assert.equal(missingPack.ok, false))

    const keepRoot = mkdtempSync(join(tmpdir(), 'dsh-skill-starter-keep-'))
    try {
      const keepAdmin = new SkillAdmin({
        userDir: keepRoot,
        builtinDir: join(pluginDir, 'skills'),
        packsDir: join(pluginDir, 'packs'),
      })
      mkdirSync(join(keepRoot, 'grilling'), { recursive: true })
      writeFileSync(join(keepRoot, 'grilling', 'SKILL.md'), '我自己写的内容', 'utf8')
      const keepResult = keepAdmin.installPack({ packId: 'engineering-zh' })
      check('已存在且内容不同的文件不会被覆盖', () => {
        assert.equal(keepResult.kept.includes('grilling/SKILL.md'), true)
        assert.equal(readFileSync(join(keepRoot, 'grilling', 'SKILL.md'), 'utf8'), '我自己写的内容')
        assert.equal(keepResult.added.length, 29)
      })
    } finally {
      rmSync(keepRoot, { recursive: true, force: true })
    }

    const roadRoot = mkdtempSync(join(tmpdir(), 'dsh-skill-starter-road-'))
    try {
      mkdirSync(join(roadRoot, 'skills-map'), { recursive: true })
      writeFileSync(join(roadRoot, 'skills-map', 'SKILL.md'), [
        '| 你现在的处境 | 加载哪个技能 |',
        '| --- | --- |',
        '| 有个想法，要把它问清楚 | `grilling` |',
        '| 要把已经聊清楚的结论写成规格 | `to-spec`（人工发起） |',
      ].join('\n'), 'utf8')
      const roadAdmin = new SkillAdmin({ userDir: roadRoot, builtinDir: join(pluginDir, 'skills') })
      const road = roadAdmin.roadmap()
      check('能从 skills-map 解析出「处境 → 技能」表', () => {
        assert.equal(road.available, true)
        assert.equal(road.rows.length, 2, '表头与分隔行不该被当成数据')
        assert.equal(road.rows[0].situation, '有个想法，要把它问清楚')
        assert.equal(road.rows[0].skill, 'grilling')
        assert.equal(road.rows[0].manual, false)
        assert.equal(road.rows[1].manual, true)
      })
      const emptyAdmin = new SkillAdmin({ userDir: join(roadRoot, 'nonexistent'), builtinDir: join(pluginDir, 'skills') })
      check('没有 skills-map 时如实报告不可用', () => {
        const empty = emptyAdmin.roadmap()
        assert.equal(empty.available, false)
        assert.deepEqual(empty.rows, [])
      })
    } finally {
      rmSync(roadRoot, { recursive: true, force: true })
    }
  } finally {
    rmSync(toolRoot, { recursive: true, force: true })
  }
}

console.log(`\n全部通过：${passed} 项`)
