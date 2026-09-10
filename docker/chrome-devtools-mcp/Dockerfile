# chrome-devtools-mcp を動かすための最小イメージ。
# ホストに Node.js が無いので、MCP サーバと Chrome をまとめてこのイメージに焼く。
#   docker build -t us-stock-order-chrome-devtools-mcp docker/chrome-devtools-mcp
FROM node:22-slim

# Google Chrome stable。Chrome for Testing を手で展開するより、
# apt に依存関係（フォント・共有ライブラリ）を解決させるほうが壊れにくい。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates gnupg wget \
 && wget -qO- https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

# @latest を毎回 npx で取りに行くと、npm が遅い日にサーバ起動が失敗して
# CONNECTION_CLOSED になる。イメージに固定して焼く。
ARG CHROME_DEVTOOLS_MCP_VERSION=latest
RUN npm install -g chrome-devtools-mcp@${CHROME_DEVTOOLS_MCP_VERSION}

ENTRYPOINT ["chrome-devtools-mcp"]
