# Punderful

Punderful is a #BuildInPublic project that collects puns from everyone and helps them find them ones that make the chuckle.

It was built with 🧡 on the [Cloudflare Stack](https://www.youtube.com/watch?v=FH5-m0aiO5g). Most importantly, this code focusses heavy on the new kid on the block [Workflows](https://developers.cloudflare.com/workflows).


## Learn More

[<img src="https://img.youtube.com/vi/slS4RBV0SBk/0.jpg">](https://youtu.be/slS4RBV0SBk "Cloudflare Workflows: The Newest Developer Platform Primitive at Cloudflare")

[<img src="https://img.youtube.com/vi/y4PPsvHrQGA/0.jpg">](https://youtu.be/y4PPsvHrQGA "Cloudflare Workflows: Batching and Monitoring your Durable Execution")

[<img src="https://img.youtube.com/vi/L6gR4Yr3UW8/0.jpg">](https://youtu.be/L6gR4Yr3UW8 "Schedule and Sleep For Your Apps with Durable Workflow Execution a.k.a Cloudflare Workflows #ai")




## Setup

You should be able to create all of this on the free tier. Let me know if you run into any problems

### D1

This uses a D1 database, so you need to create one

```bash
npx wrangler d1 create punderful
```

Copy and Paste the returned value and replace it in [wrangler.toml](./wrangler.toml)

*Dev mode*

```bash
npx wrangler d1 migrations apply punderful
```

*Production*

```bash
npx wrangler d1 migrations apply punderful --remote
```

### Vectorize

Create the index with the settings of embedding model we are going to use

```bash
npx wrangler@beta vectorize create punderful --preset "@cf/baai/bge-large-en-v1.5"
```

(This is already in wrangler.toml)

### KV

Create the namespace

```bash
npx wrangler@workflows kv namespace create LEADERBOARD
```

Copy and Paste the returned value and replace it in [wrangler.toml](./wrangler.toml)

### AI Gateway

The Workers AI calls that I do in this app pass through an AI Gateway named `punderful`. This let's me log and monitor of all AI usage.

Here is a link to your [AI Gateway](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway/general) in dashboard.

Or head over to [Dash](https://dash.cloudflare.com) > Your Account > AI > AI Gateway

Click the ➕ sign to create a new Gateway and name it `punderful`.

### Optional: OpenAI

Moderation is available using the free OpenAI the PublishWorkflow. You will need an OpenAI API Key to use it.

```bash
npx wrangler secret put OPENAI_API_KEY 
```

## Develop

You can develop locally, mostly.

```bash
npm run dev
```

But you probably really should deploy it.

```bash
npm run deploy
```