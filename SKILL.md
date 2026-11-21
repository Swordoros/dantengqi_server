---
name: dantengqi-deploy
description: "蛋疼棋（39.105.89.152:6657）的开发与部署。本仓库是上游 Lyun7-zZ/dantengqi 的 fork：main = 上游最新代码 + 两样本地功能（服务器部署包、ID/排行榜）。改客户端源码要用 tools/build-single.mjs 重新打包 dist；部署用 deploy/install.sh 装成 systemd 服务 danteng。提到「部署蛋疼棋」「更新 6657」「同步上游」「改排行榜/ID」时用。"
---

# 蛋疼棋：同步、开发、部署

## 仓库关系

| 项 | 值 |
|---|---|
| 本仓库（fork） | `https://github.com/Swordoros/dantengqi_server` |
| 上游（朋友的版本） | `https://github.com/Lyun7-zZ/dantengqi` |
| 上游默认分支 | `main` |
| 本仓库 remote | `origin` → fork，`upstream` → 上游 |

**分工**：上游负责游戏本体（规则、AI、联机、两种模式）；本仓库只额外加两样东西，其余尽量不偏离上游：

1. **服务器部署包**：`deploy/install.sh`、`deploy/README.md`、`SKILL.md`、`README.txt`、`发给朋友的话.md`；
2. **ID + 排行榜**：`server/leaderboard.js`（新增）、`server/index.js` 里的 `/api/*` 路由、`index.html` 的弹窗与排行榜块、`app.js` / `app-async.js` 结算处的一个上报钩子。

除上述文件外，其他文件应与上游一致；同步时优先保留上游版本，只在冲突处重新套用本地功能。

## 同步上游

```powershell
cd D:\Desktop\staff\dantengqi-server
git fetch upstream
git merge upstream/main          # 或 git rebase upstream/main
```

冲突热点（本地功能都落在这几个文件里）：`index.html`、`styles.css`、`app.js`、`app-async.js`、`server/index.js`、`dist/蛋疼棋.html`（产物，直接重新打包覆盖即可）。

`dist/蛋疼棋.html` 是构建产物，冲突时不要手工合并，直接重新打包：

```powershell
node tools/build-single.mjs
```

（本机没有全局 node 时，用 DSH 自带的：`C:\Users\17680\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`）

## 本地功能的实现位置

| 功能 | 位置 |
|---|---|
| ID 弹窗 + 排行榜 UI | `index.html`（`#dtIdentity`、`#dtLeaderboard`，以及文件末尾的 inline `<script>`） |
| 样式 | `styles.css` 末尾的 `/* 本地部署功能 */` 段 |
| 胜场上报钩子 | `app.js`、`app-async.js` 的 `showResult()` 第一行 `window.__dantengRecordWin?.()` |
| 服务端接口与存储 | `server/leaderboard.js`、`server/index.js` 的 `/api/*` 路由 |
| 打包 | `tools/build-single.mjs`（上游提供，会把 `index.html` + `styles.css` + 两个模式 bundle 合成单文件） |

难度六档，顺序与首页菜单一致：`easy / normal / hard / master / grandmaster / hell`（简单/普通/困难/大师/宗师/地狱）。
客户端在没有服务端（`/api/health` 不通）时会自动隐藏 ID 弹窗和排行榜，独立单文件版的行为与上游一致。

## 服务器

| 项 | 值 |
|---|---|
| 地址 | `39.105.89.152:6657`（阿里云 Alibaba Cloud Linux 3） |
| 登录 | root，密钥 `D:\Documents\EidolonTunnel\SC.pem` |
| 服务 | systemd `danteng`，代码在 `/opt/danteng`，用户 `danteng` |
| 数据 | `/opt/danteng/data/leaderboard.json`（升级不覆盖） |

**注意：线上目前仍是 2026-11-19 部署的旧版**（当时基于 `b35e3c14` 的部署包 + 手改的页面），
本仓库已经同步到上游 `df8d706` 并在本地验证通过，但**尚未推上服务器**。要上线时按下面流程。

### 部署 / 升级

```powershell
$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"
$scp = "C:\Windows\System32\OpenSSH\scp.exe"
$key = "D:\Documents\EidolonTunnel\SC.pem"

# 1. 上传整个仓库（不含 .git / node_modules）
& $ssh -i $key root@39.105.89.152 "rm -rf /root/dantengqi-up && mkdir -p /root/dantengqi-up"
& $scp -i $key -r index.html styles.css app.js app-async.js loader.js src server dist deploy package.json root@39.105.89.152:/root/dantengqi-up/

# 2. 跑安装脚本（幂等，会重启服务）
& $ssh -i $key root@39.105.89.152 "cd /root/dantengqi-up && PORT=6657 bash deploy/install.sh"
```

改的只是页面（`index.html` / `styles.css` / 两个 app）时，先本地打包，再只传 `dist/蛋疼棋.html`，不用重启：

```powershell
node tools/build-single.mjs
& $scp -i $key dist\蛋疼棋.html root@39.105.89.152:/opt/danteng/dist/
& $ssh -i $key root@39.105.89.152 "chown danteng:danteng /opt/danteng/dist/蛋疼棋.html && chmod 644 /opt/danteng/dist/蛋疼棋.html"
```

### 验证

```powershell
$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"; $key = "D:\Documents\EidolonTunnel\SC.pem"
& $ssh -i $key root@39.105.89.152 @'
set -e
systemctl is-active danteng
curl -fsS http://127.0.0.1:6657/api/health
curl -fsS http://127.0.0.1:6657/api/leaderboard
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:6657/
'@
```

外网再确认一次 `http://39.105.89.152:6657/`：首页有人机六档、排行榜，进 ID 后能上榜。

### 回滚

- **回到上一版程序**：重新上传上一版文件再跑 `deploy/install.sh`；git 里每个上线版本都应打 tag。
- **回到 2026-11-19 之前的 Nginx + Docker 版**：备份在 `/root/danteng-backup-20261119-1740/`，
  镜像是 `danteng:before-update`，容器 `danteng-api` 只是停了：

```powershell
& $ssh -i $key root@39.105.89.152 @'
set -e
systemctl disable --now danteng
cp /root/danteng-backup-20261119-1740/nginx-dantengqi.conf /etc/nginx/conf.d/dantengqi.conf
nginx -t && systemctl reload nginx
docker start danteng-api
'@
```

## 注意事项

- **页面是构建产物**：改 `index.html` / `styles.css` / `app*.js` 后必须 `node tools/build-single.mjs`，否则线上看不到改动。
- 六档难度里，异步模式没有独立的「宗师 / 地狱」引擎，`src/ai-async.js` 里这两档暂与「大师」同档（上游缺，不加会报错）。
- 排行榜只记人机对战里玩家获胜；没有服务端棋局校验，防不了作弊。
- 房间与对局只存内存，重启服务会丢；排行榜在磁盘上，重启不丢，但手改 `leaderboard.json` 后要重启服务才生效。
- 这台是共享服务器，还在跑 `eidolon-sc` 的容器（Nginx 3000/8000/8765）。**不要动它的配置和镜像**，也不要随手 `docker image prune`——会删掉别人打好的回滚 tag。
- 磁盘常年 95%（剩约 2GB），别在上面留大文件。
