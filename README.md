# AssetFlow

AssetFlow 是**只在本地电脑运行**的个人资产整理 Web App。
系统设置存储在本地 JSON 文件中，资产主数据和汇率数据存储在本地 CSV 文件里。
**注：本项目为使用AI vibe coding生成的，仅供参考。**

## 运行环境

- Node.js >= 20.9（推荐 22.x，开发环境验证版本：v22.22.0）
- npm >= 10（开发环境验证版本：10.9.4）
- Next.js 16.2.3（React 19.2.4）
- 操作系统：macOS / Linux / Windows 均可（仅本地运行）

## 本地运行

将项目源代码克隆到本地

```bash
cd /path/to/project/AssetFlow
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 界面展示

![总览折线图](https://github.com/user-attachments/assets/df2e723f-dac7-4a38-a8f2-adec800e6619)

![资产分析组件](https://github.com/user-attachments/assets/92799705-dedd-4325-8595-6a6683339a31)

![资产列表](https://github.com/user-attachments/assets/f7b46b9b-256c-4c5c-9389-5018dbbc1f7f)

![资产走势图](https://github.com/user-attachments/assets/8e8f8eec-82e1-4543-a31e-a69c82a77e37)

## 使用说明

### 股票价格自动补齐

如果你希望股票资产自动补齐每日价格，可以直接在设置页填写 Alpha Vantage API key；它会被写入项目根目录 `.env`。

### 汇率数据同步

汇率数据由 Frankfurter 提供，每天自动同步。
