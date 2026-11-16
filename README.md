# 多人五子棋

3 人或 5 人联机五子棋。棋子颜色不绑定玩家：每局随机玩家顺序后固定循环，第一手黑；只有实际落子才黑白交替。无禁手。横竖斜连续同色不少于五子时，由完成该手的玩家独赢。最后一手先判赢再判满盘平局。主动退出或断线超过重连宽限则整局结束、不计胜负。连续三整轮无人落子（三人 9 次 / 五人 15 次超时，有落子清零）同样不计胜负。每回合 5 秒，超时跳过该玩家且不换色。

网页版预期地址：`https://gomoku.jopatk.top`，WebSocket 同域 `wss://gomoku.jopatk.top/ws`。Toy 只托管静态前端，联机仍走上述 WSS。

## 本地运行

```bash
npm ci
cp .env.example .env
npm test
npm run dev
```

- 前端：<http://127.0.0.1:5173>
- 联机服务：`ws://127.0.0.1:18765`（仅回环）
- 健康检查：`GET http://127.0.0.1:18765/health`

同机试玩不需要服务端。联机请用多个浏览器窗口打开同一房间链接。

```bash
npm run build
npm start
```

生产启动读取环境变量（见下）。`SIGINT` / `SIGTERM` 会停止接新连接并关闭房间。

## 配置

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `VITE_WS_URL` | 无 | 前端构建时写入的 WebSocket 地址 |
| `GOMOKU_HOST` | `127.0.0.1` | 监听地址。容器内用 `0.0.0.0`，由宿主机映射到回环 |
| `GOMOKU_WS_PORT` | `18765` | 监听端口 |
| `GOMOKU_ALLOWED_ORIGINS` | 空 | 精确 Origin 列表，逗号分隔 |
| `GOMOKU_ALLOWED_ORIGIN_HOST_SUFFIXES` | `.bilibili.com,.hdslb.com` | 额外允许的 https 宿主后缀，兼容 Toy 预览/正式容器，**不是身份** |
| `GOMOKU_ALLOW_NO_ORIGIN` | 非 production 为 1 | 是否允许握手不带 Origin（仅本地/测试） |
| `GOMOKU_ALLOW_LOCAL_ORIGINS` | 非 production 为 1 | 是否允许 `127.0.0.1` / `localhost` |
| `GOMOKU_RECONNECT_GRACE_MS` | `20000` | 非主动退出的断线重连宽限 |
| `GOMOKU_MAX_ROOMS` | `200` | 房间数上限 |
| `GOMOKU_MAX_CONNECTIONS` | `400` | 连接数上限 |
| `GOMOKU_MAX_MESSAGE_BYTES` | `4096` | 单条消息上限 |
| `GOMOKU_CONNECT_PER_MIN` | `30` | 每 IP 每分钟新连接 |
| `GOMOKU_MESSAGES_PER_SEC` | `20` | 每 IP 每秒消息 |
| `GOMOKU_CREATE_PER_MIN` | `8` | 每 IP 每分钟建房 |
| `GOMOKU_IDLE_LOBBY_MS` | `900000` | 空闲大厅清理 |
| `GOMOKU_IDLE_FINISHED_MS` | `1200000` | 已结束房间空闲清理 |

完整生产模板：`deploy/.env.production.example`。

### Origin

浏览器 WebSocket 会带 `Origin`。服务端用环境变量白名单过滤来源，防止随意网页连入；**座位身份只认服务端签发的不可猜 `sessionToken`**，不要把 Origin 当登录。

不要只放行 `https://www.bilibili.com`。网页版要加 `https://gomoku.jopatk.top`。Toy 正式页常见 Origin 是 `https://www.bilibili.com`，预览页可能是其它 `*.bilibili.com` / `*.hdslb.com` 宿主。默认后缀用于兼容这些容器；部署后若日志出现 `ws_origin_reject`，把实际 Origin 补进 `GOMOKU_ALLOWED_ORIGINS`。本地 `npm run dev` 默认放行本机 Origin。

### 断线重连（默认 20 秒）

- 创建/加入成功后，客户端把 `sessionToken` 放在 **sessionStorage**（当前标签页刷新仍在，换标签页不会自动占同一座位）。
- 刷新或短暂闪断：**不会立刻终止整局**。在宽限内用同一 token 恢复原座位。
- **主动退出**（退出本局 / 离开房间 / 返回首页）立刻结束或离席，并作废会话。
- 宽限耗尽仍未重连：若对局中，整局中止、不计胜负；大厅或已结束则释放座位。
- 宽限**不会暂停** 5 秒回合与三整轮超时。断线期间该跳过仍跳过，连续超时满额仍结束。

## 同房再来一局

对局结束后原房间保留。满 3/5 人且**全员准备**后自动开下一局：棋盘清空、重新随机行动顺序、第一手黑。有人离席则出现空位，新玩家可加入凑满后再准备。不改变只能 3 或 5 人开局的前提。

## Toy 打包

只发布 `dist/` 内容（根目录要有 `index.html`），不要带源码、`node_modules`、`.env`、部署文件。

```bash
npm run build
# 检查 dist/index.html < 1MiB，资源为相对路径
```

封面与图标由发布流程准备，本仓库不伪造图片。不要在 Toy 里做聊天、自由昵称、第三方登录或站外跳转。

## 部署（新加坡构建，杭州只跑镜像）

杭州不能构建、不能拉 Docker Hub / npm。本仓库只提供模板，**不要在未授权时执行部署**。

新加坡：

```bash
docker build -t gomoku:YYYYMMDD --build-arg VITE_WS_URL=wss://gomoku.jopatk.top/ws .
docker save gomoku:YYYYMMDD | gzip > gomoku-YYYYMMDD.tar.gz
# 用 screen 挂起，rsync 将 tar 传到杭州
```

杭州（仅镜像 / compose / env，不放业务源码）：

```bash
gunzip -c gomoku-YYYYMMDD.tar.gz | docker load
# 将 deploy/compose.yaml 与 deploy/.env.production.example 放到运行目录
cid=$(docker create gomoku:YYYYMMDD)
docker cp "$cid":/app/web/. /var/www/gomoku/
docker rm "$cid"
docker compose --env-file .env up -d --no-build
```

主机 Nginx 使用 `deploy/nginx-gomoku.conf.example`：证书必须匹配 `gomoku.jopatk.top`，`/ws` 反代到 `127.0.0.1:18765`，**不要把容器端口映射到 0.0.0.0**。保留旧 tar 与旧镜像以便回滚。更新前查看 `/health` 与是否有进行中房间。

## 测试

```bash
npm test
npm run build
```

覆盖引擎规则、协议字段校验、Origin、限流、房间清理、断线重连、多客户端落子/退出/再开一局。这些是本地自动测试，**不是 Toy 容器实测**。
