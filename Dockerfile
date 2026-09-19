FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3000
EXPOSE 3000
# ISSUER_SEED / TAX_SEED 는 base64url 32바이트. 배포 환경변수로 넣는다.
CMD ["npx", "tsx", "server/index.ts", "--prod"]
