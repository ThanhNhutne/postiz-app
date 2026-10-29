FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      xvfb \
      x11vnc \
      novnc \
      websockify \
      openbox \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/facebook-worker/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY apps/facebook-worker/src ./src
COPY apps/facebook-worker/bin ./bin

RUN chmod +x /app/bin/login-novnc.sh \
    && mkdir -p /data/browser-profiles /data/screenshots \
    && chown -R pwuser:pwuser /app /data

USER pwuser

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "src/index.mjs"]
