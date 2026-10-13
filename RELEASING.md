# 发布到 npm

把当前项目发到 npm 公共仓库。**这份文档可以整份复制到任何 Node 项目**，只需要把「包名」「用户名」换成你自己的。

流程本身只有八步，麻烦全在凭据上——npm 在 2026 年改了两次规矩，网页端和命令行对不上号。遇到报错先查「故障对照表」，别按字面意思猜。

## 主路径

1. **确认包名没被占**：`npm view <包名> version` 返回 `404` 才能用；返回版本号说明已经被占了，必须改名。
2. **改版本号**：`package.json` 里的 `version`。npm 上已存在的版本号不能再发一次。
3. **看会打包什么**：`npm pack --dry-run`。确认列表里没有 `node_modules`、测试脚本、密钥文件。打进包的内容由 `package.json` 的 `files` 字段决定。
4. **建一个带 bypass 2FA 的令牌**，做法见「凭据」。
5. **把令牌写进项目根目录的 `.npmrc`**，一行：

   ```
   //registry.npmjs.org/:_authToken=npm_你的令牌
   ```

6. **发布**：`npm publish`。输出里出现 `+ <包名>@<版本>` 就是成功。
   `package.json` 里 `prepublishOnly` 指定的命令会先跑一遍，跑失败就不会发出去。
7. **等一到两分钟再验证**：`npm view <包名> version`。发布瞬间 npm 会回一句 `Your package is being processed`，这期间查不到属于正常。
8. **做完「发布后必做」里的三件事**，一件都不能省。

## 凭据

**`npm login` 拿到的登录凭据发不了包**，会回 403；而且账号一启用 2FA，这个凭据会被自动撤销。能发布的只有一样东西：**勾了 `Bypass 2FA` 的 granular access token（细粒度访问令牌）**。

令牌在这里建：`https://www.npmjs.com/settings/<用户名>/tokens` → `Generate New Token` → `Granular Access Token`。四个字段要选对：

| 字段 | 选什么 |
|---|---|
| Token name | 随便起，不能和已有令牌重名 |
| Permissions | `Read and write (publish and stage)` |
| Select packages | `All packages` |
| Bypass 2FA | **勾上**。页面会警告「这么做有安全风险」，无视它 |

生成后那串 `npm_` 开头的字符只显示一次，当场复制。

**令牌必须落进 `.npmrc` 文件，光在网页上建出来不算数。** npm 命令行会优先使用会话凭据、把你的令牌晾在一边——这是整条流程里最容易白折腾一轮的地方。

## 故障对照表

| 报错 | 真正的原因 | 怎么办 |
|---|---|---|
| `403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.` | 令牌没勾 Bypass 2FA，或者用的是 `npm login` 的会话凭据 | 重建令牌，写进 `.npmrc` |
| `403 ... POST https://registry.npmjs.org/-/npm/v1/user - unauthorized` | 账号设置类操作（改密码、改 2FA、建令牌）**不允许用令牌做**，npm 从 2026 年 7 月起封了这条路 | 只能去网页上做，命令行绕不过 |
| `404 ... PUT https://registry.npmjs.org/<包名> - Not found` | **不是包名的问题**，是认证无效。registry 对「没认证的写入」一律回 404，好让你看不出包存不存在 | 检查 `.npmrc` 里的令牌是否被删或过期 |
| `401 ... your authentication token seems to be invalid` | 登录被撤销了。账号启用 2FA 时，npm 会撤销所有旧登录 | 重新登录 |
| `duplicate token names are not allowed` | 建令牌时名字撞了已有的 | 换个名字 |
| 网页上「2FA 方法」只有「安全密钥」一项，没有「身份验证器应用」 | npm 现在网页端只发通行密钥，不再给验证器 App 那条路 | 用**手机浏览器**登录 npm 注册通行密钥（手机本机操作，按一下指纹即可）。在电脑上注册会弹出二维码让你用手机扫，成功率低 |

## 发布后必做

1. **删掉项目里的 `.npmrc`**——里面是明文令牌。删完确认 `git status` 里没有它。
2. **撤销刚才那个令牌**：`https://www.npmjs.com/settings/<用户名>/tokens` → `Revoke`。它能绕过 2FA，不该长期存在。
3. **恢复码一经他人过目就作废重建**：恢复码是 64 位十六进制那种，能当一次性验证码用。只要它出现在聊天记录、日志、截图里，就去 2FA 设置里点 `Regenerate recovery codes`，旧码立即失效。

## 下次发版

重走一遍「主路径」。令牌每次重建——它默认 7 天过期，最长 90 天，用完即撤。

**2027 年 1 月起**，带 bypass 2FA 的令牌会失去直接发布能力，只剩「暂存发布」：包推到暂存区后，由人在网页上用 2FA 批准。到那天改用 trusted publishing（GitHub Actions + OIDC，不需要令牌）。

## 本项目额外要做的

（这一段是 `dsh-skill-starter` 特有的，复制到别的项目时删掉。）

README 里给了一条 GitHub 固定 tag 地址的备选安装方式，它写死了版本号。所以除了上面八步，还要：

1. **打 tag 并推送**：`git tag v<版本>` 然后 `git push origin v<版本>`。README 里那个地址靠它才有效。
2. **改 README 里的 tag 号**：把 `refs/tags/v<旧版本>.tar.gz` 换成新版本。
3. **在 GitHub 上建一个 Release**：只推 tag 的话，从 tag 点进去是一个空页面。
