import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';


export type LeaderboardParams = {};

export class LeaderboardWorkflow extends WorkflowEntrypoint<Env, LeaderboardParams> {
	async run(event: WorkflowEvent<LeaderboardParams>, step: WorkflowStep) {
		const trendingResultsJSON = await step.do('gather-trending-posts', async() => {
			// Imagine something way more gnarlier than this
			const response = await this.env.DB.prepare(
				`
			WITH LatestLikes AS (
				SELECT *
				FROM pun_interactions
				WHERE interaction_type = 'like'
				ORDER BY created_at DESC
				LIMIT 100
			)
			SELECT p.*, COUNT(like.interaction_id) AS likes_count
			FROM puns p
			JOIN LatestLikes like ON p.id = like.pun_id
			GROUP BY p.id
			ORDER BY likes_count DESC
			LIMIT 3;`
			).all();
			return JSON.stringify(response.results);
		});
		await step.do('store-trends', async () => {
			await this.env.LEADERBOARD.put('trending', trendingResultsJSON);
		});
		return { trending: JSON.parse(trendingResultsJSON) };
	}
}
