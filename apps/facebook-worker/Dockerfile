FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app

COPY apps/facebook-worker/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY apps/facebook-worker/src ./src

RUN mkdir -p /data/browser-profiles /data/screenshots \
    && chown -R pwuser:pwuser /app /data

USER pwuser

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "src/index.mjs"]
