# Telegram Sales Automation Prototype

This repository contains a larger Telegram-oriented sales automation prototype with a bot/worker layer, an administrative panel, importable product data, and project documentation.

## Structure

- `worker/` — bot/background processing logic
- `panel/` — management interface
- `demo-data/` — demonstration data
- `tools/` — maintenance/import utilities
- `docs/` — supporting documentation
- `products-import-template.csv` — product import template

## Purpose

The project explores how messaging interfaces can be connected to product/catalog data and operational workflows. It is included as an applied software/automation project rather than as a machine-learning research contribution.

## Deployment

Configuration, credentials, bot tokens, and production data should be supplied through environment-specific secret management and excluded from version control.

The tracked `ff.md` file currently contains token- and authorization-shaped values. Treat them as exposed credentials, rotate them, and sanitize both the current tree and Git history before deployment.


## Goal

The project explores a Telegram-based sales workflow backed by a Cloudflare Worker, D1 data, an administrative panel, and repeatable product import tools.

## Installation

The deployable worker is under `worker/`:

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
npm run d1:local
npm run dev
```

Use only newly created local credentials. The values currently present in `ff.md` must be considered compromised and are not setup examples.

## Working with the Repository

Worker logic is in `worker/src/`; the management interface is in `panel/`; database and import helpers are documented under `docs/` and `tools/`. Run `npm run check` and `npm run build:panel` from `worker/` before deployment. Remote D1 migrations and `npm run deploy` change Cloudflare resources and should be used only after reviewing the target account and secrets.
