FROM node:20

WORKDIR /app

# 先装 npm 依赖
COPY package.json .
RUN npm install

# Playwright 安装 Chromium + 系统依赖（一步到位）
RUN npx playwright install --with-deps chromium

# ttyd（web终端）+ 中文字体
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 安装 ttyd（web终端工具）
RUN wget -q -O /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 && \
    chmod +x /usr/local/bin/ttyd

COPY . .

# 启动脚本权限
RUN chmod +x start.sh

EXPOSE 3000
EXPOSE 22

CMD ["/bin/bash", "start.sh"]
