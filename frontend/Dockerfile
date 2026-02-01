
FROM node:20-alpine AS builder
WORKDIR /app


ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL


COPY . .


WORKDIR /app/frontend

RUN npm install
RUN npm run build


FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf


COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
