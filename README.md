<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Archi Logic Sketch-to-3D

一个基于 React + Vite 的建筑线稿/风格融合应用，支持：

- 空间融合（线稿 + 参考图）
- 线稿增强（高清重绘）
- Gemini 图像生成模型调用

## 本地运行

**Prerequisites:** Node.js 18+

1. 安装依赖

```bash
npm install
```

2. 配置 API Key（推荐）

在项目根目录创建 `.env.local`：

```bash
GEMINI_API_KEY=your_api_key_here
```

3. 启动开发服务器

```bash
npm run dev
```

4. 打包构建

```bash
npm run build
```

## 部署建议（稳定性）

- 将应用部署为静态站点（Nginx / Vercel / Netlify 均可）。
- 优先使用环境变量注入 `GEMINI_API_KEY`，手动输入的 Key 仅作为兜底方案。
- 生产环境建议通过 HTTPS 提供服务，避免浏览器安全限制影响文件上传和 API 调用。
- 当前版本已增加：
  - 文件类型与大小校验（15MB 限制）
  - 图像读取异常处理
  - API 状态检测失败容错
  - 模型空响应防护
