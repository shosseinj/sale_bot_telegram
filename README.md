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
