蛋疼棋 · 仓库说明
================================

这是朋友那个蛋疼棋的上游仓库（Lyun7-zZ/dantengqi）的 fork：
https://github.com/Swordoros/dantengqi_server

main 分支 = 上游最新代码 + 两样本地新增
--------------------------------------
1. 服务器部署：deploy/install.sh（systemd 服务 danteng，默认 6657）、SKILL.md、deploy/README.md
2. ID + 排行榜：进页面填个 ID，记你在各 AI 难度下赢过几局（server/leaderboard.js + /api/*）

除这两样外，其他文件跟上游保持一致。上游的新功能用 git 合进来：

  git fetch upstream
  git merge upstream/main

（remote：origin = 这个 fork，upstream = 朋友的仓库）

目录
----
index.html      页面骨架（含 ID 弹窗、排行榜块）
styles.css      样式
app.js          回合制模式（含胜场上报钩子）
app-async.js    同时行动模式（含胜场上报钩子）
loader.js       选模式并加载对应 app
src/            规则引擎与 AI（客户端、服务端共用）
server/         服务端：静态托管 + WebSocket /ws + 排行榜 /api/*
  leaderboard.js   排行榜存储（data/leaderboard.json）
  index.js / rooms.js / game.js / async-game.js / protocol.js / static.js
dist/蛋疼棋.html  打包好的单文件页面（构建产物，不要手改）
tools/          开发工具，其中 build-single.mjs 负责打包 dist
deploy/         install.sh 一键部署 + README
test/           单元测试

本地开发
--------
  安装依赖：cd server && npm install
  打包页面：node tools/build-single.mjs      # 改完 index.html/styles.css/app*.js 必须跑
  起服务：  node server/index.js --port 6657   # 页面、联机、排行榜都在这个端口
  跑测试：  npm test

部署（在服务器上，需要 root）
----------------------------
  sudo bash deploy/install.sh                 # 默认 6657
  sudo PORT=8080 bash deploy/install.sh       # 换端口

装好后打开 http://<服务器公网IP>:6657/ ；验证：
  curl http://127.0.0.1:6657/health
  curl http://127.0.0.1:6657/api/leaderboard

排行榜数据在 /opt/danteng/data/leaderboard.json，升级不覆盖；手改后要重启服务。

详细部署说明见 deploy/README.md；线上服务器的具体操作与回滚见 SKILL.md。
