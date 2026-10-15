FROM node:lts-alpine AS dependencies
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:lts-alpine AS builder
WORKDIR /usr/src/app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:lts-alpine AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /usr/src/app ./
USER node
EXPOSE 3000
CMD ["npm", "start"]
