# web：Angular PWA（前端）

手机端屏 1–10 和合作社电脑看板。部署到 Firebase Hosting。

起步：在这个目录里 `npx @angular/cli new web --directory . --routing --style=scss`，
构建输出要和根目录 `firebase.json` 的 `hosting.public` 对上（默认 `web/dist/web/browser`）。

Firestore 只读：`plots`、`documents`、`assessments` 等由后端的 API 和 AI 服务写，前端实时订阅。
