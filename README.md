<h1 align="center">API Starter (Mongo)</h1>

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo_text.svg" width="320" alt="Nest Logo" /></a>
</p>

<p align="center">A progressive <a href="http://nodejs.org" target="blank">Node.js</a> framework for building efficient and scalable server-side applications, paired with Mongoose and a built-in Model Context Protocol (MCP) module for AI workflows.</p>

<p align="center">
  <a href="https://www.npmjs.com/~nestjscore"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
  <a href="https://www.npmjs.com/~nestjscore"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
  <a href="https://github.com/msanvarov/nest-rest-mongo-boilerplate/actions"><img src="https://github.com/msanvarov/nest-rest-mongo-boilerplate/actions/workflows/lint-and-test-merge.yml/badge.svg" alt="Github Actions" /></a>
</p>

## Table of Contents

1. [Description](#description)
2. [Stack](#stack)
3. [Prerequisites](#prerequisites)
4. [Deployment](#deployment)
5. [Environment Configuration](#environment-configuration)
6. [MCP Module](#mcp-module)
7. [Web Framework](#web-framework)
8. [Testing](#testing)
9. [TypeDocs](#typedocs)
10. [Open API](#open-api)
11. [Mongoose](#mongoose)
12. [Logs](#logs)
13. [Contribution](#contribution)

## Description

This boilerplate is made to quickly prototype backend applications. It comes with authentication, authorization, logging, CRUD features, MongoDB persistence via Mongoose, and a built-in Model Context Protocol server + client out of the box.

## Stack

| Layer    | Tech                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| Runtime  | Node.js 20+                                                                         |
| API      | NestJS 11 (Fastify adapter), Mongoose 8, Passport JWT, nest-access-control, Swagger |
| AI / MCP | `@modelcontextprotocol/sdk` 1.x (server + client over Streamable HTTP)              |
| Database | MongoDB (any 6+ release)                                                            |
| Tooling  | TypeScript 5.6, ESLint 9, Prettier 3, Jest 29                                       |

## Prerequisites

### Non-Docker

- Node.js 20+.
- A local or hosted MongoDB instance (Community edition, or Atlas).

### Docker

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running locally.

## Deployment

### Manual Deployment without Docker

- Clone the repo: `git clone https://github.com/msanvarov/nest-rest-mongo-boilerplate`.
- Install dependencies: `npm install`.
- Copy the env template: `cp .env.example .env` and fill in valid values.
- Start the app in development mode: `npm run start:dev` (served on http://localhost:9000).

### Deploying with Docker

```bash
docker compose up -d
```

This brings up the API on http://localhost:9000 and MongoDB on the standard 27017 port.

## Environment Configuration

By default, the application reads every env var from `.env`.

- **APP_ENV** — `development` or `production`. Drives logging.
- **APP_URL** — base URL for the application (used by the demo `GET /` handler).
- **PORT** — HTTP port; defaults to 9000.
- **WEBTOKEN_SECRET_KEY** — random secret used to sign JWTs.
- **WEBTOKEN_EXPIRATION_TIME** — seconds before a JWT expires (default 2400).
- **DB_URL** — MongoDB connection string.
- **MCP_SERVER_NAME / MCP_SERVER_VERSION** — identity reported by the local MCP server.
- **MCP_CLIENT_REMOTES** — comma-separated list of external MCP server endpoints to consume as a client (Streamable HTTP URLs).
- **MCP_ALLOWED_MODELS** — comma-separated whitelist of mongoose model names the MCP tools are allowed to query. Defaults to `Profile`.

## MCP Module

This project ships with a first-class Model Context Protocol integration so the API can both **expose** itself to AI clients and **consume** other MCP servers.

### What's included

| Piece               | Path                                     | Role                                                                              |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| `McpServerService`  | `src/modules/mcp/mcp-server.service.ts`  | In-process MCP server with mongo-aware tools and resources.                       |
| `McpClientService`  | `src/modules/mcp/mcp-client.service.ts`  | Connects to every endpoint in `MCP_CLIENT_REMOTES` and mirrors their inventory.   |
| `McpGatewayService` | `src/modules/mcp/mcp-gateway.service.ts` | Unifies the local + remote inventory, routes invocations, runs the chat preview. |
| `McpController`     | `src/modules/mcp/mcp.controller.ts`      | REST surface plus the native Streamable HTTP transport.                           |

### Mongo-aware tools

| Tool                 | Purpose                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `list-collections`   | List every mongoose model the server is allowed to inspect (controlled by `MCP_ALLOWED_MODELS`). |
| `count-documents`    | Count documents in an allowed model that match a filter.                                         |
| `find-documents`     | Run a `find()` on an allowed model with optional filter/projection. Limit clamped to 100.        |
| `aggregate-pipeline` | Run an aggregation pipeline against an allowed model. A trailing `$limit 100` stage is appended. |
| `get-profile`        | Convenience wrapper to look up a profile by username.                                            |

Resources: `mcp://nest/schema/profile`, `mcp://nest/server-info`.

> The whitelist prevents arbitrary collection access. Edit `MCP_ALLOWED_MODELS` to opt new models in.

### Endpoints

| Method | Path                 | Purpose                                                              |
| ------ | -------------------- | -------------------------------------------------------------------- |
| GET    | `/api/mcp/inventory` | Returns servers + tools + resources + prompts as JSON.               |
| POST   | `/api/mcp/invoke`    | Body: `{ serverId, name, arguments }` — invokes a tool.              |
| GET    | `/api/mcp/resource`  | Query: `serverId`, `uri` — reads a resource.                         |
| POST   | `/api/mcp/chat`      | Body: `{ message, toolCall?, history? }` — chat preview entry point. |
| ANY    | `/api/mcp/transport` | Native MCP Streamable HTTP endpoint for AI clients.                  |

### Connecting an external MCP client

Point a Streamable-HTTP-aware MCP client (Claude Desktop, Claude Code, mcp-cli, etc.) at `http://localhost:9000/api/mcp/transport`. The server advertises `MCP_SERVER_NAME@MCP_SERVER_VERSION` and exposes the registered tools and resources.

### Consuming external MCP servers

Set `MCP_CLIENT_REMOTES` to a comma-separated list of Streamable HTTP URLs. On startup the API connects to each, mirrors their inventory into `/api/mcp/inventory`, and routes invocations through the same `/api/mcp/invoke` and `/api/mcp/chat` endpoints.

## Web Framework

The API runs on [Fastify](https://github.com/fastify/fastify) via `@nestjs/platform-fastify`. The previous version of this boilerplate shipped both Express and Fastify adapters in `dependencies`; this revision drops the Express path since the modern `@fastify/*` plugins cover the same surface with better performance.

## Testing

### Docker

```bash
docker exec -it nest-mongo-api npm run test
```

### Non-Docker

```bash
npm run test
npm run test:e2e
npm run test:cov
```

## TypeDocs

`npm run typedocs` builds API documentation into the `docs/` folder and serves it locally on http://localhost:8080.

## Open API

Swagger UI is served at `/api/docs`. Configuration lives in `src/main.ts`.

## Mongoose

Connection setup is in `src/modules/app/app.module.ts`. The `Profile` model lives in `src/modules/profile/profile.model.ts`. To add a model, define the schema, register it via `MongooseModule.forFeature`, and add the model name to `MCP_ALLOWED_MODELS` if you want it accessible to MCP clients.

## Logs

Winston is wired up via `nest-winston`. In development the API logs to the console with timestamps; in production it adds a JSON error file at `logs/error.log` and a daily-rotated archive under `logs/application-YYYY-MM-DD.log`.

## Contribution

PRs are appreciated.

## License

Nest is [MIT licensed](LICENSE).

[Author](https://sal-anvarov.com/)
