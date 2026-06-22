# Seedance 2.0 Video Generator Website

This project provides a client-facing website that:

1. accepts a text prompt,
2. requests video generation from Seedance 2.0,
3. polls until the task finishes, and
4. lets the client preview and download the generated video.

## Requirements

- Node.js 18+
- A valid Seedance API key

## Configuration

Copy and edit environment variables:

```bash
cp .env.example .env
```

Required:

- `SEEDANCE_API_KEY` - your API key

Common defaults are already provided:

- `SEEDANCE_BASE_URL=https://ark.cn-beijing.volces.com`
- `SEEDANCE_MODEL=doubao-seedance-2-0-fast-260128`
- `SEEDANCE_TIMEOUT_MS=300000`
- `SEEDANCE_POLL_INTERVAL_MS=3000`

If your Seedance account uses a different host or model name, update those values.

## Run

```bash
npm install
npm run dev
```

Production-style start:

```bash
npm start
```

Open:

`http://localhost:3001`

## Scripts

- `npm run dev` - start with nodemon
- `npm start` - start with Node.js
- `npm run check` - syntax check

## API Endpoints

- `GET /api/health` - server status and Seedance config status
- `POST /api/videos/generate` - create and poll a Seedance generation task
- `GET /api/videos/download?url=...` - proxy video download as an attachment
