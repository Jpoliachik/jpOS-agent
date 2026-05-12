# jpos-qdrant

Vector store for jpOS's memory layer. Internal-only Fly app running the
official `qdrant/qdrant` image. Reached by `jpos-agent` over Fly's private
network at `http://jpos-qdrant.internal:6333`.

## First-time setup

```bash
cd jpos-qdrant
fly apps create jpos-qdrant
fly volumes create qdrant_data --region ord --size 3 --yes
fly deploy
```

## Update

```bash
cd jpos-qdrant && fly deploy
```

## Inspect

Qdrant is internal-only, so no public dashboard. To inspect:

```bash
# Quick collection list (from inside the qdrant machine)
fly ssh console -a jpos-qdrant -C "curl -s localhost:6333/collections"

# Or from jpos-agent's perspective
fly ssh console -a jpos-agent -C "curl -s http://jpos-qdrant.internal:6333/collections"
```

The jpos-agent HTTP API also exposes memory inspection endpoints — see
`src/interfaces/api.ts` (`GET /memory`, `GET /memory/search`, `GET /memory/stats`).
Those are usually the more convenient way to look around.

## Reset

```bash
# WARNING: destroys all memories
fly ssh console -a jpos-qdrant -C "rm -rf /qdrant/storage/*"
fly machines restart -a jpos-qdrant
```
