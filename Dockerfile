FROM node:20

WORKDIR /app

# 先装 npm 依赖
COPY package.json .
RUN npm install

# Playwright 安装 Chromium + 系统依赖（一步到位）
RUN npx playwright install --with-deps chromium

# SSH 服务 + 中文字体
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 配置 SSH
RUN echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && \
    echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config && \
    echo 'root:sy20027.1' | chpasswd && \
    mkdir -p /run/sshd

COPY . .

# 启动脚本权限
RUN chmod +x start.sh

EXPOSE 3000
EXPOSE 22

CMD ["/bin/bash", "start.sh"]
