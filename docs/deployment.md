# CloudBase 部署

## 部署顺序

1. 为企业新建 CloudBase 环境、数据库、文件存储和 HTTPS 域名。按 `cloudbase/database/collections.json` 建立集合，限制普通客户端直接读写业务数据。
2. 先完成品牌配置。在后台创建门店以前，需在 `brands` 集合建一条有效品牌记录。可参考 `cloudbase/database/seed/` 中三个组织示例。运行 `npm run cloudbase:seed-command` 可生成导入命令，导入前检查名称和门店资料。
3. 以 `cloudbaserc.example.json` 为模板建立本地 `cloudbaserc.json`，填写环境 ID。运行 `npm run cloudbase:prepare-functions`，在目标环境发布 `employeeWeb`、`adminData` 和按需使用的 `adminReview`、`employeeReminder`。CloudBase HTTP 服务需配置对应的 HTTP 路由。其余云函数可按集成需要配置。
4. 在云函数环境变量中设置服务端配置。员工端和后台用各自的 `.env.example` 创建本地部署配置。让 `VITE_EMPLOYEE_API_ENDPOINT`、`VITE_ADMIN_API_ENDPOINT` 分别指向员工和后台 HTTP API。按配置指向实际 HTTPS 来源及回调地址。
5. 运行 `npm run verify:release` 验证代码、构建和发布环境变量。检查器读取当前进程环境及 `cloudbaserc.json`，可用 `node --env-file=路径 scripts/check-release-config.mjs` 直接检查自己的发布变量文件。部署 `apps/employee/dist` 到 `/employee/`，部署 `apps/admin/dist` 到 `/admin/`。
6. 从管理后台导入授权员工和组织，添加及发布自己的培训内容。新环境先用测试员工完成员工准入、视频、PPT、考试以及数据回写，再开放正式访问。

## 必需配置

| 位置 | 设置 |
| --- | --- |
| 员工端构建 | `VITE_EMPLOYEE_API_ENDPOINT`、`VITE_EMPLOYEE_LOGIN_MODE`、`VITE_ENABLE_DEMO=0` |
| 后台构建 | `VITE_ADMIN_API_ENDPOINT` |
| 员工云函数 | `EMPLOYEE_LOGIN_MODE`、`WEB_ALLOWED_ORIGINS`、`WEB_SESSION_SECRET`、`EMPLOYEE_IDENTITY_HASH_SECRET`、`PRIVACY_CONTACT`、`ALLOW_DIRECT_LOGIN=0` |
| 管理云函数 | `ADMIN_REVIEW_SECRET`、`ADMIN_ALLOWED_ORIGINS` |
| 微信 OAuth | `WECHAT_OA_APPID`、`WECHAT_OA_APP_SECRET`、`WECHAT_OAUTH_REDIRECT_URI` |

员工端与函数的登录模式须一致。可选 `wechat-oauth` 或 `manual-review`，后者由管理后台审核员工申请。为会话签名、身份散列及后台分别生成强随机密钥，并保存在云函数环境变量里。前端 `VITE_` 变量会写入浏览器构建产物。

## 视频、PPT 和可选能力

后台支持直接选择 `.pptx`。正式模式将原文件上传到存储，借助 COS 数据万象文档预览生成逐页图片，并读取转换结果的页数。CloudBase 函数需要访问对应存储桶和文档预览服务的权限，常用设置为 `PPT_COS_BUCKET` 和 `PPT_COS_REGION`。配置成功后，员工端按顺序每页至少停留 3 秒。视频播放、文档转换、语音识别和 OCR 的服务能力及费用由部署方的云产品配置决定。

本地验收覆盖应用构建、业务单元测试和演示流程。部署验收应另测真实文件上传、跨端同步、微信登录与所启用的云服务。
