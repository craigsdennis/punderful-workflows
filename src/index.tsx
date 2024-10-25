import { Hono, Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { jsxRenderer } from "hono/jsx-renderer";

import { PublishWorkflow } from "./workflows/publish";
import { InteractionWorkfow } from "./workflows/interaction";
import { PuntificatorWorkflow } from "./workflows/puntificator";
import { LeaderboardWorkfow } from "./workflows/leaderboard";
import Home from "./pages/Home";
import New from "./pages/New";
import Me from "./pages/Me";
import Detail from "./pages/Detail";
import Search from "./pages/Search";

export {
  PublishWorkflow,
  InteractionWorkfow,
  PuntificatorWorkflow,
  LeaderboardWorkfow,
};

// Hono c variables
type Variables = {
  userId: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Add a session cookie to all requests
app.use("*", async (c, next) => {
  let userId = getCookie(c, "userId");
  let shouldSetCookie = false;
  if (userId === undefined) {
    userId = "anon-" + crypto.randomUUID();
    shouldSetCookie = true;
  }
  c.set("userId", userId);
  await next();
  if (shouldSetCookie) {
    setCookie(c, "userId", userId);
  }
});

// Layout
app.use(
  "*",
  jsxRenderer(({ children }) => {
    return (
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <link rel="stylesheet" href="/styles.css" />
          <script defer src="/scripts/utils.js" />
        </head>
        <body>
          <header>
            <a href="/">
              <img src="/logo.png" alt="Punderful Logo" class="logo" />
            </a>
            <nav>
              <a href="/new" class="new-pun-link">
                ➕
              </a>
              <a href="/search" class="search-link">
                🔍
              </a>
              <a href="/me" class="profile-link">
                👤
              </a>
            </nav>
          </header>
          <main>{children}</main>
        </body>
      </html>
    );
  })
);

async function insertPun(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  pun: string
): Promise<string> {
  const results = await c.env.DB.prepare(
    `INSERT INTO puns (id, pun, status, creator) VALUES (?, ?, ?, ?) RETURNING id;`
  )
    .bind(crypto.randomUUID(), pun, "draft", c.get("userId"))
    .run();
  return results.results[0].id as string;
}

async function getSimilarPunIdsById(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  punId: string
): Promise<Array<string>> {
  const punVectors = await c.env.VECTORIZE.getByIds([
    `content-${punId}`,
    `categories-${punId}`,
  ]);
  const contentResults = await c.env.VECTORIZE.query(punVectors[0].values, {
    namespace: "content",
    returnMetadata: true,
    topK: 20,
  });
  const categoryResults = await c.env.VECTORIZE.query(punVectors[1].values, {
    namespace: "categories",
    returnMetadata: true,
    topK: 10,
  });
  // Combine the content first and then the category results
  let results = [];
  results.push(...contentResults.matches);
  results.push(...categoryResults.matches);
  // Filter them
  results = results.filter((r) => r.score > 0.6);
  const ids = results.map((r) => r?.metadata?.punId as string);
  return ids;
}

async function getLikedPunsForUser(
  c: Context<{ Bindings: Env; Variables: Variables }>
) {
  const userId = c.get("userId");
  let userFieldName = "user_id";
  if (userId.startsWith("anon-")) {
    userFieldName = "session_id";
  }
  const likedResponse = await c.env.DB.prepare(
    `
		SELECT
			puns.*
		FROM
			puns JOIN pun_interactions ON (puns.id = pun_interactions.pun_id)
		WHERE
			pun_interactions.${userFieldName} = ?
		AND
			pun_interactions.interaction_type = 'like'
		ORDER BY pun_interactions.created_at DESC;
	`
  )
    .bind(userId)
    .all();
  return likedResponse.results;
}

async function punsByIds(c: Context, punIds: Array<string>) {
  const commas = "?".repeat(punIds.length).split("").join(", ");
  const sql = `SELECT * FROM puns WHERE id IN (${commas})`;
  const stmt = c.env.DB.prepare(sql).bind(...punIds);
  const response = await stmt.run();
  return response.results;
}

app.get("/api/puns", async (c) => {
  // TODO: paging
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM puns WHERE status='published' ORDER BY created_at DESC`
  ).all();
  return c.json({ results });
});

app.post("/api/puns", async (c) => {
  const payload = await c.req.json();
  const punId = await insertPun(c, payload.pun);
  const workflow = await c.env.PUBLISH.create({
    params: {
      punId,
      pun: payload.pun,
    },
  });
  return c.json({ workflow });
});

app.get("/api/puns/trending", async (c) => {
  const trendingJSON = await c.env.LEADERBOARD.get("trending");
  return c.json(JSON.parse(trendingJSON));
});

app.get("/api/puns/search", async (c) => {
  const query = c.req.query("q") || "";
  if (query === undefined) {
    return c.json({ results: [] });
  }
  const embeddings = await c.env.AI.run("@cf/baai/bge-large-en-v1.5", {
    text: query,
  });

  const results = await c.env.VECTORIZE.query(embeddings.data[0], {
    namespace: "content",
    topK: 20,
    returnMetadata: true,
  });
  const ids = results.matches
    .filter((r) => r.score > 0.5)
    .map((r) => r?.metadata?.punId) as Array<string>;
  const puns = await punsByIds(c, ids);
  return c.json({ results: puns });
});

app.get('/api/puns/mine', async (c) => {
	const createdResponse = await c.env.DB.prepare(`SELECT * FROM puns WHERE creator=? ORDER BY created_at DESC`).bind(c.get('userId')).all();
	const liked = await getLikedPunsForUser(c);
	return c.json({ created: createdResponse.results, liked: liked });
});

app.get("/api/puns/:punId", async (c) => {
  const punId = c.req.param("punId");
  const pun = await c.env.DB.prepare(`SELECT * FROM puns WHERE id=?`)
    .bind(punId)
    .first();
  if (pun === null) {
    return c.status(404);
  }
  // Allow user to see their own
  if (pun.status !== "published") {
    if (c.get("userId") !== pun.creator) {
      console.warn("Trying to view unpublished");
      return c.status(404);
    }
  }
  return c.json(pun);
});

app.get("/api/puns/:punId/similar", async (c) => {
  const punId = c.req.param("punId");
  if (punId === undefined) {
    return c.json({ results: [] });
  }
  const ids = await getSimilarPunIdsById(c, punId);
  const puns = await punsByIds(c, ids);
  return c.json({ results: puns });
});

async function addInteraction(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  punId: string,
  interactionType: string
) {
  const userId = c.get("userId") as string;
  const workflow = await c.env.INTERACTION.create({
    params: {
      userId,
      punId,
      interactionType,
      cf: c.req.raw.cf,
    }
  });
  return true;
}

app.post("/api/puns/:punId/like", async (c) => {
  const punId = c.req.param("punId");
  await addInteraction(c, punId, "like");
  return c.json({ success: true });
});

app.get("/", (c) => {
  return c.render(<Home />);
});

app.get("/new", (c) => {
  return c.render(<New />);
});

app.get("/me", (c) => {
  return c.render(<Me />);
});

app.get("/search", (c) => {
  return c.render(<Search />);
});

app.get("/puns/:punId", async (c) => {
  // TODO: Verify pun exists?
  const punId = c.req.param("punId");
  await addInteraction(c, punId, "detail");
  return c.render(<Detail />);
});


async function getAsset(c: Context, pathName: string) {
	const asset = await c.env.ASSETS.unstable_getByPathname(pathName);
	if (!asset) {
		throw new Error('missing asset!');
	}
	return new Response(asset.readableStream, { headers: { 'Content-Type': asset.contentType } });
}

/* Uncomment if you want to upload

app.post('/api/puns/batch', async (c) => {
	const response = await getAsset(c, '/puns.json');
	const opuns = (await response.json()) as Array<string>;
	console.log(`Batching up ${opuns.length} puns`);
	c.set('userId', 'oPun');

	for (const opun of opuns) {
		const pun = opun.replace('\n', ' ').replace('. ', '.\n\n').replace('? ', '?\n\n');
		const punId = await insertPun(c, pun);
		const workflow = await c.env.PUBLISH.create({
      id: `oPun-batch-${crypto.randomUUID()}`,
      params: {
        punId,
        pun,
      }
		});
	}
	return c.json({ success: true });
});
*/

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(env.LEADERBOARD_WORKFLOW.create());
  },
}
