/** @type {import('next').NextConfig} */
const apiUrl = process.env.API_URL ?? 'http://localhost:8000';

export default {
  // /api/* 요청을 FastAPI 로 넘깁니다.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};
