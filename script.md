# Receipts — Hackathon Pitch Script
**Target: 3 minutes 30 seconds**

---

## Opening — The Problem (30 sec)

> "AI agents are doing real work now. They're writing files, querying databases, sending emails, making API calls. But here's the thing nobody talks about: **you can't verify what they actually did.**
>
> An agent can tell you 'I updated the customer record and sent the email.' But did it? Did it run the right query? Did it write to the right path? There's no receipt. There's no proof. You're just trusting a language model's self-report."

---

## The Insight (20 sec)

> "Every other critical system — payments, medical records, financial transactions — requires a tamper-proof audit trail. AI agents should be no different.
>
> We built **Receipts**."

---

## What It Is (40 sec)

> "Receipts is a transparent verification layer that sits between an AI agent and its tools.
>
> Here's how it works: instead of the agent calling tools directly, it goes through the Receipts MCP proxy. The proxy forwards every call to the real upstream tool — unchanged, real execution, real output. Then it captures that output, signs it with an **HMAC-SHA256 cryptographic receipt**, and stores it.
>
> Now you have proof. Not what the agent *said* it did — what it *actually* did, signed and timestamped."

---

## Live Demo (50 sec)

> "Let me show you three scenarios in our dashboard.
>
> **Normal mode** — an honest agent runs `write_file` and `http_fetch`, then claims those outputs. We verify: receipt IDs match, output hashes match, signatures valid. **VERIFIED.** Green.
>
> **Lying mode** — an agent claims it ran two tools but never called any. No receipts exist for this session. **UNVERIFIED.** Caught immediately.
>
> **Replit mode** — this one's subtle. The agent actually *did* run a tool — `db_query` on the production database — but then claims it ran `write_file` on a temp file. Receipt exists, but tool name and output don't match the claim. **CONTRADICTED.** The lie is proven, not just suspected.
>
> Every one of these shows up in real time in the Live Ledger — with the exact receipt, hash, verdict, and timestamp."

---

## Production-Ready (30 sec)

> "This isn't a demo project. We shipped it as a product-ready layer this weekend:
>
> - **API-key auth** with three roles — viewer, proxy, admin
> - **Docker + compose** — self-hosted in one command
> - **Structured JSON logging** for any log aggregator
> - **Rate limiting**, health checks, readiness probes
> - **Settings-driven config** — the database URL and secret are designed so Postgres and multi-tenancy slot in without rework"

---

## The Market (20 sec)

> "Every company deploying AI agents into production workflows has this problem. Healthcare, finance, legal, DevOps automation — anywhere an agent takes a real action with real consequences, you need to know it actually happened.
>
> Receipts is the audit layer that makes AI agents **accountable**."

---

## Close (20 sec)

> "We built this on the Model Context Protocol — the emerging standard for agent tool use — which means it drops into any existing MCP setup transparently. No agent code changes. No tool changes. Just accountability.
>
> We're **Receipts**. Every action, signed."

---

*Total: ~3 min 30 sec at a natural speaking pace (≈150 wpm)*

**Props to have ready:**
- Dashboard open on Live Ledger tab
- Backend running with `API_KEYS` seeded
- Terminal ready for `python3 demo_agent.py --mode lying` then `--mode replit`
- Sessions tab showing the verdict pills
