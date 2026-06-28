FROM node:20

WORKDIR /app

# 先装 npm 依赖
COPY package.json .
RUN npm install

# Playwright 安装 Chromium + 系统依赖（一步到位）
RUN npx playwright install --with-deps chromium

# 中文字体
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 3000

CMD ["node", "server.mjs"]
