FROM node:22-alpine

WORKDIR /app

# 先装依赖再拷源码，改业务代码不会让依赖层失效
COPY app/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY app/src ./src
COPY app/db ./db
COPY app/scripts ./scripts
COPY app/test ./test
COPY prototype ./studio

ENV NODE_ENV=production
EXPOSE 8787

# 健康检查会连库和对象存储：任何一个挂了都算不健康
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
