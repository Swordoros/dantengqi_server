/**
 * 排行榜：玩家 ID 与各 AI 难度的胜场。
 *
 * 只记两样东西：玩家自己输入的 ID，以及在某个难度下赢过几局。页面在一局人机对战
 * 结束、并且人类执子的一方获胜时上报一次。没有密码，没有服务端棋局校验，所以它是
 * 一个朋友之间的记分板，不是防作弊的成绩单。
 *
 * 存储是一个 JSON 文件（默认 `data/leaderboard.json`），写入走临时文件再改名，
 * 进程崩溃不会留下半个文件。用 JSON 而不是 sqlite，是为了让这个包保持零额外依赖。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 页面能上报的难度，顺序即排行榜列顺序（与首页 AI 菜单一致）。 */
export const LEVELS = ["easy", "normal", "hard", "master", "grandmaster", "hell", "experiment"];

const ID_MAX = 24;
const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;
const BODY_MAX = 4 * 1024;

function blankWins() {
  const wins = {};
  for (const level of LEVELS) wins[level] = 0;
  return wins;
}

function cleanId(value) {
  if (typeof value !== "string") return { ok: false, error: "ID 必须是字符串" };
  const id = value.trim();
  if (!id || id.length > ID_MAX) return { ok: false, error: `ID 要 1–${ID_MAX} 个字符` };
  for (const ch of id) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) return { ok: false, error: "ID 不能有控制字符" };
  }
  return { ok: true, id };
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad shape");
    return parsed;
  } catch {
    throw Object.assign(new Error("请求体不是合法 JSON"), { status: 400 });
  }
}

/**
 * @param {{ dataDir?: string, log?: (...args: any[]) => void }} options
 */
export function createLeaderboard({ dataDir, log = () => {} } = {}) {
  const dir = dataDir;
  if (!dir) throw new Error("createLeaderboard 需要 dataDir");
  const file = join(dir, "leaderboard.json");

  /** @type {Map<string, {createdAt: string, updatedAt: string, wins: Record<string, number>}> | null} */
  let players = null;
  let loading = null;
  let saving = Promise.resolve();

  async function load() {
    if (players) return players;
    if (!loading) {
      loading = (async () => {
        try {
          const parsed = JSON.parse(await readFile(file, "utf8"));
          const map = new Map();
          for (const [id, rec] of Object.entries(parsed?.players ?? {})) {
            if (!rec || typeof rec !== "object") continue;
            const wins = blankWins();
            for (const level of LEVELS) {
              const n = Number(rec.wins?.[level]);
              if (Number.isFinite(n) && n > 0) wins[level] = Math.floor(n);
            }
            map.set(id, {
              createdAt: typeof rec.createdAt === "string" ? rec.createdAt : new Date().toISOString(),
              updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : new Date().toISOString(),
              wins,
            });
          }
          players = map;
          log(`排行榜已载入：${map.size} 名玩家（${file}）`);
        } catch (err) {
          if (err.code !== "ENOENT") log("排行榜读取失败，按空表处理：", err.message);
          players = new Map();
        }
        return players;
      })();
    }
    return loading;
  }

  function serialize(map) {
    const out = {};
    for (const [id, rec] of map) out[id] = rec;
    return `${JSON.stringify({ version: 1, players: out }, null, 2)}\n`;
  }

  /** 串行落盘；失败只记日志，不影响接口返回。 */
  function save() {
    const text = serialize(players ?? new Map());
    saving = saving
      .then(async () => {
        await mkdir(dir, { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, text, "utf8");
        await rename(tmp, file);
      })
      .catch((err) => log("排行榜写入失败：", err.message));
    return saving;
  }

  function rowOf(id, rec) {
    const row = { id, total: 0 };
    for (const level of LEVELS) {
      const n = rec.wins[level] ?? 0;
      row[level] = n;
      row.total += n;
    }
    return row;
  }

  function ensure(id) {
    const now = new Date().toISOString();
    let rec = players.get(id);
    if (!rec) {
      rec = { createdAt: now, updatedAt: now, wins: blankWins() };
      players.set(id, rec);
    } else {
      rec.updatedAt = now;
    }
    return rec;
  }

  function listing(limit) {
    const rows = [];
    for (const [id, rec] of players) rows.push(rowOf(id, rec));
    rows.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const ca = players.get(a.id).createdAt;
      const cb = players.get(b.id).createdAt;
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return rows.slice(0, limit);
  }

  async function handle(req, res) {
    const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (!path.startsWith("/api/")) return false;

    try {
      await load();

      if (path === "/api/health") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          send(res, 405, { detail: "只支持 GET" });
          return true;
        }
        send(res, 200, { ok: true });
        return true;
      }

      if (path === "/api/players") {
        if (req.method !== "POST") {
          send(res, 405, { detail: "只支持 POST" });
          return true;
        }
        const body = await readJson(req);
        const id = cleanId(body.id);
        if (!id.ok) {
          send(res, 400, { detail: id.error });
          return true;
        }
        const rec = ensure(id.id);
        await save();
        send(res, 200, rowOf(id.id, rec));
        return true;
      }

      if (path === "/api/wins") {
        if (req.method !== "POST") {
          send(res, 405, { detail: "只支持 POST" });
          return true;
        }
        const body = await readJson(req);
        const id = cleanId(body.player_id);
        if (!id.ok) {
          send(res, 400, { detail: id.error });
          return true;
        }
        if (!LEVELS.includes(body.difficulty)) {
          send(res, 400, { detail: `difficulty 只能是 ${LEVELS.join(" / ")}` });
          return true;
        }
        const rec = ensure(id.id);
        rec.wins[body.difficulty] += 1;
        await save();
        send(res, 200, rowOf(id.id, rec));
        return true;
      }

      if (path === "/api/leaderboard") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          send(res, 405, { detail: "只支持 GET" });
          return true;
        }
        const raw = Number(new URL(req.url || "/", "http://127.0.0.1").searchParams.get("limit"));
        const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), LIMIT_MAX) : LIMIT_DEFAULT;
        send(res, 200, { players: listing(limit) });
        return true;
      }

      send(res, 404, { detail: "没有这个接口" });
      return true;
    } catch (err) {
      log("排行榜接口出错：", err?.message || err);
      if (!res.headersSent) send(res, err?.status || 500, { detail: err?.message || "内部错误" });
      return true;
    }
  }

  return {
    handle,
    file,
    /** 等当前写入落盘（测试与优雅退出用）。 */
    flush: () => saving,
  };
}
